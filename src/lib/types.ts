export interface Buyer {
  phone: string
  first_seen: string | null
  total_orders: number
  total_accepted: number
  total_refused: number
  risk_score: number
  /**
   * NOT returned to the browser any more. The raw 1536-dimension
   * fingerprint and the feature vector are personal data, so they stay in
   * the database and are used only inside SECURITY DEFINER functions.
   * Optional for that reason; UI must not rely on them.
   */
  embedding?: number[] | null
  feature_vector?: number[] | null
  updated_at?: string | null
  /** Distinct stores this buyer has ordered from. Aggregated, no identity. */
  store_count?: number | null
}

export interface Store {
  id: string
  name: string
  owner_email: string | null
  shopify_domain?: string | null
  category?: string | null
  contact_phone?: string | null
  created_at?: string | null
}

export interface StoreOverview {
  id: string
  name: string
  shopify_domain: string | null
  owner_email: string | null
  category?: string | null
  contact_phone?: string | null
  created_at: string | null
  orders: number
  accepted: number
  refused: number
  pending: number
  revenue: number
  buyers: number
  avg_order_value: number
  last_order_at: string | null
}

export interface DailySalesRow {
  day: string
  orders: number
  revenue: number
}

export interface NetworkKpis {
  stores: number
  buyers: number
  orders: number
  pending_orders: number
  today_orders: number
  today_revenue: number
  week_revenue: number
}

export interface StoreSearchRow {
  id: string
  name: string
  shopify_domain: string | null
  last_order_at: string | null
}

export type OutcomeStatus = 'accepted' | 'refused' | 'pending'

export interface OrderRow {
  id: string
  buyer_phone: string
  store_id: string
  product_category: string | null
  product_name: string | null
  price: number | null
  quantity: number | null
  address: string | null
  city: string | null
  ordered_at: string | null
  stores?: { name: string } | null
  outcomes?: { status: OutcomeStatus | null; resolved_at: string | null; refusal_reason: string | null } | null
}

export interface SimilarBuyer {
  risk_score: number
  total_orders: number
  total_refused: number
  similarity: number
  /**
   * Deliberately absent. The server no longer returns another buyer's phone
   * number to the browser, so a similarity result cannot become a contact
   * list for anyone's customers.
   */
  phone?: string
}

export interface ChatRow {
  id: string
  title: string
  phone: string | null
  last_message: string | null
  last_message_at: string | null
  created_at: string
  updated_at: string
  pinned?: boolean | null
}

export interface ChatMessage {
  id: string
  chat_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  phone: string | null
  created_at: string
}

export interface AnalyzeReport {
  risk_factors: string[]
  positive_factors: string[]
  recommendation: 'ship' | 'caution' | 'refuse'
  verdict: string
  confidence: 'low' | 'medium' | 'high'
}

export interface ChartDataset {
  label: string
  data: number[]
  format?: 'number' | 'pkr' | 'percent'
}

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie' | 'scatter' | 'histogram'
  title: string
  labels: string[]
  datasets: ChartDataset[]
}

export interface FileColumn {
  key: string
  label: string
  format?: 'number' | 'pkr' | 'percent' | 'text'
}

export interface FileSpec {
  kind: 'pdf' | 'csv' | 'xlsx' | 'excel'
  title: string
  description?: string
  columns: FileColumn[]
  rows: Record<string, string | number>[]
  chart?: ChartSpec | null
  generated_at: string
}
