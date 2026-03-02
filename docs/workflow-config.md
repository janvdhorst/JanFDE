# HappyRobot Workflow Configuration Guide

> Step-by-step instructions for configuring the Inbound Carrier Sales workflow on the HappyRobot platform. Assumes your API is deployed and accessible at a public HTTPS URL.

## Prerequisites

| Item | Value |
|---|---|
| API base URL | Your App Runner URL (e.g. `https://xxxxx.us-east-1.awsapprunner.com`) |
| API key | The value of `API_KEY_SECRET` from your `.envrc` or Terraform variables |
| HappyRobot account | Access to [platform.happyrobot.ai](https://platform.happyrobot.ai) |
| Phone number | An inbound number assigned in Assets > Telephony |

### Environment Variables (Settings > Environment Variables)

Set these in HappyRobot so they can be referenced as `@env.VARIABLE_NAME` in tool configs:

| Variable | Value | Description |
|---|---|---|
| `API_BASE_URL` | `https://xxxxx.us-east-1.awsapprunner.com` | Your deployed API base URL (no trailing slash) |
| `API_KEY` | Your `API_KEY_SECRET` value | Used in Authorization headers for API calls |

---

## 1. Create the Workflow

1. Go to **Workflows** > **New Workflow**
2. Name: `Inbound Carrier Sales`
3. Note the generated slug (you'll need it for API triggers later)

---

## 2. Add the Trigger

1. Click **Add Trigger**
2. Select **Inbound to Number**
3. Assign your phone number from the dropdown
4. The trigger outputs `call` (the session object) which you'll wire into the voice agent

---

## 3. Add the Inbound Voice Agent Node

1. Click **+** after the trigger
2. Select **Inbound Voice Agent**
3. In the **Call** field, type `@` and select the inbound trigger's call output

### Voice Agent Settings

| Setting | Value |
|---|---|
| **Languages** | English (`en-US`) |
| **Voice** | Pick a male or female professional voice from Assets > Voices |
| **Background noise** | Office |
| **Voice speed** | 1.00 |
| **Voice gain** | 1.00 |
| **Recording disclaimer** | Natural |
| **Max call duration** | 600 seconds |
| **Numerals** | Enabled |
| **Key terms** | `MC, DOT, BOL, reefer, flatbed, dry van, deadhead, lumper, FMCSA, loadboard` |
| **Transcription context** | `Carriers will mention MC numbers (6-7 digit numbers), city names, equipment types like dry van/reefer/flatbed, and dollar amounts for rates. Common freight industry terminology.` |
| **End-of-turn detection** | English |

### Real-time Classifiers

Configure these on the voice agent node itself (not as tools):

#### Sentiment Classifier

- **Enable**: Yes (toggle on)
- This is built-in — no further configuration needed
- Automatically tracks positive/neutral/negative sentiment per turn
- Output is available as a node variable for downstream nodes

#### Custom Classifier: Call Outcome

| Field | Value |
|---|---|
| **Name** | `call_outcome` |
| **Prompt** | `Classify the outcome of this carrier sales call based on whether a load was matched and a rate was agreed, the rate was rejected, no matching loads were available, or the carrier was not authorized to operate.` |
| **Classes** | `booked`, `rejected`, `no_match`, `not_authorized`, `transferred` |

---

## 4. Configure the Prompt Node

Inside the voice agent, click into the **Prompt** node.

### Model

| Field | Value |
|---|---|
| **Model** | `gpt-4.1` |

### Prompt

```
You are Alex, a carrier sales representative at a freight brokerage.

## Objective
Handle inbound calls from carriers looking for loads. Verify the carrier's authority, match them with available loads, and negotiate rates.

## Instructions

### Step 1: Greeting & Verification
1. Greet the carrier professionally. Ask for their MC number.
2. Use the verify_carrier tool to check their FMCSA authority.
3. If the carrier is NOT authorized to operate, politely inform them and end the call.

### Step 2: Gather Preferences
4. Ask what lanes they run, what equipment they have, and when they're available.

### Step 3: Load Search
5. Use the search_loads tool to find matching loads based on their preferences.
6. If no loads match, ask if they run any other lanes or have flexibility on dates. If they do, search again with the new criteria. If they truly have no flexibility, let them know and offer to keep their info on file.

### Step 4: Present Load
7. Present the best matching load — mention origin, destination, miles, and pickup date.
8. Use the negotiate tool with just the load_id and mc_number (no carrier_rate) to get your opening offer rate.
9. Quote the rate the negotiate tool gives you. Do NOT make up rates or do your own math.

### Step 5: Negotiation Loop (repeat as needed)
10. If the carrier accepts your rate, go to Step 6.
11. If the carrier counters with a different rate:
    a. Call log_offer with status "pending", the rate you quoted, and their counter_rate.
    b. Call the negotiate tool with the carrier's counter-rate. It tracks the round automatically and tells you what to do: "accept", "counter", or "final_offer".
    c. Follow the negotiate tool's action exactly:
       - "accept" → agree to the rate it specifies, go to Step 6.
       - "counter" → quote the new rate it gives you. Explain value (short deadhead, quick delivery, consistent lane). Loop back to the start of Step 5.
       - "final_offer" → tell the carrier this is the best you can do. If they reject, offer to search for a different load (go to Step 3) or transfer to a rep (Step 7).
    d. Call log_offer again after each round.
12. If the carrier rejects the load entirely (not just the rate), go back to Step 3 and search for a different load.

### Step 6: Booking
13. Confirm all details: load ID, origin, destination, pickup date, equipment type, and agreed rate.
14. Call log_offer with status "accepted" and the final agreed rate.
15. Ask if they need anything else or have other trucks available. If so, go back to Step 2.

### Step 7: Transfer (when needed)
16. If the carrier wants to speak with a manager, negotiation reaches an impasse, or the situation requires human judgment, use transfer_to_sales.

## Rules
- NEVER make up rates or do rate math yourself. Always use the negotiate tool to get the rate to offer.
- Do not reveal "loadboard rate", "offer_rate", or "max_rate" field names — just say the dollar amount naturally.
- Be professional, conversational, and concise.
- Confirm key details (MC number, equipment, pickup date, rate) before finalizing.
- Do not make up loads — only present what the search_loads tool returns.
- If the carrier mentions multiple lanes, search for each one separately.
- Always call log_offer for EVERY rate exchange. This creates a complete negotiation history.
- If one load doesn't work, don't end the call — search for another.
- Keep responses short — 1-3 sentences per turn. This is a phone call, not an email.
- Use dollar amounts and dates clearly (e.g. "twenty-five hundred dollars", "this Friday March 6th").
```

### Initial Message

```
Thanks for calling, this is Alex. How can I help you today?
```

### Receiving Initial Message

Leave the same as Initial Message, or set to:

```
Thanks for calling, this is Alex with carrier sales. What can I help you with?
```

---

## 5. Configure Tools

Add these 5 tools inside the prompt node. For each tool, click **+** under the prompt to add a Tool node.

---

### Tool 1: verify_carrier

| Field | Value |
|---|---|
| **Name** | `verify_carrier` |
| **Description** | `Verify a carrier's FMCSA authority and operating status by their MC number. Use this after the carrier provides their MC number.` |

#### Message

| Field | Value |
|---|---|
| **Type** | AI |
| **Example** | `Let me pull up your authority real quick.` |

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `mc_number` | string | Yes | `The carrier's MC number (digits only, e.g. "1234567")` |

#### Hold Music

None (fast API call, no need)

#### Child Node: Webhook

| Field | Value |
|---|---|
| **Type** | Webhook |
| **Method** | GET |
| **URL** | `@env.API_BASE_URL/carrier/verify/@mc_number` |
| **Headers** | `Authorization`: `Bearer @env.API_KEY` |

---

### Tool 2: search_loads

| Field | Value |
|---|---|
| **Name** | `search_loads` |
| **Description** | `Search for available freight loads matching the carrier's lane preferences and equipment type. Use this after verifying the carrier and learning their preferences.` |

#### Message

| Field | Value |
|---|---|
| **Type** | AI |
| **Example** | `Let me check what we have available on that lane.` |

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `origin` | string | No | `Origin city or region (e.g. "Chicago", "Dallas")` |
| `destination` | string | No | `Destination city or region` |
| `equipment_type` | string | No | `Equipment type: "Dry Van", "Reefer", "Flatbed"` |

#### Hold Music

Short hold music (recommended for this call since it may take a moment)

#### Child Node: Webhook

| Field | Value |
|---|---|
| **Type** | Webhook |
| **Method** | GET |
| **URL** | `@env.API_BASE_URL/loads` |
| **Query Parameters** | Map each tool parameter to a query param: `origin=@origin`, `destination=@destination`, `equipment_type=@equipment_type` |
| **Headers** | `Authorization`: `Bearer @env.API_KEY` |

---

### Tool 3: negotiate

This is the core negotiation logic. The agent calls this tool to get the rate to offer, and again each time the carrier counters. The API does all the rate math — the agent never calculates rates itself.

| Field | Value |
|---|---|
| **Name** | `negotiate` |
| **Description** | `Get the rate to offer or decide how to respond to a carrier's counter-offer. Call this first with just the load_id and mc_number to get your opening offer. Then call it again each time the carrier counters, passing their rate and the round number. The tool tells you exactly what to do: accept, counter, or make a final offer. Never calculate rates yourself — always use this tool.` |

#### Message

| Field | Value |
|---|---|
| **Type** | None |

No message needed — the agent uses the result internally to decide what to say.

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `load_id` | string | Yes | `The load ID being negotiated` |
| `mc_number` | string | Yes | `The carrier's MC number` |
| `carrier_rate` | number | No | `The carrier's requested rate. Omit on the first call to get the opening offer.` |

The round number is tracked automatically by the API — it counts how many offers have been logged for this load + carrier pair via `log_offer`. No need to pass it.

#### Child Node: Webhook

| Field | Value |
|---|---|
| **Type** | Webhook |
| **Method** | POST |
| **URL** | `@env.API_BASE_URL/negotiate` |
| **Headers** | `Authorization`: `Bearer @env.API_KEY`, `Content-Type`: `application/json` |
| **Body** | `{"load_id": "@load_id", "mc_number": "@mc_number", "carrier_rate": @carrier_rate}` |

#### Tool response format

The tool returns a JSON object with:

| Field | Description |
|---|---|
| `action` | `"offer"` (opening), `"accept"`, `"counter"`, `"final_offer"`, or `"unavailable"` |
| `rate` | The dollar amount to quote to the carrier |
| `round` | Current round number (auto-calculated from logged offers) |
| `message` | Internal guidance (not to be read to the carrier) |

---

### Tool 4: log_offer (Negotiation Tracker)

This is the negotiation tool. It gets called **multiple times per call** — once for every round of the negotiation loop. This builds a complete history of the back-and-forth.

| Field | Value |
|---|---|
| **Name** | `log_offer` |
| **Description** | `Log each round of rate negotiation. Call this EVERY time a rate is proposed or countered — by you or the carrier. Call it with status "pending" during negotiation, "accepted" when a deal is reached, or "rejected" when the carrier walks away from this load. This tool can and should be called multiple times during a single call.` |

#### Message

| Field | Value |
|---|---|
| **Type** | None |

No message needed — this is a background logging action. The conversation continues naturally while the offer is recorded.

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `load_id` | string | Yes | `The load ID being negotiated (e.g. "LD-1001")` |
| `mc_number` | string | Yes | `The carrier's MC number` |
| `carrier_name` | string | No | `The carrier's company name if mentioned` |
| `offered_rate` | number | Yes | `The rate you (the agent) offered in this round` |
| `counter_rate` | number | No | `The carrier's counter-offer, if they made one` |
| `status` | string | Yes | `"pending" = negotiation ongoing, "accepted" = deal agreed, "rejected" = carrier rejected this load` |
| `notes` | string | No | `Context for this round (e.g. "Round 2 - carrier countered at $2800, I offered $2650")` |

#### Example call sequence for a 3-round negotiation:

1. **Round 1**: `log_offer(load_id="LD-1001", mc_number="1515", offered_rate=2400, status="pending", notes="Initial offer")`
2. **Round 2**: `log_offer(load_id="LD-1001", mc_number="1515", offered_rate=2550, counter_rate=2800, status="pending", notes="Carrier countered at $2800, I came up to $2550")`
3. **Round 3**: `log_offer(load_id="LD-1001", mc_number="1515", offered_rate=2650, counter_rate=2700, status="accepted", notes="Met in the middle at $2650")`

#### Child Node: Webhook

| Field | Value |
|---|---|
| **Type** | Webhook |
| **Method** | POST |
| **URL** | `@env.API_BASE_URL/offers` |
| **Headers** | `Authorization`: `Bearer @env.API_KEY`, `Content-Type`: `application/json` |
| **Body** | JSON with all parameters mapped: `{"load_id": "@load_id", "mc_number": "@mc_number", "carrier_name": "@carrier_name", "offered_rate": @offered_rate, "counter_rate": @counter_rate, "status": "@status", "notes": "@notes"}` |

---

### Tool 5: transfer_to_sales

| Field | Value |
|---|---|
| **Name** | `transfer_to_sales` |
| **Description** | `Transfer the call to a human sales representative. Use this when the carrier requests to speak with a manager, when negotiation reaches an impasse, or when the situation requires human judgment.` |

#### Message

| Field | Value |
|---|---|
| **Type** | Fixed |
| **Text** | `Sure, let me connect you with one of our sales reps. One moment please.` |

#### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `reason` | string | Yes | `Brief reason for the transfer (e.g. "carrier wants to speak with manager", "rate negotiation impasse")` |

#### Hold Music

Hold music enabled (caller hears music during transfer)

#### Child Node: Direct Transfer

| Field | Value |
|---|---|
| **Type** | Direct Transfer |
| **Number** | Your sales team's phone number |
| **Transfer type** | Warm handoff |
| **Warm handoff message** | `Incoming carrier call. Carrier MC number @mc_number. Reason for transfer: @reason. The carrier has been verified and is authorized to operate.` |
| **Transfer timeout** | 30 seconds |
| **Fallback number** | (optional backup number) |

---

## 6. Post-Call Processing Node

After the call ends, one Conditional node branches on the real-time classifier to send a final status webhook. All the detailed data (carrier MC, load ID, rates, rounds) is already in the database from the `log_offer` calls made during the call. This post-call webhook just records the final classifier outcome and sentiment.

---

### Node A: Webhook (Finalize Call)

Click **+** after the voice agent node and select **Webhook**.

This stamps the real-time classifier outcome and sentiment onto the most recent offer record in the database. All the detailed data (load, rates, rounds, objections) is already there from the `log_offer` calls made during the call.

| Field | Value |
|---|---|
| **Method** | POST |
| **URL** | `@env.API_BASE_URL/offers/finalize` |
| **Headers** | `Authorization`: `Bearer @env.API_KEY`, `Content-Type`: `application/json` |
| **Body** | See below |

```json
{
  "mc_number": "@inbound_voice_agent.mc_number",
  "classifier_outcome": "@inbound_voice_agent.call_outcome",
  "realtime_sentiment": "@inbound_voice_agent.sentiment"
}
```

> **Note**: `@inbound_voice_agent.mc_number` may need to be adjusted based on what variables the voice agent exposes. If it's not available, you can hardcode the MC number from the trigger or use a different reference. Check the `@` picker for available fields on your voice agent node.

---

## Summary: Complete Node Graph

```
Inbound Phone Trigger
  └── Inbound Voice Agent
        ├── [Real-time Sentiment Classifier]
        ├── [Real-time Custom Classifier: call_outcome]
        ├── Prompt Node
        │     ├── Tool: verify_carrier
        │     │     └── Webhook: GET /carrier/verify/:mc
        │     ├── Tool: search_loads
        │     │     └── Webhook: GET /loads?filters
        │     ├── Tool: negotiate
        │     │     └── Webhook: POST /negotiate
        │     ├── Tool: log_offer
        │     │     └── Webhook: POST /offers
        │     └── Tool: transfer_to_sales
        │           └── Direct Transfer (warm handoff)
        │
        └── [Post-call]
              └── Webhook: POST /offers/finalize (stamps classifier + sentiment)
```

---

## Testing Checklist

1. **Deploy API** — Run `./deploy.sh` or start locally with `npm run dev`
2. **Set env vars** — Add `API_BASE_URL` and `API_KEY` in HappyRobot Settings > Environment Variables
3. **Publish workflow** — Publish to Development environment first
4. **Test with Web Call** — Use the HappyRobot test panel to simulate an inbound call
5. **Verify API calls** — Check your API logs for incoming requests from the tools
6. **Check Runs tab** — Verify the AI Extract and AI Classify outputs in the run details
7. **Call the number** — Make a real call to test end-to-end
8. **Check dashboard** — Hit `GET /dashboard/metrics` to see aggregated data
