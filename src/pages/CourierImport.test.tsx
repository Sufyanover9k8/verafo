import { describe, expect, it, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/*
 * Regression test for the reported bug: the courier section promised "3 safe
 * final updates" (an enabled Confirm button), and pressing it wrote nothing —
 * the rows already held the courier's outcome. The section must count only the
 * rows it will actually change, say why, and show a changed table afterwards.
 */

const NOTIFICATIONS = vi.fn()
vi.mock('../lib/notifications', () => ({ notificationsChanged: () => NOTIFICATIONS() }))
vi.mock('../lib/toast', () => ({ useToast: () => ({ push: () => {} }) }))
vi.mock('../lib/ui/ai-column-map', () => ({ mapCourierColumnsWithAi: async () => null }))

vi.mock('../lib/supabase', () => ({
  isConfigured: true,
  supabaseUrl: 'http://localhost',
  supabaseKey: 'test',
  supabase: { from: (table: string) => tableBuilder(table) },
}))

type StoredRow = { order_id: string; status: string | null }
let ORDERS: any[] = []
let STORED: StoredRow[] = []
let UPSERTS: any[] = []
let TRACKING_UPDATES: any[] = []

/** Minimal stand-in for the PostgREST builder the component uses. */
function tableBuilder(table: string) {
  const filters: ((row: any) => boolean)[] = []
  let write: 'none' | 'upsert' | 'update' = 'none'
  let payload: any = null
  const source = () => (table === 'orders' ? ORDERS : STORED)
  const q: any = {
    select: () => q,
    limit: () => q,
    in: (col: string, values: any[]) => (filters.push((row) => values.includes(row[col])), q),
    eq: (col: string, value: any) => (filters.push((row) => row[col] === value), q),
    is: (col: string, value: any) => (filters.push((row) => (row[col] ?? null) === value), q),
    upsert: (row: any) => {
      write = 'upsert'
      payload = row
      UPSERTS.push({ table, ...row })
      const existing = STORED.find((r) => r.order_id === row.order_id)
      if (existing) existing.status = row.status
      else STORED.push({ order_id: row.order_id, status: row.status })
      return q
    },
    update: (row: any) => {
      write = 'update'
      payload = row
      TRACKING_UPDATES.push({ table, ...row })
      return q
    },
    then: (resolve: any) => {
      const rows = source().filter((row) => filters.every((f) => f(row)))
      const data = write === 'none' ? rows : payload ? [payload] : null
      return Promise.resolve({ data, error: null }).then(resolve)
    },
  }
  return q
}

const { CourierImport } = await import('./CourierImport')

const STORES = [{ id: 's1', name: 'Test Store' }]

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    store_id: 's1',
    buyer_phone: '03001234501',
    price: 1899,
    product_name: 'Classic Cotton Shirt',
    ordered_at: '2026-10-20T10:00:00Z',
    order_reference: null,
    shopify_order_id: null,
    courier_tracking_number: null,
    stores: { name: 'Test Store' },
    outcomes: null,
    ...overrides,
  }
}

const COURIER_CSV = 'Phone,Status\n03001234501,Delivered\n'

async function uploadAndPreview() {
  const user = userEvent.setup()
  render(<CourierImport stores={STORES} />)
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(input, new File([COURIER_CSV], 'courier_report.csv', { type: 'text/csv' }))
  // The button reads "Working…" while the file is being parsed.
  const previewButton = await screen.findByRole('button', { name: 'Preview matches' })
  await waitFor(() => expect(previewButton).toBeEnabled())
  await user.click(previewButton)
  return user
}

beforeEach(() => {
  ORDERS = []
  STORED = []
  UPSERTS = []
  TRACKING_UPDATES = []
  NOTIFICATIONS.mockClear()
})

describe('CourierImport confirm step', () => {
  it('does not promise an update for a row the database already matches', async () => {
    ORDERS = [order({ outcomes: { status: 'accepted', resolved_at: null } })]
    STORED = [{ order_id: 'o1', status: 'accepted' }]
    await uploadAndPreview()

    const button = await screen.findByRole('button', { name: 'Nothing to update' })
    expect(button).toBeDisabled()
    expect(screen.getByText('Already accepted — nothing to change')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Confirm 1 outcome update/ })).toBeNull()

    await userEvent.setup().click(button)
    expect(UPSERTS).toHaveLength(0)
  })

  it('writes a row whose stored outcome differs, then reports it as current', async () => {
    ORDERS = [order({ outcomes: { status: 'pending', resolved_at: null } })]
    STORED = [{ order_id: 'o1', status: 'pending' }]
    const user = await uploadAndPreview()

    expect(screen.getByText('Will set accepted — currently pending')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm 1 outcome update' }))

    await waitFor(() => expect(UPSERTS).toHaveLength(1))
    expect(UPSERTS[0]).toMatchObject({ order_id: 'o1', status: 'accepted' })
    expect(NOTIFICATIONS).toHaveBeenCalled()

    // The section must look different after a successful run.
    expect(await screen.findByText('Already accepted — nothing to change')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Nothing to update' })).toBeDisabled()
    expect(screen.getByText(/Updated 1/)).toBeInTheDocument()
  })

  it('writes an order that has no outcome row yet', async () => {
    ORDERS = [order()]
    STORED = []
    const user = await uploadAndPreview()

    expect(screen.getByText('Will set accepted — currently pending (no outcome recorded yet)')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm 1 outcome update' }))
    await waitFor(() => expect(UPSERTS).toHaveLength(1))
    expect(UPSERTS[0]).toMatchObject({ order_id: 'o1', status: 'accepted' })
  })

  it('leaves a non-final courier status alone', async () => {
    ORDERS = [order({ outcomes: { status: 'pending', resolved_at: null } })]
    STORED = [{ order_id: 'o1', status: 'pending' }]
    const user = userEvent.setup()
    render(<CourierImport stores={STORES} />)
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, new File(['Phone,Status\n03001234501,In Transit\n'], 'c.csv', { type: 'text/csv' }))
    await user.click(await screen.findByRole('button', { name: 'Preview matches' }))

    expect(await screen.findByText('“In Transit” is not a final delivery status — left unchanged')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nothing to update' })).toBeDisabled()
  })

  /*
   * "6 possible orders" on a store whose Outcomes screen showed none of them:
   * hiding an order only stamps `orders.deleted_at`, so the matcher used to
   * count hidden duplicates as real candidates.
   */
  it('ignores hidden orders when matching a phone number', async () => {
    ORDERS = [
      order({ id: 'o1', outcomes: { status: 'pending', resolved_at: null } }),
      order({ id: 'o2', deleted_at: '2026-10-21T10:00:00Z' }),
      order({ id: 'o3', deleted_at: '2026-10-21T10:00:00Z' }),
    ]
    STORED = [{ order_id: 'o1', status: 'pending' }]
    await uploadAndPreview()

    // Hidden duplicates are gone, so the visible order matches uniquely.
    expect(await screen.findByText('Will set accepted — currently pending')).toBeInTheDocument()
    expect(screen.queryByText(/share this phone/)).toBeNull()
  })

  it('still asks for review when several visible orders share the phone', async () => {
    ORDERS = [
      order({ id: 'o1', outcomes: { status: 'pending', resolved_at: null } }),
      order({ id: 'o2', outcomes: { status: 'pending', resolved_at: null } }),
    ]
    STORED = [
      { order_id: 'o1', status: 'pending' },
      { order_id: 'o2', status: 'pending' },
    ]
    await uploadAndPreview()

    expect(await screen.findByText('2 orders share this phone — check Orders before importing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nothing to update' })).toBeDisabled()
  })
})
