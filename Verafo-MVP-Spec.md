# Verafo MVP — Build Specification

**Stack:** Supabase (database + auth + API) · OpenAI GPT API (embeddings + scoring assist) · React (frontend)
**Goal of this MVP:** Prove that a shared, phone-keyed buyer profile can predict COD refusal risk across stores — using nothing more than order logs and delivery outcomes. No WhatsApp API yet. No chat reading. Just the four core datasets, tied to a phone number.

> This is a **proof-of-concept**, not a production system. The point is to show a working risk score on real Sanicore data and demo the cross-store idea. Keep it small.

---

## 1. What this MVP actually does

Three screens and one background job:

1. **Log an order** — a seller (you, on Sanicore) types in a new order: phone, product, price, address, store. Instantly see that buyer's risk score and history.
2. **Mark the outcome** — after delivery, mark the order "accepted" or "refused."
3. **Buyer lookup** — type any phone number, see its full cross-store profile and score.
4. **Background:** when outcomes are logged, recompute that phone number's risk score and (optionally) refresh its embedding.

That's the whole MVP. If it can show "this phone has refused 6 of 8 orders across 2 stores, risk = HIGH" before you ship, it has proven the concept.

---

## 2. Why each tool is used

- **Supabase** — your database (Postgres), your API (auto-generated REST), and your login system, all in one. It also has `pgvector` built in, which lets you store and search the AI embeddings directly in the database. This is the big reason Supabase fits: you don't need a separate vector database.
- **GPT API (OpenAI)** — two jobs. (a) Turn each buyer's order history into a vector embedding (a list of numbers representing their behaviour). (b) Optionally, help generate a plain-English explanation of why a buyer is risky.
- **React** — the seller-facing website where orders get typed in and scores get shown.

---

## 3. Database schema (Supabase / Postgres)

Four core tables plus one for the embeddings. Copy these into the Supabase SQL editor.

```sql
-- Enable the vector extension (for AI embeddings)
create extension if not exists vector;

-- 1. STORES — each connected seller
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_email text,
  created_at timestamptz default now()
);

-- 2. BUYERS — one row per unique phone number (the anchor of everything)
create table buyers (
  phone text primary key,                 -- the key that ties all data together
  first_seen timestamptz default now(),
  total_orders int default 0,
  total_accepted int default 0,
  total_refused int default 0,
  risk_score numeric default 0.5,         -- 0 = safe, 1 = high risk. starts neutral.
  embedding vector(1536),                 -- the AI behavioural fingerprint (nullable until enough history)
  updated_at timestamptz default now()
);

-- 3. ORDERS — every order placed, the core behavioural log
create table orders (
  id uuid primary key default gen_random_uuid(),
  buyer_phone text references buyers(phone),
  store_id uuid references stores(id),
  product_category text,                  -- e.g. "skincare", "clothing", "electronics"
  product_name text,
  price numeric,
  quantity int default 1,
  address text,
  city text,
  ordered_at timestamptz default now()
);

-- 4. OUTCOMES — what happened to each order (the risk signal)
create table outcomes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) unique,
  status text check (status in ('accepted','refused','pending')) default 'pending',
  refusal_reason text,                    -- optional, phase 2
  delivery_attempts int default 1,
  resolved_at timestamptz
);
```

**Why these four (plus buyers):** they are the minimum needed to answer "should this seller trust this order?" — what was ordered, where, when, and what happened. Everything else in the full product layers on top of this same spine later.

---

## 4. The risk score (start simple, no AI needed at first)

Before you even touch the GPT API, you can produce a useful score with basic arithmetic. Build this first.

**Rule-based score (v0 — build this on day one):**

```
For a given phone number:
  if total_orders == 0:
      score = 0.5   (unknown, neutral — new buyer)
  else:
      refusal_rate = total_refused / total_orders
      score = refusal_rate, adjusted by confidence:
        - if total_orders < 3, pull score toward 0.5 (not enough data yet)
        - if total_orders >= 3, trust the refusal_rate more
```

Add simple signal boosters:
- Address never seen before → +0.05 risk
- Phone number seen for the first time today → +0.05 risk
- Buyer has accepted 5+ orders across 2+ stores → strong trust, -0.2 risk

This alone is a demoable product. It already does something no single-store tool does: it counts refusals **across stores**.

**The AI layer (v1 — add once v0 works):**
Use GPT embeddings to catch patterns the simple rules miss — e.g. "buyers who order electronics late at night to brand-new addresses refuse more often." See section 6.

---

## 5. React frontend — the three screens

Keep it minimal. Three pages, plain forms. Use the Supabase JS client to read/write.

### Screen 1 — New Order
A form with fields: `phone, product_category, product_name, price, quantity, address, city`.
On submit:
1. Upsert the buyer (create the phone row if new).
2. Insert the order.
3. **Immediately** fetch and display that buyer's current score + history in a panel beside the form.

The magic moment: seller types the phone, and before they even finish the order, a badge appears — **green (safe) / amber (caution) / red (high risk)** — with a line like "12 orders, 1 refusal across 3 stores."

### Screen 2 — Mark Outcome
A list of orders with status `pending`. Each has two buttons: **Accepted** / **Refused**.
On click:
1. Update the outcome row.
2. Recompute the buyer's totals and risk score.
3. (v1) Trigger an embedding refresh.

### Screen 3 — Buyer Lookup
A single search box for a phone number. Shows:
- The risk badge and score.
- Totals: orders, accepted, refused, number of distinct stores.
- A timeline of past orders (what, when, which store, outcome).
- (v1) A GPT-generated one-line explanation: *"This buyer reliably accepts orders and shops across multiple stores — low risk."*

---

## 6. The AI / embedding layer (v1)

This is where the GPT API comes in. Two uses.

### 6a. Turning a buyer into an embedding
When a buyer has enough history (say, 3+ orders), build a short text summary of their behaviour and send it to OpenAI's embedding endpoint. You get back a `vector(1536)` you store in `buyers.embedding`.

**Example — the text you'd embed:**
```
Buyer with 8 total orders across 3 stores. Categories: skincare (5), clothing (3).
Average order value 2200 PKR. Usually orders evening hours. Accepted 7, refused 1.
Addresses in Lahore, consistent. Repeat buyer.
```

You send that string to the embedding API; you store the vector it returns. Similar buyers end up with similar vectors.

**Why bother?** Once you have embeddings for many buyers, a **brand-new** buyer with only 1-2 orders can be scored by finding the most similar past buyers (nearest vectors) and seeing how *they* behaved. This is the "predict before enough history exists" capability — the core differentiator — and `pgvector` does the similarity search inside Supabase:

```sql
-- find the 5 most behaviourally-similar buyers to a given embedding
select phone, risk_score
from buyers
where embedding is not null
order by embedding <-> $1   -- $1 = the new buyer's embedding
limit 5;
```

### 6b. Plain-English explanations (optional, nice for demos)
Send the buyer's stats to the GPT chat endpoint with a prompt like *"In one sentence, explain this buyer's reliability for a shop owner."* Display the response on the lookup screen. Purely for polish — great in a NICAT demo, not core to the logic.

> **Cost note:** embeddings are very cheap; chat completions cost a little more. For an MVP on Sanicore's order volume, this is a few dollars, not a real concern.

---

## 7. Build order (do it in this sequence)

1. **Supabase project** — create it, run the schema SQL, add yourself as a store row.
2. **Screen 1 (New Order)** — get orders saving to the database. No score yet.
3. **Screen 2 (Mark Outcome)** — get outcomes saving, and recompute buyer totals.
4. **Rule-based score (v0)** — wire the simple arithmetic score into Screens 1 and 3. **At this point you have a working, demoable MVP.**
5. **Screen 3 (Buyer Lookup)** — the cross-store profile view.
6. **Seed real data** — enter a few weeks of real Sanicore orders and their outcomes. This is your proof.
7. **(v1) Embeddings** — add the GPT embedding layer and nearest-neighbour scoring once v0 is solid.
8. **(v1) GPT explanations** — add the plain-English summary for demo polish.

Steps 1-6 are the real MVP. Steps 7-8 are the "AI story" upgrade for the pitch.

---

## 8. What this MVP deliberately leaves out

Keeping scope tight is the whole point. **Not** in this MVP:
- WhatsApp Business API integration (sellers type orders in manually for now).
- Reading chat content (never — that's the privacy landmine).
- Retail media / ads (that's a large-network, later-phase business).
- The reputation passport / consumer-facing side.
- Multi-seller onboarding at scale (you are seller #1 — Sanicore).
- Real courier integration for automatic outcome marking (marked by hand for now).

Every one of these is a real part of the full product. None of them is needed to prove the core idea.

---

## 9. The one sentence this MVP has to earn

> "Type in a phone number, and before you ship, Verafo tells you how likely this buyer is to accept the parcel — based on how they've behaved across every connected store, not just yours."

If the MVP can do that on real Sanicore data, it has proven the thesis and is ready to show a technical co-founder and NICAT.

---

## 10. Environment / keys checklist

- Supabase project URL + anon key (frontend) and service key (server-side writes).
- OpenAI API key (keep server-side, never in the React bundle).
- A tiny serverless function (Supabase Edge Function works) to call OpenAI, so your API key is never exposed in the browser.

**Security note:** never put the OpenAI key or the Supabase service key in frontend React code — both must live in a server-side function. The frontend only ever uses the Supabase anon key with row-level security enabled.
