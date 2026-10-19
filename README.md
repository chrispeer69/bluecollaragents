# Blue Collar Agents

A standalone browser lab for testing a lower-cost, open-source-orchestrated alternative to the current Retell outbound towing agent. It uses [Pipecat](https://github.com/pipecat-ai/pipecat) for the realtime voice pipeline, Anthropic for the conversation model, and Deepgram for speech recognition and synthesis.

This repository is isolated from `us-tow-ai-connect`. It uses sanitized fixture data, does not read tenant/customer records, does not place telephone calls, and cannot write to production systems.

## What Chris can test

- Talk to Emily from a browser with normal interruptions
- Compare Claude Sonnet 4.6 and Haiku 4.5
- Compare five Deepgram voices
- Edit the compact agent prompt and rendered two-offer call script
- Review the current Script Builder configuration without Offer 3
- Switch among the real production routes: competitor repair, auto body, residence, unknown, our shop, and AAA-branded destination
- See the live transcript, response latency, actual LLM input/output tokens, separate STT/TTS/LLM costs, and total estimated cost per call
- Save scored comparisons locally in the browser

The compact prompt preserves the current Emily flow while reducing combined prompt text from 30,691 to 8,193 characters (about 73%).

## Requirements

- Python 3.11–3.13
- [uv](https://docs.astral.sh/uv/)
- Node.js 20+
- Anthropic API key
- Deepgram API key

A phone number, Twilio account, Retell account, and LiveKit account are not required for browser testing.

## Run locally

Start the local PostgreSQL database from the repository root:

```bash
docker compose up -d postgres
docker compose ps
```

The local connection is `postgresql://bluecollar:bluecollar_dev@127.0.0.1:5437/bluecollaragents`.
The backend creates the required tables and seed agents when it starts. Docker stores the data
in the named `bluecollaragents-postgres-data` volume, so container restarts retain it.

Start the backend:

```bash
cd server
cp .env.example .env
# Add ANTHROPIC_API_KEY and DEEPGRAM_API_KEY to .env
uv sync
uv run bot.py
```

Start the frontend in another terminal:

```bash
cd client
cp .env.example .env.local
npm install
npm run dev
```

Open `http://127.0.0.1:5174`, allow microphone access, and click **Answer Emily's call**.

Open `http://127.0.0.1:5175/admin-login/` to create or access the owner account.

## Deploy to Railway

Create a Railway project with PostgreSQL plus two services from this repository. Set the backend service Root
Directory to `/server` and its Config File Path to `/server/railway.json`. Set
the frontend service Root Directory to `/client` and its Config File Path to
`/client/railway.json`. Railway cannot detect the application when the repository
root is deployed because this is an isolated Python/Node monorepo.

Backend variables:

```text
ANTHROPIC_API_KEY=...
DEEPGRAM_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-6
DEEPGRAM_VOICE=aura-2-luna-en
SAFE_TEST_MODE=true
PIPECAT_ALLOWED_ORIGINS=https://YOUR-FRONTEND.up.railway.app
DATABASE_URL=${{Postgres.DATABASE_URL}}
ADMIN_COOKIE_SECURE=true
ADMIN_ORIGINS=https://YOUR-FRONTEND.up.railway.app
ADMIN_SETUP_TOKEN=GENERATE_A_LONG_RANDOM_ONE_TIME_VALUE
```

Frontend runtime/build variables:

```text
ADMIN_API_TARGET=https://YOUR-BACKEND.up.railway.app
VITE_AGENT_URL=
VITE_GHL_CALENDAR_URL=https://links.bluecollarai.online/widget/booking/0lPVaFEYVGFlxxPLeYeK
```

Generate a public domain for both services. Keep `VITE_AGENT_URL` blank so the browser uses
the frontend's same-origin `/api` and `/lab` proxy; `ADMIN_API_TARGET` supplies the backend
target at runtime. Do not set `PORT`; Railway supplies it. After the first owner account is
created at `/admin-login/`, rotate or remove `ADMIN_SETUP_TOKEN` and redeploy the backend.

Before exposing the URL, confirm `/api/agents` is healthy, start one voice demo through the
frontend domain, verify the greeting and transcript, sign into `/admin-login/`, and make one
test GHL booking. The server enforces a 15-minute call ceiling and a 90-second idle timeout;
the public page does not advertise those internal controls.

## Cost display

Pipecat forwards Anthropic's reported input/output token usage and speech usage to the browser. The UI calculates:

- Deepgram speech-to-text cost
- Deepgram text-to-speech cost
- Claude input/output cost for the selected model
- Combined cost for the test call

Provider invoices remain the billing source of truth. Pricing constants in the prototype should be reviewed before a production deployment.

The lab reports consumption for the current call. It does not query or display the remaining prepaid balance in either provider account.

## Safety

`SAFE_TEST_MODE=true` is required. All included tool functions are deterministic simulations. Keep API keys only in `server/.env` locally or in secret environment variables on a hosting provider. The checked-in `.gitignore` excludes environment files, virtual environments, dependencies, and generated builds.

## Production work still required

The browser lab proves the conversation pipeline. Real outbound calling additionally requires a carrier such as Twilio, call queuing/concurrency controls, production job lookup and writeback tools, webhook-compatible transcripts/outcomes, monitoring, and deployment hardening.

## Blue Collar Agents experience

The customer view pairs an animated voice blob with the live conversation. Animation follows the existing call and speaking events (not audio amplitude); reduced-motion preferences are respected. Scripts, voices, metrics, scoring, and call history are excluded from the customer interface and live in the authenticated admin workspace.

The **Contact sales** link opens the dedicated `/contact-sales.html` page with the GHL booking calendar. The demo page contains no calendar embed. Set `VITE_GHL_CALENDAR_URL` in `client/.env` to your HTTPS public calendar embed URL, then restart Vite (or rebuild for deployment). This is a public URL, not an API key. Until configured, the section shows a scheduling-unavailable message. GHL supplies the booking form and availability; the app does not create local appointments or call GHL APIs. Owner or team-member names rendered inside the cross-origin GHL form must be configured in GHL; the website cannot override that embedded content.

## Agent scripts and admin

Four role-based demos load their scripts and greetings from the backend. Visit `/admin-login/`
to create the first owner account and manage names, scripts, voices, availability, and call
transcripts. Set a long random `ADMIN_SETUP_TOKEN` on the server before first-time setup.
See [agent administration and prompt research](docs/agent-prompts.md) for deployment,
backup, security and voice acceptance checks. No voice demo performs real bookings.

The admin **Business website** tool uses Scrapling to preview public facts from a submitted
company domain. It checks the homepage and up to three same-domain business-information pages,
extracts descriptions, service headings, structured hours, phone numbers, and addresses, and
requires review before saving. The admin then selects one of the four agent categories, assigns
1–120 total trial minutes, and generates a unique customer URL. Each URL snapshots the reviewed
business context, locks the selected category, and tracks consumed call time in PostgreSQL.
Private/local addresses, nonstandard ports, cross-domain pages, and oversized imports are rejected.
