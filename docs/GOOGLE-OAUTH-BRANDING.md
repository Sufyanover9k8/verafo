# Making Google sign-in say "Verafo", not `gvjbolyoeisyjsphnwze.supabase.co`

The screen that shows the project domain is **Google's OAuth consent screen**, and
its heading comes from the Google Cloud project that owns the OAuth client. It is
not rendered by the app: nothing in `src/` prints the Supabase project ref (checked),
so no deploy can change it. Two dashboards have to be updated, in this order.

Everything below is free and does not need Google verification: the scopes we use
(`email`, `profile`) are non-sensitive, so an unverified app shows the name
immediately — only the "unverified app" copy disappears if you later request
verification.

---

## 1. Supabase — authenticate on our own client

Supabase Dashboard → **Authentication → Providers → Google**.

- If the **Client ID** starts with `445949309835-…`, that client belongs to
  Supabase's shared Google project, whose consent screen name cannot be edited.
  Replace it with your own:
  1. Google Cloud Console → **APIs & Services → Credentials → Create credentials →
     OAuth client ID → Web application**, name it `Verafo web`.
  2. **Authorized redirect URI** (exactly, no trailing slash):
     ```
     https://gvjbolyoeisyjsphnwze.supabase.co/auth/v1/callback
     ```
  3. **Authorized JavaScript origin:** `https://www.verafo.com` (optional for the
     redirect flow, harmless to add).
  4. Copy the Client ID + Client secret into the Supabase Google provider and save.
- If the Client ID is already your own, skip to step 2.

Keep **"Skip nonce checks" off** and the default scopes (`email profile`).

## 2. Google Cloud — the name on the screen

Google Cloud Console (same project as the client) → **APIs & Services →
OAuth consent screen** (older UI) or **Google Auth Platform → Branding** (newer UI).

| Field | Value |
|---|---|
| App name | **Verafo** |
| User support email | `verafo.support@gmail.com` |
| App logo | `public/assets/img/logo-*.webp` (square, ≤1 MB) |
| Application home page | `https://www.verafo.com` |
| Privacy policy | `https://www.verafo.com/privacy.html` |
| Terms of service | `https://www.verafo.com/terms.html` |
| Authorized domains | `verafo.com` (add `supabase.co` only if Google asks for it) |
| Developer contact email | `verafo.support@gmail.com` |

Publish the app (in **Testing** status only allow-listed testers can sign in; move it
to **In production**). Changes to the app name typically show up within
5–10 minutes, sometimes after a browser refresh in an incognito window.

> The consent screen will then read *"Choose an account — to continue to **Verafo**"*.
> The `…supabase.co` host stays in the underlying redirect, which users never see.

## 3. Supabase — let the redirect come back to /dashboard

Supabase Dashboard → **Authentication → URL Configuration**.

- **Site URL:** `https://www.verafo.com/dashboard`
- **Redirect URLs** must include:
  ```
  https://www.verafo.com/dashboard
  https://www.verafo.com/login
  ```

Why this matters: the app now asks Google/Supabase to return to
`${origin}/dashboard` (`src/pages/Auth.tsx`). If that URL is **not** allow-listed,
Supabase silently falls back to the Site URL when the merchant returns — which is
exactly the "signed in but back on the website" bug fixed in `2e6cd90`. The
`public/home.html` forwarder is the safety net for anything that still lands on `/`.

## 4. Check it end to end

1. Incognito → `https://www.verafo.com/login` → **Continue with Google**.
2. The consent screen must say **Verafo** and show the verafo.com privacy/terms links.
3. After choosing an account you must land on `https://www.verafo.com/dashboard`
   with the sidebar rendered — not on the marketing page.
4. Sign out, repeat with **email + password** (should go straight to `/dashboard`)
   and with a fresh signup (confirmation mail → `/dashboard`).
