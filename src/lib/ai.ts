import { functionsBaseUrl, supabase, supabaseKey } from './supabase'

/**
 * One place that knows how to call the `verafo-ai` edge function.
 *
 * Two things were wrong with the hand-rolled `fetch` calls this replaces:
 *
 *  · they sent no `apikey` and no `Authorization`, so the function received an
 *    anonymous request. That works only while the project runs the function
 *    with JWT verification switched off — re-enable it and every AI feature in
 *    the app answers 401 at once. Sending the merchant's own token is the
 *    correct request, works either way, and lets the function attribute the
 *    call to the signed-in user.
 *
 *  · every failure was flattened to "Request failed", which told the merchant
 *    nothing. A 401 (session), a 546 (the function hit its wall-clock limit)
 *    and a 500 from the model provider need three different responses, so the
 *    failure is classified here instead of being guessed at per call site.
 */

export type AiFailureKind = 'session' | 'network' | 'timeout' | 'server' | 'config' | 'request'

export interface AiFailure {
  kind: AiFailureKind
  /** Short, human title for a toast. */
  title: string
  /** What to tell the merchant, in their language rather than the stack's. */
  detail: string
  /** Whether offering a "try again" makes sense for this failure. */
  retryable: boolean
}

const SESSION_RE = /row-level security|violates row-level|permission denied|JWT|PGRST301|42501|not authenticated/i

/** Headers for a call to an edge function, including the signed-in token. */
export async function aiHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  if (supabaseKey) headers.apikey = supabaseKey
  let token: string | null = null
  if (supabase) {
    try {
      const { data } = await supabase.auth.getSession()
      token = data.session?.access_token ?? null
    } catch {
      /* fall back to the publishable key */
    }
  }
  if (supabaseKey) headers.Authorization = `Bearer ${token ?? supabaseKey}`
  return headers
}

export interface AiCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * POST `{ action, ...payload }` to the function with the right headers.
 *
 * A wall-clock guard is attached by default: a function that never answers
 * would otherwise leave the composer spinning forever, which reads to the
 * merchant as "Verafo is not responding" with nothing else to go on.
 */
export async function aiFetch(
  action: string,
  payload: Record<string, unknown> = {},
  options: AiCallOptions = {},
): Promise<Response> {
  const base = functionsBaseUrl()
  if (!base) throw new AiError({ kind: 'config', title: 'Verafo AI is not configured' })
  const headers = await aiHeaders()
  const controller = options.signal ? null : new AbortController()
  const timeoutMs = options.timeoutMs ?? 120_000
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    return await fetch(`${base}/verafo-ai`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...payload }),
      signal: options.signal ?? controller?.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AiError({
        kind: 'timeout',
        title: 'Verafo ran out of time',
        detail: 'The answer took longer than two minutes. Try a narrower question.',
      })
    }
    throw new AiError({
      kind: 'network',
      title: 'Could not reach Verafo',
      detail: 'The request never made it to the server. Check your connection and try again.',
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** An AI failure that already carries a merchant-facing message. */
export class AiError extends Error {
  readonly kind: AiFailureKind
  readonly retryable: boolean
  readonly title: string
  readonly detail: string

  constructor(failure: Pick<AiFailure, 'kind' | 'title'> & { detail?: string; retryable?: boolean }) {
    const detail = failure.detail ?? failure.title
    super(detail)
    this.name = 'AiError'
    this.kind = failure.kind
    this.title = failure.title
    this.detail = detail
    this.retryable = failure.retryable ?? DEFAULT_RETRYABLE[failure.kind]
  }
}

const DEFAULT_RETRYABLE: Record<AiFailureKind, boolean> = {
  session: false,
  network: true,
  timeout: true,
  server: true,
  config: false,
  request: false,
}

/**
 * Turn a non-2xx response into a merchant-facing failure.
 *
 * The function reports its own problems as `{ error }` with a 4xx/5xx, and the
 * platform reports its own (a 546 when the worker ran out of wall clock, a 503
 * while it boots) as plain text. Both are read here so the toast can say what
 * actually happened.
 */
export async function aiFailureFromResponse(res: Response): Promise<AiFailure> {
  let serverError: string | null = null
  let bodyText = ''
  try {
    bodyText = (await res.text()).slice(0, 2000)
  } catch {
    /* body already consumed or unreadable */
  }
  if (bodyText.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(bodyText) as { error?: unknown; message?: unknown }
      const raw = parsed.error ?? parsed.message
      if (typeof raw === 'string' && raw.trim()) serverError = raw.trim()
    } catch {
      /* not the JSON we expected */
    }
  }

  return classifyAiFailure(res.status, serverError ?? bodyText.trim())
}

/** Classify a failure from an HTTP status and whatever the server said. */
export function classifyAiFailure(status: number, serverMessage: string): AiFailure {
  const said = serverMessage.replace(/^Request failed \(?\d*\)?\.?\s*/i, '').trim()

  if (status === 401 || status === 403 || SESSION_RE.test(said)) {
    return {
      kind: 'session',
      title: 'Your session has expired',
      detail: 'Verafo could not use your sign-in for that request. Sign in again and the question will go through.',
      retryable: false,
    }
  }
  if (status === 546 || status === 503 || status === 504) {
    return {
      kind: 'timeout',
      title: 'Verafo ran out of time',
      detail:
        'That question needed more time than the function is allowed. Try a narrower one — a single city, product or buyer.',
      retryable: true,
    }
  }
  if (status >= 500) {
    return {
      kind: 'server',
      title: 'Verafo could not answer',
      detail: said && !/internal|edge function returned/i.test(said) ? said : 'The AI function failed on the server. Trying again usually works.',
      retryable: true,
    }
  }
  if (status === 404) {
    return {
      kind: 'config',
      title: 'The AI function is missing',
      detail: 'The verafo-ai function is not deployed for this project. Deploy it, then try again.',
      retryable: false,
    }
  }
  return {
    kind: 'request',
    title: 'Verafo could not answer',
    detail: said || `The request was rejected (${status}).`,
    retryable: false,
  }
}

/** Classify a thrown error (network, abort, or an AiError already). */
export function classifyAiThrow(err: unknown): AiFailure {
  if (err instanceof AiError) {
    return { kind: err.kind, title: err.title, detail: err.detail, retryable: err.retryable }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/abort/i.test(message)) {
    return {
      kind: 'timeout',
      title: 'Verafo ran out of time',
      detail: 'The answer took too long to arrive. Try asking something narrower.',
      retryable: true,
    }
  }
  if (/^Request failed|^Failed to fetch|^NetworkError|^Load failed/i.test(message)) {
    return {
      kind: 'network',
      title: 'Could not reach Verafo',
      detail: 'The request never made it to the server. Check your connection and try again.',
      retryable: true,
    }
  }
  if (SESSION_RE.test(message)) {
    return {
      kind: 'session',
      title: 'Your session has expired',
      detail: message,
      retryable: false,
    }
  }
  return { kind: 'request', title: 'Verafo could not answer', detail: message, retryable: false }
}

/** A JSON call: throws `AiError` with a merchant-facing message on failure. */
export async function aiJson<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  let res: Response
  try {
    res = await aiFetch(action, payload)
  } catch (err) {
    throw classifyAiThrow(err)
  }
  if (!res.ok) {
    const failure = await aiFailureFromResponse(res)
    throw new AiError(failure)
  }
  try {
    return (await res.json()) as T
  } catch {
    throw new AiError({ kind: 'server', title: 'Verafo sent a reply we could not read' })
  }
}
