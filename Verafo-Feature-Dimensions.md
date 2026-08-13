# Verafo — Feature Dimension Specification (for Embedding & Risk Model)

**Purpose of this document:** This is an implementation reference listing every candidate data point (feature/dimension) that can feed the Verafo buyer embedding and risk-scoring system. It is written to be injected directly into an AI coding assistant working on the existing Verafo system (Supabase + GPT API + React).

**How to read each entry:**
- **Field name** — suggested column/feature name (snake_case).
- **Type** — how it is stored/represented numerically.
- **Encoding** — how to convert it into a model-usable number.
- **Signal** — what it tells the system / why it predicts behaviour.
- **Phase** — `MVP` (build now), `P2` (after some scale), `P3` (large network / advanced).

**Global rules for the implementing AI:**
1. Every numeric feature must be **normalized** (min-max to [0,1] or standardized) before being placed in the raw feature vector. Do not feed raw magnitudes.
2. **Cyclical features** (hour of day, day of week, month) must be encoded as `sin`/`cos` pairs, NOT as a single integer, so that hour 23 and hour 0 are treated as adjacent.
3. **Categorical features** start as one-hot in MVP; upgrade to learned category embeddings in P2 without changing the source schema.
4. **Never** embed raw WhatsApp message text content. Only structured metadata about messaging (timestamps, counts, booleans) is permitted. This is a hard privacy rule.
5. All features are keyed to `buyer_phone`. The embedding represents one buyer, aggregated across all their orders and all connected stores.
6. Features marked "per-order" are aggregated (mean / rate / most-recent) when building the buyer-level vector; features marked "buyer-level" are already aggregate.

---

## GROUP A — Order Timing

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `order_hour` | cyclical | sin/cos of hour (0-23) | Late-night orders correlate with impulse buys and higher refusal. Business-hours orders skew more reliable. | MVP |
| `order_dayofweek` | cyclical | sin/cos of day (0-6) | Weekend vs weekday ordering patterns; some refusal clustering by day. | MVP |
| `order_month` | cyclical | sin/cos of month (1-12) | Seasonality (Eid, sales seasons) affects buyer mix and refusal rates. | P2 |
| `is_weekend` | boolean | 1/0 | Simpler weekend flag; useful even before full cyclical encoding. | MVP |
| `days_since_last_order` | numeric | normalized days | Long gaps may indicate a lapsed or one-off buyer; short gaps indicate an engaged repeat buyer. | P2 |
| `order_sequence_number` | numeric | normalized count | Is this their 1st order or their 20th? First orders are higher-risk than established ones. | MVP |

---

## GROUP B — Order Value & Basket

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `order_value` | numeric | normalized (log-scaled) | Very high or very low values relative to a buyer's norm can flag anomalies. | MVP |
| `avg_order_value` | buyer-level numeric | normalized | A buyer's typical spend level; part of their identity. | MVP |
| `order_value_vs_personal_avg` | numeric | ratio, normalized | A sudden order far above a buyer's usual spend can be a fraud/refusal signal. | P2 |
| `item_count` | numeric | normalized | Number of items in this order. | MVP |
| `avg_item_count` | buyer-level numeric | normalized | Typical basket size; single-item vs multi-item buyer behaviour differs. | MVP |
| `price_sensitivity` | buyer-level numeric | derived score | Does this buyer only order on discount? Derived from discount usage over time. | P3 |
| `used_discount` | boolean | 1/0 | Discount-driven orders can have different refusal profiles than full-price. | P2 |

---

## GROUP C — Product / Category

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `product_category` | categorical | one-hot (MVP) -> learned embedding (P2) | Core preference dimension; some categories refuse more (e.g. impulse fashion) than others (e.g. essentials). | MVP |
| `category_diversity` | buyer-level numeric | count of distinct categories, normalized | Buyers who purchase across many categories behave differently from single-category buyers. | P2 |
| `dominant_category` | categorical | one-hot | The buyer's most-frequent category — their primary shopping identity. | P2 |
| `category_affinity_vector` | vector | learned per-buyer category distribution | Full preference profile powering recommendations & lookalikes. | P3 |
| `is_new_category_for_buyer` | boolean | 1/0 | First time this buyer orders in this category; slightly higher uncertainty. | P2 |

---

## GROUP D — WhatsApp / Messaging Metadata (NO message content — metadata only)

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `replied_to_automsg` | boolean | 1/0 | Did the buyer respond to the automated confirmation message? Non-responders refuse far more often. High-value signal. | MVP |
| `time_to_reply_min` | numeric | normalized (log-scaled) | Fast repliers are more engaged and accept more; slow/no repliers are higher risk. | P2 |
| `msg_count_before_order` | numeric | normalized | Number of messages exchanged before ordering. Very high or very low counts can both signal risk (indecisive vs impulsive). | P2 |
| `buyer_initiated_contact` | boolean | 1/0 | Did the buyer message first (high intent) or only respond to outreach (lower intent)? | P2 |
| `sent_voice_note` | boolean | 1/0 | Voice-note senders show higher commitment in some segments; experimental. | P3 |
| `confirmation_response_speed` | numeric | normalized | Speed of confirming the specific order (distinct from general reply time). | P2 |
| `whatsapp_read_no_reply` | boolean | 1/0 | Message was read (blue ticks) but not replied to — a distinct disengagement signal. | P3 |

> Implementation note: all of GROUP D comes from WhatsApp Business API **structured events and timestamps only**. Never parse or store the text of the conversation.

---

## GROUP E — Delivery Outcome (the core risk labels)

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `outcome_status` | categorical | accepted=1 / refused=0 (the label) | THE core training label. Everything else predicts this. | MVP |
| `refusal_rate` | buyer-level numeric | refused / total, normalized with confidence weighting | The single strongest risk feature at buyer level. | MVP |
| `acceptance_streak` | buyer-level numeric | consecutive accepts, normalized | A long clean streak is strong trust; a recent refusal breaks it. | P2 |
| `refusal_reason` | categorical | one-hot | "Not home" vs "denied ordering" vs "changed mind" carry very different meanings. | P2 |
| `delivery_attempts` | numeric | normalized | Buyers who repeatedly need multiple attempts cost more even if they eventually accept. | P2 |
| `delivery_time_days` | numeric | normalized | Long delivery windows increase refusal; used to separate buyer-fault from logistics-fault refusals. | P2 |

---

## GROUP F — Address / Location Intelligence

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `city` | categorical | one-hot | Baseline geographic risk differences. | MVP |
| `address_seen_before` | boolean | 1/0 | Has this exact address received successful deliveries before? Known-good addresses are low risk. | MVP |
| `address_success_count` | numeric | normalized | How many successful deliveries this address has accumulated across the network. | P2 |
| `address_completeness_score` | numeric | 0-1 derived | Complete address with landmarks vs vague ("near masjid"). Vague addresses refuse/fail more. | P2 |
| `address_refusal_history` | numeric | normalized | Refusal rate associated with this specific address (independent of the phone). | P2 |
| `distinct_addresses_for_phone` | numeric | normalized | One phone using many different addresses can be a fraud signal. | P3 |
| `geo_cluster` | categorical | learned area cluster | Neighbourhood-level risk patterns beyond city level. | P3 |

---

## GROUP G — Phone / Identity Metadata

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `phone_age_in_network_days` | numeric | normalized | How long Verafo has known this number. Older = more trusted. | MVP |
| `is_on_whatsapp` | boolean | 1/0 | In Pakistan, near-universal; absence is a mild anomaly. | MVP |
| `number_active` | boolean | 1/0 | Disconnected/inactive SIM is a strong fraud signal. | P2 |
| `distinct_stores_ordered_from` | numeric | normalized | Active across many stores = real, serious shopper; single-store one-off = higher uncertainty. | MVP |
| `total_orders_network` | buyer-level numeric | normalized | Total lifetime orders across the whole network — confidence weight for all other signals. | MVP |
| `cnic_verified` | boolean | 1/0 | Whether the number is CNIC-linked (baseline true in PK, but flaggable). | P2 |

---

## GROUP H — Behavioural / Derived (buyer-level, computed over history)

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `reorder_rate` | numeric | normalized | How often this buyer comes back. Loyalty and reliability proxy. | P2 |
| `cross_store_reorder` | boolean | 1/0 | Has reordered the same category from different stores — strong genuine-demand signal. | P2 |
| `avg_days_between_orders` | numeric | normalized | Purchase rhythm; regular cadence = engaged buyer. | P2 |
| `night_order_ratio` | numeric | normalized | Share of this buyer's orders placed late at night. | P2 |
| `impulse_score` | numeric | derived 0-1 | Composite: fast order + no questions + late night + new category. | P3 |
| `engagement_score` | numeric | derived 0-1 | Composite of reply speed, message initiation, reorder rate. | P3 |
| `lifetime_value` | numeric | normalized | Total accepted order value to date; separates high-value reliable buyers. | P2 |
| `churn_risk` | numeric | derived 0-1 | Trajectory signal: was active, now going quiet. | P3 |

---

## GROUP I — Acquisition / Source (requires seller cooperation)

| Field | Type | Encoding | Signal | Phase |
|---|---|---|---|---|
| `acquisition_channel` | categorical | one-hot | Facebook ad vs Instagram organic vs referral — channels produce different refusal rates. | P2 |
| `is_referral` | boolean | 1/0 | Referred buyers tend to be more reliable than cold-ad buyers. | P2 |
| `first_touch_campaign` | categorical | one-hot | Which specific campaign brought them; ties refusal cost back to ad spend. | P3 |

---

## IMPLEMENTATION SUMMARY FOR THE AI

**MVP raw feature vector** — build from all `MVP`-tagged fields only. Expect roughly 15-25 numeric slots after one-hot encoding of category/city and sin/cos encoding of time. This raw vector alone supports nearest-neighbour "similar buyer" lookups and a rule-based risk score with zero model training.

**Vector construction steps (per buyer):**
1. Pull all orders + outcomes + metadata for the `buyer_phone`.
2. Compute per-order features; aggregate to buyer level (mean / rate / most-recent as noted).
3. One-hot encode categoricals; sin/cos encode cyclicals; normalize all numerics.
4. Concatenate into the raw feature vector.
5. (P2+) Pass the raw vector through the trained embedding model to produce the learned embedding (target size 32-128 dims). Store in `buyers.embedding`.

**Cold-start rule:** if `total_orders_network < 3`, do not trust the learned embedding — fall back to a rule-based score built from `address_seen_before`, `phone_age_in_network_days`, `city`, `order_hour`, and `replied_to_automsg`. Blend toward the embedding score as order count crosses the threshold.

**Update cadence:**
- Recompute a buyer's raw vector + embedding on **every new order or outcome event** (cheap, instant).
- Retrain the embedding model itself **periodically** (weekly/monthly) as outcome data accumulates. Do NOT retrain the model on every event.

**Label for supervised training:** `outcome_status` (accepted/refused). All predictive features are optimized to predict this.

**Hard constraints:**
- Do NOT embed WhatsApp message text — metadata only (GROUP D).
- Normalize every numeric before vectorizing.
- Keep the OpenAI / Supabase service keys server-side only.
- Pool signals, not identities: a store may query a score/flag for a phone it transacts with, never another store's raw customer list.
