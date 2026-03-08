# Video Walkthrough Script — Inbound Carrier Sales AI

**Target length:** 5 minutes
**Recording tip:** Share your screen, have the dashboard and HappyRobot platform open in separate tabs, and have the inbound phone number ready to call.

---

## 0:00 – 0:30 | Introduction

> "Hey, I'm Jan. I built an AI-powered inbound carrier sales agent for the FDE Technical Challenge. The scenario is a freight brokerage receiving calls from carriers looking for loads. Instead of a human rep answering every call, the AI agent handles the full workflow: verifies the carrier's FMCSA authority, searches for matching loads, negotiates rates through up to three rounds, and transfers to sales for booking — all autonomously."

**On screen:** Show the build description document briefly, or a simple architecture slide.

---

## 0:30 – 1:30 | Architecture & Setup

> "Let me walk you through how this is set up."

**On screen:** Switch to the code editor or terminal.

> "The backend is a Node.js API running on AWS App Runner, deployed via Terraform with a single deploy script. It uses DynamoDB for storage — one table for loads, one for offers and negotiation history."

**On screen:** Briefly show `src/index.js` to highlight the routes.

> "There are six API endpoints the voice agent calls as tools:
> - `verify_carrier` hits the FMCSA API to check operating authority
> - `search_loads` does a geospatial search — it geocodes the carrier's city and finds loads within a 1,500-mile radius using the Haversine formula
> - `negotiate` runs the rate negotiation logic server-side — the LLM never does math
> - `log_offer` records every round of the negotiation
> - `get_timezone` resolves local dates so the agent handles US timezones correctly
> - `transfer_to_sales` does a warm handoff when a deal is closed"

**On screen:** Switch to HappyRobot platform. Show the workflow.

> "On the HappyRobot side, I have an inbound voice agent node with a detailed prompt, these six tools wired to webhooks, real-time sentiment classification, and a custom call outcome classifier. After the call, a post-call webhook stamps the final metadata onto the offer record."

---

## 1:30 – 3:30 | Live Demo Call

> "Let me show you a live call."

**Action:** Call the inbound number from your phone or a second device. Put it on speaker or use a call recording tool.

**Walk through the conversation naturally:**

1. **Greeting & MC verification** — Give MC number 1515 (or any test number). Point out how the agent fills silence while the API call happens.

2. **Gathering info** — Tell the agent your city, equipment type, and availability. Point out how it doesn't interrogate — if you volunteer info, it acknowledges and only asks for what's missing.

3. **Load search** — The agent searches and pitches a load. Point out:
   - It mentions deadhead miles and effective RPM
   - It reads out special handling notes
   - It confirms the pickup date

4. **Rate negotiation** — The agent quotes a rate. Counter with a higher number. Point out:
   - The agent always calls the negotiate tool — never accepts on the first counter
   - It counters with the rate the tool returns
   - After 2-3 rounds it reaches a deal or a final offer

5. **Booking** — Accept the rate. Point out:
   - The agent reads back MC and rate digit by digit
   - It tells you to stay on the line
   - It mentions texting the load ID and rate

> "Every step of that conversation — every offer, counter, acceptance — was logged to the database in real time. Let me show you what that looks like on the dashboard."

---

## 3:30 – 4:30 | Dashboard Walkthrough

**On screen:** Open the dashboard at `/dashboard.html`

> "This is the live analytics dashboard. Everything updates in real time."

Walk through each section:

1. **KPI cards** — "Total calls, booking rate, total savings versus market rates, average savings per deal, average negotiation rounds, and average call duration."

2. **Conversion funnel** — "You can see the full pipeline: total calls to verified carriers to loads found to negotiations to bookings, with drop-off percentages at each stage."

3. **Load origins map** — "This is an interactive map showing all load origins. Green markers are booked loads, blue are available. Each popup shows the rate, pickup date, equipment type, and status."

4. **Rate waterfall** — "This shows the average market rate versus what we offered versus the final agreed rate — so you can see exactly how much we're saving per deal."

5. **Negotiation rounds** — "Distribution of how many rounds it took to close deals. Most close in 2-3 rounds."

6. **Equipment mix and sentiment** — "Breakdown of trailer types and carrier sentiment across all calls."

7. **Top lanes, carriers, and activity feed** — "Most active lanes with savings, top carriers with conversion rates, and a live feed of recent activity with status badges."

---

## 4:30 – 5:00 | Wrap-Up

> "To summarize: this is a fully deployed, end-to-end AI carrier sales agent. It handles FMCSA verification, intelligent load matching with geospatial search, server-side rate negotiation with a structured 3-round engine, and provides real-time analytics — all running on AWS infrastructure deployed via Terraform."

> "For next steps, you'd connect it to a live TMS for real load data, add outbound campaign capabilities, integrate SMS follow-up for booking confirmations, and build rate intelligence from historical negotiation data."

> "Thanks for watching."

---

## Pre-Recording Checklist

- [ ] API is deployed and responding (`/health` returns `ok`)
- [ ] Dashboard is loading with data (`/dashboard.html`)
- [ ] HappyRobot workflow is published to Development
- [ ] Inbound phone number is assigned and working
- [ ] Test MC number 1515 returns a verified carrier
- [ ] Seed data has loads with future pickup dates (re-run `deploy.sh` if dates are stale)
- [ ] Screen recording software is ready (OBS, Loom, or similar)
- [ ] Phone or second device ready for the demo call
