# Setup Guide — Inbound Carrier Sales AI

This guide walks you through reproducing the complete system from a fresh clone of the repository.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20+ | API runtime |
| Docker | 20+ | Container builds |
| AWS CLI | v2 | AWS authentication and ECR login |
| Terraform | 1.5+ | Infrastructure provisioning |
| direnv | (optional) | Auto-loads environment variables from `.envrc` |
| Git | 2.x | Source control |

You also need:

- An **AWS account** with permissions for ECR, App Runner, DynamoDB, and IAM
- An **FMCSA API key** from [FMCSA SAFER](https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi) (free registration)
- A **HappyRobot account** at [platform.happyrobot.ai](https://platform.happyrobot.ai)

---

## Step 1: Clone the Repository

```bash
git clone https://github.com/janvdhorst/JanFDE.git
cd JanFDE
npm install
```

---

## Step 2: Configure Environment Variables

Create a `.envrc` file in the project root (this file is gitignored):

```bash
# AWS credentials — use a dedicated IAM user or SSO profile
export AWS_ACCESS_KEY_ID=your_aws_access_key
export AWS_SECRET_ACCESS_KEY=your_aws_secret_key
export AWS_DEFAULT_REGION=us-east-1

# FMCSA API key for carrier verification
export FMCSA_API_KEY=your_fmcsa_api_key

# API authentication key — any random string, shared with HappyRobot
export API_KEY_SECRET=your_api_key_secret
```

If you use `direnv`, run:

```bash
direnv allow
```

Otherwise, source the file manually:

```bash
source .envrc
```

**Generating a random API key:**

```bash
openssl rand -base64 32
```

---

## Step 3: Test Locally (Optional)

You can run the API locally before deploying. It will use DynamoDB in us-east-1, so your AWS credentials must be configured.

```bash
npm run dev
```

The API will be available at `http://localhost:3000`. Test it:

```bash
# Health check
curl http://localhost:3000/health

# Verify a carrier (mock fallback if FMCSA API is unavailable)
curl -H "Authorization: Bearer $API_KEY_SECRET" \
  http://localhost:3000/carrier/verify/1515

# Search for loads near Chicago
curl -H "Authorization: Bearer $API_KEY_SECRET" \
  "http://localhost:3000/loads?origin=Chicago,IL"

# Open the dashboard
open http://localhost:3000/dashboard.html?api_key=$API_KEY_SECRET
```

---

## Step 4: Deploy to AWS

The `deploy.sh` script handles everything: Terraform init, ECR repo creation, Docker build and push, infrastructure provisioning, and App Runner deployment.

```bash
chmod +x deploy.sh
./deploy.sh
```

This creates:

| Resource | Purpose |
|---|---|
| ECR Repository | Stores the Docker image |
| App Runner Service | Runs the containerized API with auto-scaling and managed HTTPS |
| App Runner IAM Roles | ECR access and instance permissions |
| DynamoDB Tables | `happyrobot-api-loads` and `happyrobot-api-offers` |

On success, the script prints:

```
Service URL: https://xxxxx.us-east-1.awsapprunner.com
ECR Repo:    123456789.dkr.ecr.us-east-1.amazonaws.com/happyrobot-api
```

**Save the Service URL** — you'll need it for HappyRobot configuration.

To preview changes without deploying:

```bash
./deploy.sh --plan
```

To tear down all resources:

```bash
./deploy.sh --destroy
```

---

## Step 5: Verify the Deployment

```bash
# Replace with your actual service URL
export API_URL=https://xxxxx.us-east-1.awsapprunner.com

# Health check
curl $API_URL/health

# Should return: {"status":"ok"}

# Check dashboard
open "$API_URL/dashboard.html?api_key=$API_KEY_SECRET"
```

---

## Step 6: Configure HappyRobot Platform

### 6.1 Set Environment Variables

Go to **Settings > Environment Variables** in HappyRobot and add:

| Variable | Value |
|---|---|
| `API_BASE_URL` | Your App Runner URL (e.g. `https://xxxxx.us-east-1.awsapprunner.com`) — no trailing slash |
| `API_KEY` | The same value as your `API_KEY_SECRET` |

### 6.2 Create the Workflow

1. Go to **Workflows > New Workflow**
2. Name: `Inbound Carrier Sales`
3. Add trigger: **Inbound to Number** — assign your inbound phone number

### 6.3 Add the Voice Agent Node

1. Click **+** after the trigger, select **Inbound Voice Agent**
2. Wire the `@` call output from the trigger into the Call field
3. Configure settings:

| Setting | Value |
|---|---|
| Language | English (en-US) |
| Voice | Professional male or female voice |
| Background noise | Office |
| Max call duration | 600 seconds |
| Numerals | Enabled |
| Key terms | `MC, DOT, BOL, reefer, flatbed, dry van, deadhead, lumper, FMCSA, loadboard` |
| End-of-turn detection | English |

4. Enable the **Sentiment Classifier** (built-in toggle)
5. Add a **Custom Classifier**:
   - Name: `call_outcome`
   - Classes: `booked`, `rejected`, `no_match`, `not_authorized`, `transferred`

### 6.4 Configure the Prompt Node

Inside the voice agent, click the **Prompt** node.

- **Model:** `gpt-4.1`
- **Prompt:** Copy the full prompt from the `Prompt` section of the build description or from the HappyRobot platform export
- **Initial Message:** `Thanks for calling, this is Alex. How can I help you today?`

### 6.5 Add the 6 Tools

Add each tool inside the prompt node. For each, click **+** under the prompt.

#### Tool 1: verify_carrier

| Field | Value |
|---|---|
| Name | `verify_carrier` |
| Description | `Verify a carrier's FMCSA authority and operating status by their MC number.` |
| Message Type | AI |
| Message Example | `Let me pull up your authority real quick.` |

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `mc_number` | string | Yes | `The carrier's MC number (digits only)` |

**Child Node — Webhook:**

| Field | Value |
|---|---|
| Method | GET |
| URL | `@env.API_BASE_URL/carrier/verify/@mc_number` |
| Headers | `Authorization`: `Bearer @env.API_KEY` |

---

#### Tool 2: search_loads

| Field | Value |
|---|---|
| Name | `search_loads` |
| Description | `Search for available freight loads. The API searches a 1,500-mile radius automatically. If empty, retry by dropping filters before telling the carrier.` |
| Message Type | AI |
| Message Example | `Let me check the board for you real quick...` |
| Hold Music | Short hold music |

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `origin` | string | No | `Origin city and state (e.g. "Chicago, IL")` |
| `destination` | string | No | `Destination city or region` |
| `equipment_type` | string | No | `"Dry Van", "Reefer", or "Flatbed". Leave empty for all types.` |
| `pickup_date` | string | No | `Earliest pickup date (YYYY-MM-DD). Only pass if the carrier specified a date.` |

**Child Node — Webhook:**

| Field | Value |
|---|---|
| Method | GET |
| URL | `@env.API_BASE_URL/loads` |
| Query Params | `origin=@origin`, `destination=@destination`, `equipment_type=@equipment_type`, `pickup_date=@pickup_date` |
| Headers | `Authorization`: `Bearer @env.API_KEY` |

---

#### Tool 3: negotiate

| Field | Value |
|---|---|
| Name | `negotiate` |
| Description | `Get the rate to offer or respond to a counter. Call first with just load_id and mc_number for the opening offer. Call again with carrier_rate when they counter. Never calculate rates yourself.` |
| Message Type | None |

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `load_id` | string | Yes | `The load ID being negotiated` |
| `mc_number` | string | Yes | `The carrier's MC number` |
| `carrier_rate` | number | No | `The carrier's counter-offer. Omit on first call.` |

**Child Node — Webhook:**

| Field | Value |
|---|---|
| Method | POST |
| URL | `@env.API_BASE_URL/negotiate` |
| Headers | `Authorization`: `Bearer @env.API_KEY`, `Content-Type`: `application/json` |
| Body | `{"load_id": "@load_id", "mc_number": "@mc_number", "carrier_rate": @carrier_rate}` |

---

#### Tool 4: log_offer

| Field | Value |
|---|---|
| Name | `log_offer` |
| Description | `Log each negotiation round. Call for EVERY rate exchange. Always include carrier_name from verify_carrier. Set final_rate when status is "accepted".` |
| Message Type | None |

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `load_id` | string | Yes | `The load ID (e.g. "LD-1001")` |
| `mc_number` | string | Yes | `The carrier's MC number` |
| `carrier_name` | string | Yes | `Carrier company name from verify_carrier` |
| `offered_rate` | number | Yes | `The rate you offered this round` |
| `counter_rate` | number | No | `The carrier's counter-offer` |
| `final_rate` | number | No | `Agreed rate (set when status is "accepted")` |
| `status` | string | Yes | `"pending", "accepted", or "rejected"` |
| `equipment_type` | string | No | `Trailer type (e.g. "Dry Van")` |
| `lanes_requested` | string | No | `Lane (e.g. "Chicago → Dallas")` |
| `carrier_sentiment` | string | No | `"positive", "neutral", "frustrated"` |
| `call_outcome` | string | No | `"booked", "rejected", "callback"` |
| `key_objections` | string | No | `Reason for counter (e.g. "fuel costs")` |
| `notes` | string | No | `Context for this round` |

**Child Node — Webhook:**

| Field | Value |
|---|---|
| Method | POST |
| URL | `@env.API_BASE_URL/offers` |
| Headers | `Authorization`: `Bearer @env.API_KEY`, `Content-Type`: `application/json` |
| Body | `{"load_id": "@load_id", "mc_number": "@mc_number", "carrier_name": "@carrier_name", "offered_rate": @offered_rate, "counter_rate": @counter_rate, "final_rate": @final_rate, "status": "@status", "equipment_type": "@equipment_type", "lanes_requested": "@lanes_requested", "carrier_sentiment": "@carrier_sentiment", "call_outcome": "@call_outcome", "key_objections": "@key_objections", "notes": "@notes"}` |

---

#### Tool 5: get_timezone

| Field | Value |
|---|---|
| Name | `get_timezone` |
| Description | `Get local date/time for a city. Call after learning the carrier's origin to determine "today" and "tomorrow" for date handling.` |
| Message Type | None |

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `city` | string | No | `City and state (e.g. "Tampa, FL")` |
| `tz` | string | No | `IANA timezone (e.g. "America/Denver")` |

**Child Node — Webhook:**

| Field | Value |
|---|---|
| Method | GET |
| URL | `@env.API_BASE_URL/timezone` |
| Query Params | `city=@city`, `tz=@tz` |
| Headers | `Authorization`: `Bearer @env.API_KEY` |

---

#### Tool 6: transfer_to_sales

| Field | Value |
|---|---|
| Name | `transfer_to_sales` |
| Description | `Transfer to sales for paperwork. ONLY use after a rate is agreed and confirmed.` |
| Message Type | Fixed |
| Message Text | `Please stay on the line — don't hang up. It might ring for a second or two but someone will pick right up.` |
| Hold Music | Enabled |

**Parameters:**

| Name | Type | Required | Description |
|---|---|---|---|
| `reason` | string | Yes | `Brief reason for the transfer` |

**Child Node — Direct Transfer:**

| Field | Value |
|---|---|
| Type | Direct Transfer |
| Number | Your sales team's phone number |
| Transfer type | Warm handoff |
| Warm handoff message | `Incoming carrier call. MC number @mc_number. Reason: @reason. Carrier is verified.` |

### 6.6 Add Post-Call Webhook

Click **+** after the voice agent node and add a **Webhook** node:

| Field | Value |
|---|---|
| Method | POST |
| URL | `@env.API_BASE_URL/offers/finalize` |
| Headers | `Authorization`: `Bearer @env.API_KEY`, `Content-Type`: `application/json` |

**Body:**

```json
{
  "session_id": "@inbound_voice_agent.session_id",
  "duration": "@inbound_voice_agent.duration",
  "sentiment": "@inbound_voice_agent.sentiment",
  "call_result": "@inbound_voice_agent.call_result",
  "user_behavior": "@inbound_voice_agent.user_behavior",
  "equipment_type": "@inbound_voice_agent.equipment_type"
}
```

### 6.7 Publish

1. Click **Publish** and deploy to the **Development** environment
2. Use the **Web Call** test panel in HappyRobot to simulate an inbound call
3. Verify that tool calls appear in the **Runs** tab and that data shows up on the dashboard

---

## Step 7: Redeploying After Code Changes

After making code changes:

```bash
./deploy.sh
```

This rebuilds the Docker image, pushes it, and forces App Runner to pull the latest version.

---

## Project Structure

```
.
├── deploy.sh                  # One-command build + deploy script
├── Dockerfile                 # Multi-stage Node.js container
├── package.json
├── public/
│   └── dashboard.html         # Analytics dashboard (DaisyUI + Chart.js + Leaflet)
├── src/
│   ├── index.js               # Express app entry point + auth middleware
│   ├── db.js                  # DynamoDB client and table names
│   ├── seed.js                # Seed data (30 loads with dynamic dates)
│   └── routes/
│       ├── carrier.js         # FMCSA carrier verification
│       ├── loads.js           # Load search with geocoding + Haversine
│       ├── negotiate.js       # Server-side negotiation engine
│       ├── offers.js          # Offer logging + post-call finalize
│       ├── dashboard.js       # Aggregated metrics for the dashboard
│       └── timezone.js        # Timezone resolution utility
├── terraform/
│   ├── main.tf                # ECR, App Runner, DynamoDB, IAM
│   ├── variables.tf           # Input variables
│   └── outputs.tf             # Service URL, ECR URI, ARN
└── docs/
    ├── build-description.md   # Technical build document
    ├── email-carlos.md        # Client email template
    ├── video-script.md        # 5-minute demo recording script
    └── setup-guide.md         # This file
```

---

## Troubleshooting

| Issue | Fix |
|---|---|
| `direnv` not loading `.envrc` | Run `direnv allow` and ensure `eval "$(direnv hook bash)"` is in your `~/.bashrc` |
| `deploy.sh` fails at ECR login | Check AWS credentials: `aws sts get-caller-identity` |
| App Runner shows old code | The script runs `aws apprunner start-deployment` automatically. If it still shows old code, clear browser cache. |
| FMCSA API returns 403 | The API has a mock fallback. If you need real data, verify your FMCSA key at the SAFER portal. |
| Dashboard shows $0 savings | Ensure `log_offer` is called with `final_rate` when status is `"accepted"`. |
| Carrier names missing in dashboard | Ensure `carrier_name` is included in every `log_offer` call (from `verify_carrier` result). |
| Loads search returns empty | Check that seed data has future dates. Redeploy to regenerate: `./deploy.sh` |
