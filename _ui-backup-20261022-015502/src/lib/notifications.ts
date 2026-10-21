/* ============================================================
   lib/notifications.ts — the bell.
   
   Rows are created by the database (admin broadcast, daily digest, outcome
   trigger); the client only reads them, marks them read, and asks for a digest.
   ============================================================ */

import { supabase } from './supabase'

export type NotificationKind = 'outcome' | 'daily' | 'admin'

/**
 * Fired on `window` after a page changes something the bell reflects. The bell
 * listens for it so it does not have to wait out its poll interval; the database
 * trigger is what actually writes the row, this only says "look again".
 */
export const NOTIFICATIONS_CHANGED = 'verafo:notifications'

export function notificationsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
}

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

/**
 * The most recent notifications for the signed-in user. RLS scopes the read.
 *
 * `failed` is not the same as "no notifications": a missing table (the migration
 * has not been applied yet) would otherwise look like an empty inbox, so the
 * bell can say something honest instead of pretending nothing has happened.
 */
export async function loadNotifications(
  limit = 25,
): Promise<{ rows: AppNotification[]; failed: boolean }> {
  if (!supabase) return { rows: [], failed: true }
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, title, body, link, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return { rows: [], failed: true }
  return { rows: (data ?? []) as AppNotification[], failed: false }
}

export async function markAllRead(): Promise<void> {
  if (!supabase) return
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
}

/**
 * Ask the database for today's digest, if it has not already written one.
 * Safe to call on every load: the function is idempotent per user per day.
 */
export async function ensureDailyDigest(): Promise<void> {
  if (!supabase) return
  try {
    await supabase.rpc('verafo_daily_digest')
  } catch {
    /* the digest is a nicety; never surface its failure */
  }
}

/** Admin only — the database refuses anyone else. Returns how many were sent. */
export async function sendNotification(input: {
  title: string
  body?: string
  link?: string
  all: boolean
  email?: string
}): Promise<{ sent: number; error?: string }> {
  if (!supabase) return { sent: 0, error: 'Supabase is not configured' }
  const { data, error } = await supabase.rpc('verafo_send_notification', {
    p_title: input.title,
    p_body: input.body ?? null,
    p_link: input.link ?? null,
    p_all: input.all,
    p_email: input.email ?? null,
  })
  if (error) {
    // PostgREST's "function ... in the schema cache" wording is accurate but
    // useless to whoever is looking at the form. Say what to do instead.
    const missing = /schema cache|could not find the function|does not exist/i.test(error.message)
    return {
      sent: 0,
      error: missing
        ? 'Notifications are not set up in the database yet. Run supabase/notifications.sql in the Supabase SQL editor, then try again.'
        : error.message,
    }
  }
  return { sent: Number(data ?? 0) }
}
