/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_ADMIN_EMAILS?: string
  readonly VITE_DEMO_ADMIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
