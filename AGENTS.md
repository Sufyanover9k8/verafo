# AGENTS.md — working on the Verafo dashboard

Read this before changing anything. It is written for an AI coding agent and for
a human doing **UI/UX work only**. Everything here was learned the expensive way
in this repo; ignoring a rule has already cost a debugging session at least once.

## What this is

The Verafo COD-risk dashboard. React 19 + Vite 6 + TypeScript, Tailwind **v4**
with shadcn/Radix primitives, react-router 7. Data comes from Supabase
(Postgres + RLS + RPCs), never from a bespoke API layer.

`apps/shopify/` is a separate Remix app and `supabase/functions/` is a Deno edge
function. **Neither is part of the dashboard.** Do not touch them.

## Commands

```bash
npm install
npm run dev      # real app, needs .env (see below)
npm run lint     # must exit 0. Warnings are tolerated, errors are not.
npx tsc --noEmit -p tsconfig.app.json   # types
npx vitest run   # 328 tests must stay green
npm run build    # tsc -b && vite build
```

**Preview without credentials — use this constantly:**

```bash
npx vite --config vite.preview.config.ts --port 5199
# http://localhost:5199/?as=merchant   → merchant fixtures
# http://localhost:5199/?onboard-merchant → brand-new merchant, empty book
```

It swaps `src/lib/supabase.ts` for `dev/mock/supabase.ts`: every screen renders
with fixture data, no sign-in, no network. It is dev-only and never shipped.

## Access

Frontend work needs **GitHub only**. Do not request Supabase, Vercel, Shopify or
Google credentials — a merged pull request is enough to ship UI.

## Do not change these without asking

- `supabase/*.sql` — migrations are pasted into the Supabase SQL editor by hand.
  A UI change that needs a new column will silently break at runtime.
- Table or RPC names, and the `.select()` column lists. If a design needs a field
  that is not fetched, that is a backend change, not a UI change.
- `src/lib/supabase.ts`, `src/lib/session.ts`, `src/lib/store.ts`, `src/lib/admin.ts`
- `supabase/functions/**`, `apps/shopify/**`, `vercel.json`, `.env*`

## Design system — the rules that are not negotiable

All colour lives in `src/styles/tokens.css` and is mapped to utility classes in
`src/styles/shadcn-theme.css`. **Never write a raw hex value in a component.**
If a token is missing, add it in both files.

- Brand teal `#14B8A6` is **not** a surface colour: white text on it is 2.49:1.
  Surfaces use `--teal-nav` / `var(--teal-700)` (white on it is 5.47:1). The top
  bar and sidebar share `--teal-nav` on purpose; the content area stays white.
- Risk vocabulary is fixed and used system-wide: `NEUTRAL`, `SAFE`, `MEDIUM`,
  `HIGH`. One component (`src/components/app/verdict-badge.tsx`) renders it.
  A buyer with no resolved orders shows **NEUTRAL with no numeral** — never
  invent `0.5`, and `~` marks fewer than three resolved orders.
- Body text is `14px` / `1.5`. Cards use `--r-card` (12px). Buttons are `h-11`
  on a phone and `md:h-9` on desktop so touch targets stay legal — the mobile
  height is the real one, not a fallback.
- Every icon-only button needs `aria-label`. Focus rings come from
  `src/styles/tailwind.css`; do not remove them.

## Layout lessons (each one fixed a real bug)

- **Action buttons in a list:** the facts column must carry `flex-1`. Without it
  the Accept/Refuse pair sits wherever the text ends and the column zig-zags
  down the page. On phones give the action group `basis-full` so it drops to its
  own line instead of squeezing the text into a 40px column.
- **Tables** scroll inside their own container (`overflow-x-auto`); the page must
  never scroll sideways. On phones, filters start collapsed.
- **Skeletons and any random value** must not call `Math.random()` during render
  (React purity lint fails it). Use a constant.
- Long product names, city names and phone numbers must truncate, not wrap the
  row into three lines.

## Data gotchas that will bite a UI change

- **Phone numbers have no single spelling.** Stored as `+92…`, `0…` or bare ten
  digits. Any matching anywhere in the UI compares the **last ten digits**
  (`phoneKey()`), never raw strings.
- When creating or updating a buyer/order, reuse the stored spelling via
  `src/lib/buyer-key.ts` (`resolveBuyerPhone`). Writing a normalised value
  creates a duplicate buyer.
- Deleting an order **hides** it: `orders.deleted_at` is stamped, the row is
  never removed (the order book is the model's training set). Every order list
  filters `deleted_at is null` through `src/lib/ui/order-visibility.ts`.
- If a screen needs new fields, add them to `dev/mock/supabase.ts` too, or the
  preview shows an empty state and you will debug a non-bug.

## Editing files

- Use the editor tool / `apply_patch`. **Never rewrite a file with PowerShell**
  (`Get-Content` + `Set-Content`, `-replace`) — it has silently corrupted UTF-8
  in this repo before, turning `·` into `Â·` and mangling backticks. If a
  PowerShell write is unavoidable, use
  `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`.
- Use the read tool to inspect files, `rg`/grep to search. Do not `cat`.

## Shipping

Branch off `release/redesign-privacy`, open a pull request. Once the Vercel
project is connected to the repo (Settings → Git), a merge to that branch is the
deploy. If you ever deploy by hand, the team scope is required or you get
`Not authorized`:

```bash
npx vercel --prod --yes --scope sufyankhan210501035-6763s-projects
```

A merged pull request updates **the dashboard only**. It does not run SQL, deploy
the edge function, or deploy the Shopify app.
