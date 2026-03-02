# HappyRobot Documentation

> Extracted from https://docs.happyrobot.ai (password: oshappyrobot)
> Full page index: https://docs.happyrobot.ai/llms.txt
> OpenAPI spec: https://platform.happyrobot.ai/api/v2/docs/json

---

## Table of Contents

- [Platform Overview](#platform-overview)
- [Quickstart](#quickstart)
- [Voice Agents Overview](#voice-agents-overview)
- [Inbound Calls](#inbound-calls)
- [Outbound Calls](#outbound-calls)
- [Prompts and Tools](#prompts-and-tools)
- [STT, TTS, and LLM Configuration](#stt-tts-and-llm-configuration)
- [Documentation Index (all pages)](#documentation-index)

---

# Platform overview

> Architecture and key concepts of the HappyRobot platform

HappyRobot is enterprise-grade infrastructure for building and orchestrating AI workforces. From a single platform, teams deploy fully custom AI workers that operate across voice, email, SMS, WhatsApp, and chat - integrating directly with your business systems to make decisions, execute actions, and communicate, all within a single workflow.

## Architecture

Triggers arrive through communication channels (phone calls, SMS, WhatsApp messages, emails) or via API. The workflow engine orchestrates execution across a directed graph of nodes — AI conversations, integration actions, data extraction, conditional logic, and more. Each execution is captured as a run with full transcripts, recordings, and node-level output tracking.

## Key concepts

### Workflows
A workflow is the top-level container for an automation — similar to a project. Each workflow has a unique slug used for API triggers, contains a directed graph of nodes that defines execution logic, and maintains a history of versions and execution runs.

You manage workflows from the platform at [platform.happyrobot.ai](https://platform.happyrobot.ai). Each workflow belongs to an organization and can be configured with environment-specific settings for development, staging, and production. Workflows support branching, parallel paths, and conditional logic. When a trigger fires, the workflow engine executes nodes in sequence, passing data between them.

### Nodes
Nodes are individual steps in a workflow. There are four primary node types:

* **Action nodes** execute integration events — sending emails, creating records, querying databases.
* **Prompt nodes** run AI conversations — voice calls, SMS threads, chatbot sessions.
* **Tool nodes** perform function calls and utility operations.
* **Condition nodes** add branching logic based on data from previous nodes.

HappyRobot also provides core nodes for common operations: AI Extract, AI Classify, AI Generate, Custom Code, Webhook, Schedule, File Operations, and Conditionals.

### Agents
Agents handle AI conversations with users. There are two categories:

* **Voice agents** manage phone calls over SIP and WebRTC. They combine speech-to-text (STT), a language model (LLM), and text-to-speech (TTS) into a real-time conversation pipeline.
* **Text agents** handle written communication over SMS, WhatsApp, email, and embedded chatbot.

Both types are configured as prompt nodes within workflows, giving you control over system prompts, model selection, available tools, and conversation behavior.

### Integrations
Integrations connect HappyRobot to external systems. There are 19+ integrations across three categories:

* **Communication** — Gmail, Outlook, Slack, Microsoft Teams, Twilio SMS, WhatsApp, SendGrid, HappyRobot Email
* **Business systems** — McLeod TMS, Turvo TMS, TPro, 3PL, Custom TMS, Broker App
* **Data and storage** — Google Sheets, Snowflake, Redis

### Runs
A run is a single execution of a workflow. When a workflow is triggered, HappyRobot creates a run that tracks:

* Execution status (queued, in progress, completed, failed)
* Output from each node
* Call recordings and transcripts (for voice runs)
* Messages exchanged during agent conversations
* Duration and billing data

### Contacts
Contacts are automatically created from interactions. When someone calls, texts, or emails your agents, HappyRobot creates or updates a contact record that tracks:

* Interaction history across all channels
* Extracted attributes from conversations
* Persistent memories that agents reference in future interactions

### Versions and environments
HappyRobot supports versioning and environment-based deployment. You can create versions of your workflow configuration, deploy to development, staging, or production environments, test changes before they go live, and roll back instantly if needed.

## How it works

Here is what happens when an inbound phone call reaches HappyRobot:

1. **Trigger fires** — A call arrives on a phone number assigned to a workflow. HappyRobot detects the inbound call trigger and starts a new run.
2. **Workflow executes** — The workflow engine begins executing nodes in order. It evaluates conditions, runs integrations, and routes the call to the appropriate agent.
3. **Agent converses** — The voice agent joins the call. It uses STT to understand the caller, an LLM to generate responses, and TTS to speak them back — all in real time. The agent can call tools and access knowledge bases during the conversation.
4. **Actions run** — After the conversation, downstream nodes execute — updating records in your TMS, sending follow-up emails, writing data to a spreadsheet, or triggering another workflow.
5. **Run completes** — The run finishes with a full record: transcript, recording, node outputs, extracted data, and execution metadata. The contact record is updated with new interaction history and memories.

---

# Quickstart

> Build an outbound voice agent workflow and trigger it via API in 15 minutes

In this guide you will build a complete workflow: a webhook trigger starts an outbound voice call, an AI Extract node pulls structured data from the conversation, and you trigger the whole thing via API. By the end, you will have a working pipeline from API request to phone call to extracted data.

**Prerequisites:**
* A HappyRobot account — contact sales@happyrobot.ai if you don't have one yet
* An API key from Settings > API Keys
* A phone number assigned to your organization in Assets > Telephony

## Create a workflow

1. **Open the platform** — Go to platform.happyrobot.ai and navigate to the Workflows page.
2. **Create a new workflow** — Click New Workflow and name it "Customer Support". HappyRobot generates a unique slug automatically (e.g., `V1StGXR8_Z5jdHi6B-myT`). Note this slug; you will use it to trigger the workflow via API.

## Add a webhook trigger

1. **Select the trigger type** — In the workflow editor, click Add Trigger and select Incoming hook. This starts the workflow when an HTTP request hits the endpoint.
2. **Note the endpoint URL** — The trigger configuration panel shows the endpoint URL based on your workflow's auto-generated slug:
   ```
   https://platform.happyrobot.ai/hooks/V1StGXR8_Z5jdHi6B-myT
   ```
   Any JSON fields you send to this endpoint become workflow variables automatically — no schema definition required.

## Generate a test record

Send a POST request to your workflow's version-specific test URL:

```bash
curl -X POST https://platform.happyrobot.ai/hooks/V1StGXR8_Z5jdHi6B-myT/VERSION_SLUG \
  -H "Content-Type: application/json" \
  -d '{
    "phone_number": "+15551234567",
    "customer_name": "Maria Garcia",
    "order_id": "ORD-2025-8842",
    "issue_description": "Package arrived damaged"
  }'
```

The test record populates the node's output schema. These fields — `phone_number`, `customer_name`, `order_id`, `issue_description` — now appear in the `@` variable picker when configuring downstream nodes.

## Add an outbound voice agent

1. Click **+** after the trigger and select **Outbound Voice Agent**.
2. In the **To** field, type `@` to open the variable picker. Select `phone_number` from the trigger's output.
3. Set the **From** number from the dropdown.
4. Write the agent prompt (use `@` variables to inject trigger data):

```
You are Alex, a customer support representative at Acme Corp.

You are calling @customer_name regarding their support request
about order @order_id.

Issue: @issue_description

Instructions:
1. Introduce yourself and reference order @order_id
2. Explain the resolution or gather more details about the issue
3. Confirm next steps and expected timeline
4. Thank them and ask if there is anything else

Rules:
- Be professional, empathetic, and concise
- If the customer is unavailable, leave a clear voicemail
- Do not discuss billing or refunds
```

5. Set **Initial message** to:
```
Hi, this is Alex from Acme Corp. I'm calling about your order
@order_id — do you have a moment?
```

6. Configure voice and model settings (LLM model, Voice, Recording disclaimer, Voicemail action).

## Add a data extraction step

1. Click **+** after the voice agent node and select **AI Extract**.
2. In the **Input** field, type `@` and select the voice agent's transcript output.
3. Define extraction parameters:

| Parameter | Description | Example |
|---|---|---|
| `resolved` | Whether the issue was resolved on the call | `true` |
| `next_steps` | Agreed-upon follow-up actions | `Send replacement by Friday` |
| `customer_sentiment` | Overall customer tone | `positive` |

## Test and publish

1. **Test in development** — Click Test to open the test panel, fill in fields, and click Run. Or POST to the version-specific test URL.
2. **Review the test run** — Switch to the Runs tab to see the execution.
3. **Publish to production** — Click Publish and select Production as the target environment.

## Trigger via API

```bash
curl -X POST https://platform.happyrobot.ai/hooks/V1StGXR8_Z5jdHi6B-myT \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk_live_abc123def456" \
  -d '{
    "phone_number": "+15551234567",
    "customer_name": "Maria Garcia",
    "order_id": "ORD-2025-8842",
    "issue_description": "Package arrived damaged"
  }'
```

Python:
```python
import requests

response = requests.post(
    "https://platform.happyrobot.ai/hooks/V1StGXR8_Z5jdHi6B-myT",
    headers={
        "Content-Type": "application/json",
        "x-api-key": "sk_live_abc123def456",
    },
    json={
        "phone_number": "+15551234567",
        "customer_name": "Maria Garcia",
        "order_id": "ORD-2025-8842",
        "issue_description": "Package arrived damaged",
    },
)
print(response.json())
```

Node.js:
```javascript
const response = await fetch(
  "https://platform.happyrobot.ai/hooks/V1StGXR8_Z5jdHi6B-myT",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "sk_live_abc123def456",
    },
    body: JSON.stringify({
      phone_number: "+15551234567",
      customer_name: "Maria Garcia",
      order_id: "ORD-2025-8842",
      issue_description: "Package arrived damaged",
    }),
  }
);
const data = await response.json();
console.log(data);
```

**Notes:**
- The `x-api-key` header is only required if you have enabled Enhanced Security in the trigger configuration. By default, webhook triggers accept unauthenticated requests.
- Every field in the JSON body flows into the workflow as a variable.
- Each environment has its own endpoint:
  - **Staging:** `https://platform.happyrobot.ai/hooks/staging/V1StGXR8_Z5jdHi6B-myT`
  - **Development:** `https://platform.happyrobot.ai/hooks/development/V1StGXR8_Z5jdHi6B-myT`

## Monitor the run

1. Go to the **Runs** tab. Each row shows the run status, timestamp, and environment.
2. The details panel shows the full conversation transcript with timestamps and tool calls.
3. Scroll down to see the AI Extract node output — the structured data extracted from the call.

## Query runs via API

```bash
curl -X GET "https://platform.happyrobot.ai/runs/?use_case_id=YOUR_USE_CASE_ID&page=1&page_size=50&status=completed" \
  -H "Authorization: Bearer sk_live_abc123def456"
```

Key query parameters:

| Parameter | Type | Description |
|---|---|---|
| `use_case_id` | UUID | Required. The workflow to list runs for |
| `page` | integer | Page number (default: 1) |
| `page_size` | integer | Results per page, 1–2000 (default: 100) |
| `status` | string | Filter by status: `completed`, `failed`, `running`, `canceled`, `scheduled` |
| `start_date` | datetime | Runs created after this timestamp |
| `end_date` | datetime | Runs created before this timestamp |

---

# Voice Agents Overview

> Introduction to voice AI agents

Voice agents handle real-time phone conversations powered by AI. They combine speech-to-text (STT), a language model (LLM), and text-to-speech (TTS) into a pipeline that listens, thinks, and speaks — all within a single phone call. You configure them as nodes inside a workflow, so every call benefits from the full automation engine: data extraction, integration actions, conditional logic, and more.

## What you can build

- **Inbound call handling** — Assign a phone number, configure an AI agent, and answer incoming calls automatically — extracting data, looking up records, and routing callers without human intervention.
- **Outbound campaigns** — Trigger outbound calls via API or workflow. The agent dials, navigates phone menus, handles voicemail, and retries on failure — all with configurable limits and scheduling.
- **Outbound with callback** — Place outbound calls that support intelligent callbacks. If the recipient misses your call and calls back, the workflow resumes from a dedicated callback node with full context from the original attempt.
- **Multilingual conversations** — Deploy agents that speak 50+ languages. Select multiple languages per agent and the STT engine adapts automatically.

## How a voice call works

1. **Call connects** — A call arrives on an assigned phone number (inbound) or is initiated by a workflow trigger (outbound). HappyRobot creates a session and routes the call to the voice agent.
2. **STT transcribes speech** — The caller's audio is streamed to the speech-to-text engine in real time.
3. **LLM generates a response** — The transcript is sent to the language model along with the system prompt, conversation history, and any tool results.
4. **TTS speaks the response** — The model's text response is converted to speech using the selected voice and played back to the caller.
5. **Workflow continues** — When the conversation ends, the workflow proceeds to downstream nodes.

## Voice agent types

| Type | Use case | Trigger |
|---|---|---|
| Inbound | Answer incoming calls on an assigned phone number | Phone call arrives on a configured number |
| Outbound | Place calls to one or more phone numbers | API trigger, webhook, or workflow action |
| Outbound with Callback | Place calls and handle callbacks when recipients call back | API trigger with callback detection on assigned numbers |

## Key capabilities

- **50+ languages** — Support for English, Spanish, French, German, Portuguese, Chinese, Japanese, Korean, Arabic, Hindi, and dozens more
- **Real-time tools** — Agents can call tools mid-conversation — look up records, transfer calls, press DTMF digits, or run any workflow action
- **Contact intelligence** — Automatically track interaction history per contact. Agents access past conversations and extracted data to personalize every call
- **Recording and compliance** — Record calls with configurable disclaimers — robotic, natural-voice, or custom audio
- **Business hours** — Respect business hour schedules for outbound calls
- **Real-time classifiers** — Classify caller sentiment and custom categories in real time during the conversation

---

# Inbound Calls

> Configure agents to handle incoming phone calls

Inbound voice agents answer incoming phone calls on numbers you assign in HappyRobot. When a call arrives, the platform creates a session, routes the caller to the AI agent, and executes the rest of the workflow after the conversation ends. Inbound calls are always processed immediately with no concurrency limits.

## Setting up an inbound voice agent

1. **Add an inbound phone trigger** — Select Inbound to Number trigger and assign a phone number.
2. **Add a voice agent node** — Add an Inbound Voice Agent action node.
3. **Configure the agent** — Set prompt, voice, language, and call settings. Link the Call field to your inbound trigger.
4. **Add downstream nodes** — Add follow-up actions after the voice agent.
5. **Publish and test** — Publish your workflow and call the assigned phone number.

## Configuration reference

### Call source
The Call field links the voice agent to the inbound phone trigger. This tells the agent which incoming call session to join.

### Agent identity
- **Prompt** — Configured in the prompt node nested inside the voice agent. Defines personality, instructions, conversation flow, and guardrails.
- **Languages** — Select the language(s) the agent should expect. Supports multi-language detection and dynamic selection via variables. 50+ languages supported.
- **Voices** — Choose which voice the agent uses for TTS. Multiple voices can be set for A/B testing. Browse in Assets > Voices.

### Recording and disclaimers
- Call recording enabled by default
- Recording styles: Robotic (standard TTS), Natural (natural-sounding TTS), Custom (uploaded audio)

### Audio environment
- **Background noise** — Options: Call center (default), Coffee shop, Office, Reception, Random, No background noise, or custom
- **Voice speed** — 0.70 to 1.20 (default 1.00)
- **Voice gain** — 1.00 to 1.50 (default 1.00)
- **Disable time fillers** — Suppress "One moment..." phrases
- **Stay silent** — Allow the agent to stay quiet when appropriate

### Transcription accuracy
- **Transcription context** — Free-text describing expected speech patterns
- **Key terms** — Specific words to prioritize for recognition
- **Enable denoised STT** — Voice focus model for noisy environments
- **Numerals** — Convert spoken numbers to digits (default: enabled)
- **End-of-turn detection** — English, Multilingual v1, or Text heuristics

### Call duration limits
- **Max call duration** — Defaults to 600 seconds (10 minutes)
- **Max duration transfer number** — Transfer caller to a human when time limit is reached

### Business hours
Disabled by default for inbound agents.

### Real-time analysis
- **Sentiment classifier** — Tracks positive/negative/neutral tone
- **Custom classifiers** — Build your own with Name, Prompt, and Classes

### Contact intelligence
- **Enable memory** — Gives agent access to caller's past interaction history
- **Interaction limit** — How many past interactions to include (0–10)
- **Disable auto contact context** — Manually place `@contact_intelligence_context` in prompt

## Inbound call flow

1. SIP trunk accepts the call and routes it to HappyRobot
2. HappyRobot matches the phone number to a workflow trigger and starts a new run
3. A session is created with status `queued` and type `inbound`
4. The call is immediately processed (no concurrency limits)
5. The voice agent joins the call and begins the conversation
6. When the call ends, the workflow continues with downstream nodes

---

# Outbound Calls

> Set up automated outbound calling campaigns

Outbound voice agents place calls to one or more phone numbers on your behalf. You configure the destination, caller ID, voicemail behavior, retry logic, and scheduling — then trigger the workflow via API, webhook, or another workflow action. Outbound calls are rate-limited per organization to manage concurrency and comply with carrier requirements.

## Setting up an outbound voice agent

1. **Create a workflow with a trigger** — Typically a Webhook or API call trigger.
2. **Add an outbound voice agent node**
3. **Configure destination and caller ID** — Set To (recipient phone) and From (your caller ID).
4. **Configure agent behavior** — Set prompt, voice, language, and all call settings.
5. **Add downstream nodes** — Process conversation results.

## Configuration reference

### Destination and caller ID
- **To** — Phone number(s) to dial, usually from a variable: `@trigger.phone_number`
- **To extension** — Optional extension to dial after connecting
- **From number** — Caller ID shown to recipient
- **Verified caller ID** — Optional Twilio-verified number override

### Voicemail handling
- **Hang up** — Disconnect without a message
- **Fixed message** — Play a pre-written voicemail message
- **AI message** — Generate a personalized voicemail on the fly

### Phone tree navigation
- **Navigate phone trees** — Give agent ability to press DTMF digits during calls
- **Phone tree prompt** — Instructions for navigating IVR menus

### Business hours
- **Respect business hours** — Enforce a schedule on outbound calls
- **Out-of-hours action:**
  - **Sleep** — Queue call until business hours resume
  - **Block** — Cancel call entirely

### Concurrency and rate limiting

| Limit | Scope | Description |
|---|---|---|
| Max concurrent calls | Per organization | Maximum simultaneous outbound calls |
| Calls per second (CPS) | Per SIP trunk | New calls per second through a single trunk |
| Global limit | Platform-wide | Maximum total concurrent calls (default: 100) |

Inbound calls are never subject to concurrency limits.

### Session statuses

| Status | Meaning |
|---|---|
| `completed` | Call connected and conversation finished normally |
| `busy` | Recipient's line was busy |
| `missed` | No answer |
| `voicemail` | Call went to voicemail |
| `failed` | Technical error |
| `canceled` | Cancelled by business hours blocking, contact block, or manual cancellation |

---

# Prompts and Tools

> Write prompts and attach tools to voice agents

Every voice agent contains a **prompt node** that defines the agent's personality, instructions, and conversation behavior. Beneath the prompt node, you can attach **tool nodes** — functions the agent can call mid-conversation to look up data, transfer calls, or perform actions.

## Prompt node

### Prompt fields

| Field | Description |
|---|---|
| **Prompt** | The main system prompt — instructions, personality, conversation flow, and rules |
| **Inbound prompt** | Separate prompt for inbound calls (optional) |
| **Initial message** | First thing the agent says when it joins the call |
| **Receiving initial message** | First thing said when receiving an incoming call |
| **Model** | The language model used to generate responses |
| **No initial message** | When enabled, agent waits silently for the caller to speak first |

### Writing effective prompts

Structure your prompt into clear sections:

1. **Identity** — Who the agent is (name, role, company)
2. **Objective** — The goal of the conversation
3. **Instructions** — Step-by-step conversation flow
4. **Rules** — Guardrails and restrictions
5. **Context** — Background information the agent needs

Example:
```
You are Sarah, a logistics coordinator at Acme Freight.

Your objective is to confirm shipment details with the carrier and collect
the estimated pickup time.

Instructions:
1. Greet the carrier and confirm you're calling about load @trigger.load_id
2. Verify the pickup address: @trigger.pickup_address
3. Ask for their estimated arrival time
4. Confirm the details and thank them

Rules:
- Never disclose rate or payment information
- If the carrier asks about rate, say "I'll have our billing team follow up"
- Keep the conversation professional and concise
```

### Variables in prompts
- `@trigger.customer_name` — Data from the workflow trigger
- `@node_name.output_field` — Output from a previous workflow node
- `@env.company_name` — Organization or workflow environment variable
- `@contact_intelligence_context` — Past interaction history with the caller

## Tool nodes

Tool nodes define functions the agent can call during a conversation.

### Tool configuration

| Field | Description |
|---|---|
| **Description** | Tells the agent when to use this tool. Required. |
| **Message** | What the agent says when using the tool: AI generated, Fixed message, or None |
| **Parameters** | Input parameters the agent extracts from the conversation |
| **Hold music** | Audio played while the tool executes |

### Tool execution flow

1. The agent recognizes the need for a tool based on the conversation and tool description
2. The agent extracts parameter values from the conversation context
3. If configured, the agent speaks the tool message (or plays hold music)
4. The tool's child nodes execute (webhooks, integrations, AI operations, conditions, etc.)
5. The tool returns its output to the agent
6. The agent incorporates the result and continues

### Common tool patterns

- **Call transfer** — Direct Transfer action as a child node. Supports warm handoff, whisper transfer.
- **Data lookup** — Webhook or integration action as a child. Query CRM, TMS, database.
- **Record extraction** — AI Extract node as a child. Extract structured data mid-conversation.
- **Conditional routing** — Condition node as a child. Route to different actions based on data.

## Call transfer

### Transfer types

| Type | Description |
|---|---|
| Direct transfer | Immediately transfer the call. AI agent disconnects. |
| Warm handoff | Agent speaks to recipient first to provide context. |
| Whisper transfer | Message whispered to recipient before caller connects. |

### Transfer configuration
- Number, Extension, Fallback number, Transfer timeout
- Warm handoff message, Whisper message
- Stop recording on transfer, Record transfer conversation
- SIP headers / UUI for custom data passing

---

# STT, TTS, and LLM Configuration

> Configure speech-to-text, text-to-speech, and language model settings

## Speech-to-text (STT)

### Languages
50+ languages supported including:
- English (`en-US`, `en-GB`, `en-AU`, `en-NZ`, `en-IN`)
- Spanish (`es-ES`, `es-AR`, `es-MX`, `es-419`)
- Portuguese (`pt-PT`, `pt-BR`)
- French (`fr-FR`, `fr-CA`)
- German (`de-DE`, `de-CH`)
- Chinese (`zh-CN`, `zh-TW`, `zh-HK`)
- Japanese (`ja`), Korean (`ko`), Arabic (`ar`), Hindi (`hi`)
- And many more

Languages can be static (selected in UI) or dynamic (via variables).

### End-of-turn detection

| Model | Description |
|---|---|
| English | Optimized for English. Best latency and accuracy for English-only calls. |
| Multilingual v1 | Supports multiple languages. |
| Text heuristics | Rule-based detection, most consistent but less nuanced. |

## Text-to-speech (TTS)

### Voices
- Select from ElevenLabs or Cartesia voices
- Multiple voices can be set for A/B testing (randomly assigned per call)
- Browse and preview in Assets > Voices

### Voice speed
0.70 (-30% slower) to 1.20 (+20% faster), default 1.00

### Voice gain
1.00 (normal) to 1.50 (+50% louder)

### Background noise
Call center (default), Coffee shop, Office, Reception, Random, No background noise, or Custom

## Language model (LLM)

### Available models

**OpenAI:**
| Model | Latency | Description |
|---|---|---|
| gpt-4.1 | ~800ms | Recommended for most scenarios. Best balance of speed, intelligence, and tool-calling. |
| gpt-4.1-mini | ~800ms | Lighter version. Good for simple conversations. |
| gpt-5 | ~1300ms | Advanced model with improved capabilities. |
| gpt-5-mini | ~1200ms | Faster version of GPT-5. |
| gpt-5-think | High | GPT-5 with reasoning abilities. |
| gpt-5.1-instant | ~800ms | Powerful as GPT-5 but faster and more conversational. |
| gpt-5.2-instant | ~800ms | GPT-5.2 with no reasoning overhead. |

**Google:**
| Model | Latency | Description |
|---|---|---|
| gemini-2.5-flash | ~400ms | Fast and conversational. |
| gemini-2.5-flash-lite | ~300ms | Faster variant. |
| gemini-2.5-pro | High | With reasoning capabilities. |
| gemini-3-flash-minimal | Low | Gemini 3 Flash with minimal thinking. (Preview) |

**Anthropic (text agents only):**
| Model | Latency | Description |
|---|---|---|
| claude-haiku-4.5 | ~300ms | Fastest Claude model. |
| claude-sonnet-4.5 | ~600ms | Best balance of intelligence, speed, and cost. |
| claude-opus-4.5 | ~1500ms | Maximum intelligence. |

**Recommendation:** Start with **gpt-4.1** for most use cases. Switch to **gemini-2.5-flash** for lower latency with few tool calls.

---

# Documentation Index

Full index of all HappyRobot documentation pages with descriptions.

## Developer Guide Pages

### Get Started
- [Introduction](https://docs.happyrobot.ai/introduction) — Build, deploy, and manage multi-channel AI agents with workflow automation
- [Platform overview](https://docs.happyrobot.ai/platform-overview) — Architecture and key concepts
- [Quickstart](https://docs.happyrobot.ai/quickstart) — Build an outbound voice agent workflow and trigger it via API in 15 minutes

### Workflows
- [Workflows Overview](https://docs.happyrobot.ai/workflows/overview) — Introduction to HappyRobot workflows
- [Creating a Workflow](https://docs.happyrobot.ai/workflows/creating-a-workflow) — Step-by-step guide to building your first workflow
- [Node Types](https://docs.happyrobot.ai/workflows/node-types) — Understanding the different node types
- [Triggers](https://docs.happyrobot.ai/workflows/triggers) — How to configure workflow triggers
- [Variables](https://docs.happyrobot.ai/workflows/variables) — Using variables and dynamic data in workflows
- [Versions and Publishing](https://docs.happyrobot.ai/workflows/versions-and-publishing) — Managing workflow versions
- [Environments](https://docs.happyrobot.ai/workflows/environments) — Configuring dev, staging, and production

### Core Nodes
- [Core Nodes Overview](https://docs.happyrobot.ai/core-nodes/overview) — Built-in nodes that don't require third-party integrations
- [AI Extract](https://docs.happyrobot.ai/core-nodes/ai-extract) — Extract structured data from unstructured text
- [AI Classify](https://docs.happyrobot.ai/core-nodes/ai-classify) — Classify text into predefined categories
- [AI Generate](https://docs.happyrobot.ai/core-nodes/ai-generate) — Generate text content using AI
- [Custom Code](https://docs.happyrobot.ai/core-nodes/custom-code) — Run Python code within your workflow
- [Webhook](https://docs.happyrobot.ai/core-nodes/webhook) — Send and receive HTTP requests
- [Schedule](https://docs.happyrobot.ai/core-nodes/schedule) — Add delays and timing control
- [File Operations](https://docs.happyrobot.ai/core-nodes/file-operations) — Upload, parse, search, and extract text from files
- [Conditionals](https://docs.happyrobot.ai/core-nodes/conditionals) — Add branching logic
- [Loops](https://docs.happyrobot.ai/core-nodes/loops) — Iterate over collections
- [Module Change](https://docs.happyrobot.ai/core-nodes/module-change) — Jump to a different module

### Tools
- [Tools Overview](https://docs.happyrobot.ai/tools/overview) — Introduction to tools in HappyRobot
- [Creating Tools](https://docs.happyrobot.ai/tools/creating-tools) — How to create and configure tools
- [Built-in Tools](https://docs.happyrobot.ai/tools/built-in-tools) — Default tools that come with agents
- [MCP Tools](https://docs.happyrobot.ai/tools/mcp) — Import tools from external MCP servers
- [MCP Server Setup](https://docs.happyrobot.ai/tools/mcp-server) — Connect external MCP servers

### Voice Agents
- [Voice Agents Overview](https://docs.happyrobot.ai/voice-agents/overview) — Introduction to voice AI agents
- [Inbound Calls](https://docs.happyrobot.ai/voice-agents/inbound-calls) — Configure agents to handle incoming phone calls
- [Outbound Calls](https://docs.happyrobot.ai/voice-agents/outbound-calls) — Set up automated outbound calling campaigns
- [Outbound with Callback](https://docs.happyrobot.ai/voice-agents/outbound-with-callback) — Handle callbacks from missed outbound calls
- [STT, TTS, and LLM Configuration](https://docs.happyrobot.ai/voice-agents/stt-tts-llm-configuration) — Configure speech, voice, and model settings
- [Prompts and Tools](https://docs.happyrobot.ai/voice-agents/prompts-and-tools) — Write prompts and attach tools

### Text Agents
- [Text Agents Overview](https://docs.happyrobot.ai/text-agents/overview) — Introduction to text-based AI agents
- [SMS](https://docs.happyrobot.ai/text-agents/sms) — Deploy text agents over SMS
- [WhatsApp](https://docs.happyrobot.ai/text-agents/whatsapp) — Deploy text agents on WhatsApp
- [Email](https://docs.happyrobot.ai/text-agents/email) — Deploy text agents for email conversations
- [Chatbot](https://docs.happyrobot.ai/text-agents/chatbot) — Embed a chatbot widget on your website
- [Microsoft Teams](https://docs.happyrobot.ai/text-agents/teams) — Deploy text agents in Microsoft Teams

### Runs and Monitoring
- [Runs Overview](https://docs.happyrobot.ai/runs/overview) — Monitor and manage workflow executions
- [Run Statuses](https://docs.happyrobot.ai/runs/run-statuses) — Understanding run lifecycle and status codes
- [Transcripts and Messages](https://docs.happyrobot.ai/runs/transcripts-and-messages) — View conversation transcripts
- [Recordings](https://docs.happyrobot.ai/runs/recordings) — Access and manage call recordings
- [Annotations](https://docs.happyrobot.ai/runs/annotations) — Add annotations and notes to runs

### Assets
- [Knowledge Bases](https://docs.happyrobot.ai/assets/knowledge-bases) — Upload and manage documents for agent reference
- [Components](https://docs.happyrobot.ai/assets/components) — Reusable prompt components and templates
- [Telephony](https://docs.happyrobot.ai/assets/telephony) — Manage phone numbers, SIP trunks, and audio assets
- [Voices](https://docs.happyrobot.ai/assets/voices) — Browse and preview TTS voices

### Integrations
- [Integrations Overview](https://docs.happyrobot.ai/integrations/overview) — Connect to external tools and services
- [Credentials](https://docs.happyrobot.ai/integrations/credentials) — Manage authentication for integrations
- Communication: Gmail, Outlook, Slack, Microsoft Teams, Twilio SMS, WhatsApp, SendGrid, HappyRobot Email
- Business Systems: McLeod TMS, Turvo TMS, TPro, 3PL, Custom TMS, Broker App, CXone
- Data and Storage: Google Sheets, Snowflake, Redis, Google Maps

### Settings
- [API Keys](https://docs.happyrobot.ai/settings/api-keys) — Generate and manage API keys
- [Environment Variables](https://docs.happyrobot.ai/settings/environment-variables) — Configure environment variables
- [Organization](https://docs.happyrobot.ai/settings/organization) — Manage organization settings
- [Team Members and Roles](https://docs.happyrobot.ai/settings/team-members-and-roles) — Invite members and configure roles
- [Usage and Billing](https://docs.happyrobot.ai/settings/billing) — Monitor usage and credit consumption
- [Workflow Settings](https://docs.happyrobot.ai/settings/workflow-settings) — Configure settings for individual workflows

## API Reference

Base URL: `https://platform.happyrobot.ai`
Auth: `Authorization: Bearer sk_live_...` or `x-api-key: sk_live_...`
OpenAPI spec: `https://platform.happyrobot.ai/api/v2/docs/json`

Key API endpoints:
- **Trigger a workflow run**: `POST /hooks/{workflow_slug}`
- **List workflows**: `GET /api/v2/workflows`
- **Get a workflow**: `GET /api/v2/workflows/{id}`
- **Create a workflow**: `POST /api/v2/workflows`
- **List workflow runs**: `GET /api/v2/workflows/{id}/runs`
- **Get run**: `GET /api/v2/runs/{id}`
- **List run sessions**: `GET /api/v2/runs/{id}/sessions`
- **Get session messages**: `GET /api/v2/sessions/{id}/messages`
- **Stream session messages (SSE)**: `GET /api/v2/sessions/{id}/messages/stream`
- **Get recordings**: `GET /api/v2/runs/{id}/recordings`
- **List contacts**: `GET /api/v2/contacts`
- **List integrations**: `GET /api/v2/integrations`
- **Phone numbers**: `GET /api/v2/phone-numbers`
- **Knowledge bases**: `GET /api/v2/knowledge-bases/{id}`
- **MCP servers**: `GET /api/v2/mcp-servers`
