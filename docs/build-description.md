# Inbound Carrier Sales AI Agent — Build Description

**Prepared for:** Acme Logistics
**Prepared by:** Jan van der Horst
**Date:** March 2026

---

## Executive Summary

This document describes the design, implementation, and deployment of an AI-powered inbound carrier sales system built for Acme Logistics. The system handles inbound phone calls from carriers looking to book freight loads. It verifies carrier authority via FMCSA, matches carriers with available loads using geospatial search, negotiates rates through a structured 3-round engine, and provides a real-time analytics dashboard for operations management.

The entire system is production-ready: deployed on AWS via Terraform, integrated with the HappyRobot voice AI platform, and accessible through a single inbound phone number.

---

## Architecture Overview

```
Carrier Phone Call
       │
       ▼
┌─────────────────────┐
│  HappyRobot Platform │
│  (Voice AI Agent)    │
│                      │
│  ┌────────────────┐  │
│  │ Prompt + Tools │  │──── verify_carrier ────► GET  /carrier/verify/:mc
│  │                │  │──── search_loads ──────► GET  /loads?origin=...
│  │                │  │──── negotiate ─────────► POST /negotiate
│  │                │  │──── log_offer ─────────► POST /offers
│  │                │  │──── get_timezone ──────► GET  /timezone?city=...
│  │                │  │──── transfer_to_sales ─► Direct Transfer
│  └────────────────┘  │
│                      │
│  Real-time classifiers│
│  (sentiment, outcome) │
└──────────┬───────────┘
           │ POST /offers/finalize
           ▼
┌─────────────────────┐     ┌──────────────┐
│  Node.js / Express  │────►│  DynamoDB    │
│  (AWS App Runner)   │     │  (loads,     │
│                     │     │   offers)    │
│  ┌───────────────┐  │     └──────────────┘
│  │ Static Files  │  │
│  │ (Dashboard)   │  │     ┌──────────────┐
│  └───────────────┘  │────►│  FMCSA API   │
│                     │     └──────────────┘
│                     │     ┌──────────────┐
│                     │────►│  Nominatim   │
│                     │     │  (Geocoding) │
└─────────────────────┘     └──────────────┘
```

**Technology Stack:**

| Layer | Technology |
|---|---|
| Voice AI | HappyRobot Platform (GPT-4.1, real-time classifiers) |
| API | Node.js 20, Express.js |
| Database | AWS DynamoDB (two tables: loads, offers) |
| Compute | AWS App Runner (auto-scaling, managed HTTPS) |
| Container Registry | AWS ECR |
| Infrastructure as Code | Terraform |
| External APIs | FMCSA SAFER (carrier verification), Nominatim OpenStreetMap (geocoding) |
| Dashboard | HTML5, DaisyUI, Tailwind CSS, Chart.js, Leaflet.js |

---

## Feature Breakdown

### 1. Carrier Verification

**Endpoint:** `GET /carrier/verify/:mc_number`

When a carrier calls in, the first step is verifying their FMCSA operating authority. The API queries the FMCSA SAFER system with the carrier's MC number and returns:

- Legal name, DBA name, and physical address
- Operating status and authorization flags
- A boolean `verified` field indicating whether the carrier is authorized to operate

Unauthorized carriers are informed of the specific reason (e.g., "Out of Service," "Not Authorized") and the call ends gracefully. Each verification is also logged to the offers table for accurate call volume tracking.

### 2. Intelligent Load Search

**Endpoint:** `GET /loads`

The load search system combines text filtering with geospatial intelligence:

- **Geocoding:** The carrier's origin city is geocoded via the Nominatim OpenStreetMap API to get latitude/longitude coordinates.
- **Haversine Distance:** Every load in the database is compared against the carrier's position using the Haversine formula, calculating great-circle distance in miles.
- **Radius Filter:** Only loads within a 1,500-mile radius are returned, sorted by proximity (closest first).
- **Smart Filtering:** Results can be filtered by equipment type, destination, pickup date (treated as "on or after"), and rate range. Loads with past pickup dates are automatically excluded.
- **Enriched Response:** Each result includes `deadhead_miles` (empty miles to the load), `offer_rate` (85% of market rate for pitching), and `effective_rpm` (earnings per mile including deadhead).
- **Search Metadata:** The response includes `search_meta` indicating whether a geo-search was performed and its radius, preventing the agent from redundantly searching nearby cities.

**Query Parameters:**

| Parameter | Description |
|---|---|
| `origin` | City/state to search near (geocoded to coordinates) |
| `destination` | Filter by destination city |
| `equipment_type` | Filter by trailer type (Dry Van, Reefer, Flatbed) |
| `pickup_date` | Earliest pickup date (YYYY-MM-DD, returns loads on or after) |

### 3. Automated Negotiation Engine

**Endpoint:** `POST /negotiate`

Rate negotiation is handled entirely server-side — the AI agent never calculates rates or makes pricing decisions. The engine implements a structured 3-round negotiation ladder:

| Round | Our Offer | % of Market Rate |
|---|---|---|
| Opening offer | Floor | 85% |
| 1st counter | Step 2 | 90% |
| 2nd counter | Target | 95% |
| Final offer | Ceiling | 100% |

**Key behaviors:**

- The agent's first call (no `carrier_rate`) returns the opening offer at 85% of market.
- Each subsequent call with the carrier's counter-rate returns an `action`: `accept`, `counter`, or `final_offer`.
- The engine never offers more than the carrier asked for — if the carrier's rate is below the next step, it accepts at their rate.
- The first counter-offer is never accepted automatically; the engine always pushes back at least once.
- Round tracking is automatic — the API counts prior `log_offer` records for the same load + carrier pair.
- After 3 rounds, the engine issues a `final_offer` at ceiling (100% of market). If rejected, the agent offers to search a different lane.

### 4. Offer Logging and Post-Call Processing

**Endpoints:** `POST /offers`, `POST /offers/finalize`

Every rate exchange during a call is logged as an individual record, creating a complete negotiation history:

- `POST /offers` — Called by the agent after every offer/counter/acceptance. Records offered rate, counter rate, final rate, status, carrier name, equipment type, lane, sentiment, and key objections. Round number is auto-calculated from prior records.
- `POST /offers/finalize` — Called by HappyRobot's post-call webhook. Stamps the final call metadata onto the most recent offer record: duration, sentiment, call result, user behavior, and equipment type.

When a load is booked (status = "accepted"), the load's status is automatically updated to "booked" in the loads table.

### 5. Timezone Resolution

**Endpoint:** `GET /timezone`

The US spans multiple timezones. When a carrier says "I want a load tomorrow," the system needs to know what "tomorrow" means in their location. The timezone tool:

- Maps city/state input to IANA timezone identifiers
- Returns the local date, time, day of week, and tomorrow's date
- The agent calls this after learning the carrier's origin to correctly interpret relative dates

### 6. Real-Time Analytics Dashboard

**URL:** `/dashboard.html`

A single-page dashboard built with DaisyUI (dark theme), Chart.js, and Leaflet.js. It fetches live data from `GET /dashboard/metrics` and renders:

**KPI Cards:**
- Total Calls (from carrier verifications)
- Booking Rate (%)
- Total Savings vs. market rates
- Avg Savings per Deal
- Avg Negotiation Rounds
- Avg Call Duration

**Conversion Funnel:**
Total Calls → Verified → Loads Found → Negotiated → Booked (with drop-off percentages)

**Charts and Visualizations:**
- **Load Origins Map** — Interactive Leaflet map plotting all load origins with color-coded markers (green = booked, blue = available). Popups show rate, pickup date, equipment, and status.
- **Rate Waterfall** — Bar chart comparing average Market Rate → Our Offer → Final Rate for booked deals.
- **Negotiation Rounds** — Distribution of deals closed in 1, 2, or 3 rounds.
- **Equipment Mix** — Doughnut chart of trailer types across negotiations.
- **Carrier Sentiment** — Doughnut chart of sentiment classifications (positive, neutral, frustrated).
- **Call Outcomes** — Doughnut chart of call results (booked, rejected, callback, etc.).

**Tables:**
- **Top Lanes** — Most active lanes with deal count, bookings, average final rate, and savings.
- **Top Carriers** — Most active carriers with MC number, name, call count, bookings, and conversion rate.
- **Recent Activity** — Live feed of the latest negotiations with status badges, user behavior indicators, rates, rounds, and duration.

---

## HappyRobot Platform Integration

The voice agent is configured on the HappyRobot platform as an inbound voice agent workflow with:

**Voice Agent Configuration:**
- GPT-4.1 model with a professional carrier sales persona ("Alex")
- Key terms for transcription accuracy: MC, DOT, reefer, flatbed, dry van, deadhead, etc.
- Real-time sentiment classifier (positive/neutral/negative)
- Custom call outcome classifier (booked, rejected, no_match, not_authorized, transferred)
- 600-second max call duration with office background noise

**6 Tools configured in the prompt node:**

1. `verify_carrier` — Webhook to `GET /carrier/verify/:mc_number`
2. `search_loads` — Webhook to `GET /loads` with query parameters
3. `negotiate` — Webhook to `POST /negotiate`
4. `log_offer` — Webhook to `POST /offers`
5. `get_timezone` — Webhook to `GET /timezone`
6. `transfer_to_sales` — Direct warm transfer to sales team

**Post-Call Processing:**
A webhook node fires after the call ends, sending `POST /offers/finalize` with the session's classifier outcome, sentiment, duration, user behavior, and equipment type.

**Agent Prompt Highlights:**
- Structured 7-step conversation flow (greet → verify → gather info → search → offer → negotiate → book/transfer)
- "Silent Retry" pattern: if no loads are found, the agent automatically relaxes filters (drops date, then equipment) before telling the carrier the board is empty
- Never interrogates — only asks for information the carrier didn't volunteer
- Pitches loads using effective RPM (earnings per mile after deadhead)
- Strict guardrails: never calculates rates, never transfers unless a price is agreed, never stacks questions
- Edge case handling: garbled transcription, rate-per-mile negotiation, multi-timezone dates, ambiguous city names

---

## Deployment and Infrastructure

All infrastructure is managed via Terraform and deployed with a single command:

```bash
./deploy.sh
```

This script:
1. Builds the Docker image
2. Pushes it to ECR
3. Runs `terraform apply` to create/update all AWS resources
4. Forces an App Runner deployment to pull the latest image

**AWS Resources Created:**
- ECR Repository
- App Runner Service (auto-scaling, managed TLS/HTTPS)
- App Runner IAM roles (ECR access, instance role)
- DynamoDB tables (loads, offers) with on-demand capacity
- Environment variables injected via App Runner configuration

**Security:**
- All API endpoints require authentication via `Authorization: Bearer <token>` header
- HTTPS is enforced by App Runner (AWS-managed certificates)
- API key is stored as an environment variable, never hardcoded

---

## API Endpoint Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Service info and endpoint listing |
| `GET` | `/health` | Health check (no auth required) |
| `GET` | `/carrier/verify/:mc_number` | FMCSA carrier verification |
| `GET` | `/loads` | Search loads with geo/filter support |
| `GET` | `/loads/:id` | Get a specific load by ID |
| `POST` | `/negotiate` | Get rate offer or respond to counter |
| `POST` | `/offers` | Log a negotiation round |
| `GET` | `/offers` | List all offer records |
| `POST` | `/offers/finalize` | Post-call metadata webhook |
| `GET` | `/timezone` | Get local date/time for a city |
| `GET` | `/dashboard/metrics` | Aggregated analytics data |
| `GET` | `/dashboard.html` | Analytics dashboard UI |

---

## Sample Data

The system is seeded with 30 freight loads across major US markets with dynamically generated pickup dates (1-7 days in the future). Load data includes:

- Origins: Chicago, Dallas, Atlanta, Los Angeles, Jacksonville, Memphis, Nashville, Denver, Phoenix, Seattle, Miami, Houston, Charlotte, Indianapolis, Minneapolis, Kansas City, Columbus, San Antonio, El Paso, Portland, and more
- Equipment types: Dry Van, Reefer, Flatbed, Power Only
- Rates: $650 - $4,800
- Full metadata: weight, commodity, piece count, dimensions, special handling notes
- GPS coordinates for geospatial search

---

## Future Enhancements

1. **Outbound Campaigns** — Proactive calling to carriers with available capacity in high-demand lanes
2. **TMS Integration** — Real-time load data from the broker's transportation management system instead of static seed data
3. **Rate Intelligence** — Historical rate analysis for dynamic pricing based on lane, season, and market conditions
4. **SMS Follow-up** — Automated text messages with load details and rate confirmation after booking
5. **Multi-language Support** — Spanish language support for broader carrier coverage
6. **Load Board Integration** — Automatic posting of unbooked loads to DAT, Truckstop, and other load boards
7. **Carrier Scoring** — Track carrier reliability over time and prioritize repeat carriers with good history
