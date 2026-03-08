# Email to Carlos Becker

**To:** Carlos Becker (c.becker@happyrobot.ai)
**CC:** [Recruiter Name] ([recruiter@email.com])
**Subject:** Inbound Carrier Sales AI — Build Update Ahead of Our Meeting

---

Hi Carlos,

Wanted to share a quick update on where the Inbound Carrier Sales build stands ahead of our meeting.

**What's live right now:**

The full system is deployed and running on AWS — a containerized Node.js API on App Runner backed by DynamoDB, with the AI voice agent configured on the HappyRobot platform. You can call the inbound number and go through a complete carrier interaction end to end: FMCSA verification, load matching, rate negotiation, and booking with transfer.

**Key capabilities I'll walk you through:**

- **Carrier Verification** — Real-time FMCSA authority lookup by MC number. Unauthorized carriers are filtered out immediately.
- **Intelligent Load Search** — Geocodes the carrier's origin city and searches a 1,500-mile radius using Haversine distance. Results include deadhead miles, effective RPM, and are sorted by proximity. The agent silently retries with relaxed filters (date, equipment) before ever telling the carrier the board is empty.
- **Automated Negotiation Engine** — Server-side 3-round negotiation logic. The agent never calculates rates on its own — every offer, counter, and acceptance goes through the API. Starts at 85% of market, steps up through 90%/95%, and caps at 100%. The LLM follows the tool's instructions exactly.
- **Timezone Awareness** — The agent resolves the carrier's local date/time before interpreting pickup dates, handling the multi-timezone US correctly.
- **Live Dashboard** — Real-time metrics at `/dashboard.html`: KPIs (total calls, booking rate, savings), conversion funnel, load origins map, rate waterfall, negotiation round distribution, equipment mix, carrier sentiment, top lanes, and top carriers. Built with DaisyUI + Chart.js + Leaflet.

**Links:**

- **Live API:** https://4n3uiqqjvx.us-east-1.awsapprunner.com
- **Dashboard:** https://4n3uiqqjvx.us-east-1.awsapprunner.com/dashboard.html?api_key=happy2025secret
- **Code Repository:** https://github.com/janvdhorst/JanFDE
- **HappyRobot Workflow:** https://platform.happyrobot.ai/fdejan/workflow/1zoox0eqgf6t/editor/llnit2ax0pzy

**Infrastructure:** Everything is deployed via Terraform and a single `deploy.sh` script — ECR, App Runner, DynamoDB tables, and IAM roles. The whole stack can be torn down and rebuilt in minutes.

I'll prepare a short demo call during our meeting so you can hear the agent in action. Looking forward to it.

Best,
Jan
