# Technical Specification

Engineering reference for the Inbound Carrier Sales AI system. For the business-facing build description, see [build-description.md](build-description.md).

---

## API Endpoints

All endpoints (except `/health`) require `Authorization: Bearer <API_KEY>`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check (no auth) |
| `GET` | `/carrier/verify/:mc_number` | FMCSA carrier verification |
| `GET` | `/loads` | Search loads (geocoding + Haversine radius) |
| `GET` | `/loads/:id` | Get a specific load by ID |
| `POST` | `/negotiate` | Rate negotiation engine |
| `POST` | `/offers` | Log a negotiation round |
| `GET` | `/offers` | List all offer records |
| `POST` | `/offers/finalize` | Post-call metadata webhook |
| `GET` | `/timezone` | Local date/time for a city/timezone |
| `GET` | `/dashboard/metrics` | Aggregated analytics |

---

## Load Search (`GET /loads`)

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `origin` | string | City/state to search near — geocoded to lat/lng via Nominatim |
| `destination` | string | Filter by destination (substring match) |
| `equipment_type` | string | Filter by trailer type: `Dry Van`, `Reefer`, `Flatbed` |
| `pickup_date` | string | `YYYY-MM-DD` — returns loads on or after this date |
| `min_rate` | number | Minimum loadboard rate |
| `max_rate` | number | Maximum loadboard rate |
| `status` | string | Load status (defaults to `available`) |
| `limit` | number | Max results (default 50, capped at 100, final output capped at 5) |

**Geospatial Search:**

When `origin` is provided, the API geocodes it via Nominatim OpenStreetMap, then calculates Haversine distance (great-circle, in miles) to every load with lat/lng coordinates. Results are filtered to a 1,500-mile radius and sorted by proximity.

**Response enrichment:**

Each load in the response includes:
- `deadhead_miles` — empty miles from carrier's origin to load pickup
- `offer_rate` — 85% of `loadboard_rate` (the opening negotiation rate)
- `effective_rpm` — `offer_rate / (miles + deadhead_miles)` (carrier's effective earnings per mile)

**Search metadata:**

The response includes `search_meta` with `geo_search` (boolean), `radius_miles`, and `origin_searched`. When results are empty after a geo-search, a `note` field tells the agent not to retry with nearby cities.

---

## Negotiation Engine (`POST /negotiate`)

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `load_id` | string | Yes | Load being negotiated |
| `mc_number` | string | Yes | Carrier's MC number |
| `carrier_rate` | number | No | Carrier's counter-offer (omit for opening offer) |

**Rate ladder:**

```
FLOOR_PCT    = 0.85   (opening offer)
STEP2_PCT    = 0.90   (1st counter)
TARGET_PCT   = 0.95   (2nd counter)
CEILING_PCT  = 1.00   (final offer / max)
MAX_ROUNDS   = 3
```

All rates are derived from the load's `loadboard_rate`. The `buildLadder()` function rounds each step to the nearest dollar.

**Round tracking:**

Rounds are auto-calculated by counting prior `log_offer` records for the same `load_id` + `mc_number` pair. The prompt instructs the LLM to call `log_offer` before `negotiate`, so:
- DB round 1 = initial offer (no prior records)
- DB round 2 = 1st counter
- DB round 3 = 2nd counter
- DB round 4 = 3rd counter / final

**Response:**

| Field | Description |
|---|---|
| `action` | `offer`, `accept`, `counter`, `final_offer`, or `unavailable` |
| `rate` | Dollar amount to quote |
| `round` | Current round number |
| `message` | Internal guidance (not read to carrier) |

**Key logic:** If `carrierRate <= nextStepRate`, the engine accepts at `carrierRate` (never counters with a higher number than the carrier offered).

---

## Offer Logging (`POST /offers`)

**Request body:**

| Field | Type | Required |
|---|---|---|
| `load_id` | string | Yes |
| `mc_number` | string | Yes |
| `offered_rate` | number | Yes |
| `carrier_name` | string | No |
| `counter_rate` | number | No |
| `final_rate` | number | No |
| `status` | string | No (default: `pending`) |
| `equipment_type` | string | No |
| `lanes_requested` | string | No |
| `carrier_sentiment` | string | No |
| `call_outcome` | string | No |
| `key_objections` | string | No |
| `notes` | string | No |
| `session_id` | string | No |

`rounds` is auto-calculated from prior records — not accepted from the client.

When `status` is `accepted` and `final_rate` is set, the load's status is automatically updated to `booked`.

---

## Post-Call Finalize (`POST /offers/finalize`)

Updates the most recent offer record for a given `session_id` with post-call metadata:

| Field | Type | Description |
|---|---|---|
| `session_id` | string | Links to the call session |
| `duration` | number | Call duration in seconds |
| `sentiment` | string | AI-classified sentiment |
| `call_result` | string | AI-classified call result |
| `user_behavior` | string | AI-classified user behavior |
| `equipment_type` | string | Trailer type |

---

## Carrier Verification (`GET /carrier/verify/:mc_number`)

Queries the FMCSA SAFER Web API. Falls back to a mock response if the FMCSA API is unreachable (returns verified=true with synthetic data for testing).

Each verification is also logged as a `type: "verify"` record in the offers table for call volume tracking.

---

## Timezone (`GET /timezone`)

| Parameter | Type | Description |
|---|---|---|
| `city` | string | City and state (e.g. `Tampa, FL`) |
| `tz` | string | IANA timezone (e.g. `America/Denver`) |

Returns `timezone`, `zone_abbr`, `local_date`, `local_time`, `day_of_week`, and `tomorrow_date`. Uses a built-in state-to-timezone map and `Intl.DateTimeFormat`.

---

## Dashboard Metrics (`GET /dashboard/metrics`)

Returns a single JSON object with:

| Section | Contents |
|---|---|
| `kpis` | total_calls, booking_rate_pct, total_savings, avg_savings, avg_call_duration_sec |
| `funnel` | total_calls → verified → loads_found → negotiated → booked |
| `negotiation` | avg_rounds, avg_loadboard_rate, avg_our_offer, avg_final_rate, round_distribution |
| `outcome_breakdown` | Array of {outcome, count} |
| `sentiment_breakdown` | Array of {sentiment, count} |
| `equipment_breakdown` | Array of {equipment, count} |
| `user_behavior_breakdown` | Array of {behavior, count} |
| `top_lanes` | Array of {lane, deals, booked, avg_final, savings} |
| `top_carriers` | Array of {mc_number, carrier_name, calls, bookings} |
| `recent_activity` | Last 15 negotiations with full detail |
| `load_map` | All loads with lat/lng for map rendering |

**Data pipeline:**
- `verifications` (type=verify) count total inbound calls
- `allOffers` (type!=verify) are deduplicated by session for call-level stats
- Savings = `loadboard_rate - final_rate` for accepted offers where `final_rate > 0`
- Carrier names fall back from offer records to verify records
- Sentiment checks both `sentiment` (from finalize) and `carrier_sentiment` (from log_offer)

---

## Database

Two DynamoDB tables with on-demand capacity:

**`happyrobot-api-loads`** (partition key: `load_id`)

| Field | Type | Description |
|---|---|---|
| load_id | string | e.g. "LD-1001" |
| origin, destination | string | City names |
| lat, lng | number | GPS coordinates for geo-search |
| pickup_datetime, delivery_datetime | string | ISO format |
| equipment_type | string | Dry Van, Reefer, Flatbed |
| loadboard_rate | number | Market rate in dollars |
| miles | number | Load distance |
| weight, commodity_type, num_of_pieces, dimensions | various | Operational details |
| notes | string | Special handling instructions |
| status | string | available or booked |

**`happyrobot-api-offers`** (partition key: `id`)

Stores both negotiation rounds (`type` absent or null) and verification records (`type: "verify"`). Key fields: `id`, `load_id`, `mc_number`, `carrier_name`, `session_id`, `offered_rate`, `counter_rate`, `final_rate`, `status`, `rounds`, `call_outcome`, `carrier_sentiment`, `equipment_type`, `duration`, `sentiment`, `user_behavior`, `created_at`.

---

## Infrastructure (Terraform)

All resources are defined in `terraform/main.tf`:

| Resource | Purpose |
|---|---|
| `aws_ecr_repository` | Docker image storage |
| `aws_apprunner_service` | Container runtime (1024 CPU, 2048 MB, port 3000) |
| `aws_iam_role` (access) | Allows App Runner to pull from ECR |
| `aws_iam_role` (instance) | Allows container to access DynamoDB |
| `aws_dynamodb_table` x2 | loads and offers tables |

Environment variables injected into App Runner: `API_KEY_SECRET`, `FMCSA_API_KEY`, `DYNAMODB_LOADS_TABLE`, `DYNAMODB_OFFERS_TABLE`.

---

## Deployment

```bash
./deploy.sh           # Build, push, deploy
./deploy.sh --plan    # Dry run
./deploy.sh --destroy # Tear down all resources
```

The script auto-detects the AWS account, validates against Terraform state, waits for App Runner to become idle before applying changes, and forces a new deployment after apply.

---

## Seed Data

30 loads across major US markets. Pickup dates are dynamically generated 1-7 days in the future on each deploy. See `src/seed.js`.
