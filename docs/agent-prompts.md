# Agent scripts and administration

The four original seed scripts live in `server/agent_seeds.py`. They are demonstration
starting points, not prompts proven to meet production conversion or reliability targets.
They use role names, short spoken turns, a single question per turn, explicit uncertainty
handling, context-specific workflows and examples. Scheduling requests are preferences,
not live bookings; all voice actions remain simulated.

Research consulted:
- https://docs.vapi.ai/prompting-guide — structured voice prompts, concise turns, examples,
  explicit context, failure recovery, and testing across representative conversations.
- https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompt-templates-and-variables
  — clear instructions and structured prompt content.
- https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
  — random server-side sessions, expiry, HttpOnly cookies, secure cookies for HTTPS.

## First admin login

Generate a one-time token with `openssl rand -hex 32`, save it as `ADMIN_SETUP_TOKEN` in
`server/.env`, and restart the server. Open http://127.0.0.1:5175/admin-login/, enter that
token, and create the owner username and password. The browser setup endpoint closes after
the first account exists. Remove or rotate the setup token afterward. The terminal command
`uv run agent_admin.py` remains available as a local account-recovery tool.

Save applies to new calls. Each call receives a server-loaded snapshot of an enabled agent;
public request bodies cannot override its greeting, prompt or voice. Edits use version checks,
and previous versions are retained in the revisions table. There is no rollback UI yet.
The public catalog exposes only IDs, names and descriptions. The editor manages the four
seeded roles; creating arbitrary new roles is not yet exposed in the UI.

PostgreSQL is required. Set its connection string as `DATABASE_URL`; the same database stores
the owner account, sessions, agent versions, call limits, and transcripts. Use the included
Docker Compose service locally and a managed PostgreSQL service in production.

The local frontend proxies `/api` to port 7860. Vite preview uses `ADMIN_API_TARGET`
(default http://127.0.0.1:7860). Other hosting must proxy `/api` to the backend on the same
origin. Set `ADMIN_ORIGINS` to the exact deployed frontend origin and
`ADMIN_COOKIE_SECURE=true` for HTTPS. The local `.env` uses false for HTTP development.
Login attempts are limited to ten per 15 minutes per connecting IP. Forwarded IP headers
are deliberately not trusted, so users behind one reverse proxy share this limit.

## Voice acceptance checklist

For each role: listen to greeting, complete normal flow, interrupt, correct a detail, give an
unclear answer twice, request a person, ask an out-of-scope question, and ask to stop.
Confirm the assistant doesn't invent prices, policies, availability or completed actions.
For scheduling, test relative dates, ambiguous dates and timezone corrections.
For support, test angry callers and refund demands. For qualification, test price requests
and a caller who declines to continue. For tow, test wrong person and a declined shop offer.
Automated tests cover the registry/security paths; they do not establish spoken quality.

## Call guardrails and history

Calls have a 900-second server deadline. A closing message is queued at 890 seconds;
the connection closes at the deadline even if speech is still queued. With no caller
activity for 90 seconds, a closing message is queued and the call ends ten seconds later.
An outer timeout also covers initialization. Each connecting IP may have one reserved or
active demo, with a 60-second cooldown. This is per-call/IP protection, not verified-user
identity or a daily quota. Shared networks share limits; trusted-proxy IP handling must be
configured before deployment behind a reverse proxy.

Admin → Call history shows persistent transcripts, start/end times, agent version,
and ending reason. No audio is stored. Generated agent text may include interrupted speech.
The demo discloses transcript storage before calling. Records are retained until manually
removed by the operator; production retention policy and backups should be configured.
