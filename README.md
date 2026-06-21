# Gmail Triage Agent

A serverless AI agent that automatically triages, labels, and cleans your Gmail inbox — running entirely on Google Apps Script with no server required.

Every 15 minutes it classifies new emails using Claude AI, auto-deletes low-value mail, and sends you a daily digest with one-click actions for anything it wasn't sure about.

**Cost:** $0 infrastructure · ~$1–2/month in Claude API fees

---

## Features

- **AI triage** — classifies every email as delete, keep, or review using Claude Haiku
- **Rule engine** — handles obvious cases (newsletters, promotions, OTPs) for free, before calling the AI
- **Label taxonomy** — applies nested Gmail labels automatically: `Finance/Invoices`, `Travel/Bookings`, `Work/HR`, `Shopping/Shipping`, and more
- **Needs Reply detection** — flags emails where someone is waiting on your response
- **Time-Sensitive detection** — extracts deadlines and surfaces them prominently in the digest
- **Daily HTML digest** — one email at 8am with Delete / Keep / Unsubscribe buttons; no app to open
- **Batch sender blocking** — permanently block repeat offenders across all of Gmail in one click
- **Auto-whitelist** — builds a trusted sender list from your Sent Mail so contacts are never deleted
- **Self-healing** — uses continuation triggers to resume long-running scans across the 6-minute Apps Script limit

---

## How It Works

```
New email arrives
       │
       ▼
Gmail category Promotions / Social / Updates / Forums?
       ├── YES → Auto-trash + queue unsubscribe suggestion
       └── NO ↓
       ▼
Sender whitelisted (you've emailed them before)?
       ├── YES → Keep
       └── NO ↓
       ▼
Subject / body matches rule engine keywords?
       ├── YES → Apply rule (keep or delete)
       └── NO ↓
       ▼
Claude Haiku AI triage
       ├── Confidence ≥ 0.90 → Auto-trash immediately
       ├── Confidence 0.72–0.90 → Queue for digest approval
       └── Confidence < 0.72 → Leave in inbox, log for review
```

All decisions are logged to a Google Sheet (**Gmail Triage DB**) that auto-creates in your Drive.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Google Apps Script (V8) |
| AI | Claude Haiku via Anthropic API |
| Storage | Google Sheets (no external DB) |
| Email | Gmail API via GmailApp |
| Deployment | clasp CLI |
| Web app | Apps Script Web App (for digest action links) |

---

## Prerequisites

- Google account (the Gmail you want to clean)
- [Anthropic API key](https://console.anthropic.com) — Claude Haiku is cheap; expect ~$1–2/month for a typical inbox
- Node.js v18+ — [nodejs.org](https://nodejs.org)
- clasp CLI — `npm install -g @google/clasp`

---

## Setup

### 1. Clone and configure clasp

```bash
git clone https://github.com/AnneshaBh/Gmail-Triage-Agent.git
cd Gmail-Triage-Agent
cp .clasp.json.example .clasp.json
```

Open `.clasp.json` and replace `YOUR_SCRIPT_ID_HERE` with your Apps Script project ID (see next step).

### 2. Create an Apps Script project

1. Go to [script.google.com](https://script.google.com) → **New project**
2. Copy the script ID from the URL: `https://script.google.com/d/**<SCRIPT_ID>**/edit`
3. Paste it into `.clasp.json`

### 3. Set your timezone

Open `src/appsscript.json` and set `"timeZone"` to your local timezone (e.g. `"America/New_York"`, `"Asia/Kolkata"`). This controls when the 8am daily digest fires.

### 4. Push the code

```bash
clasp login        # opens browser — approve Google access
clasp push         # uploads all source files to your Apps Script project
```

### 5. Set Script Properties

In Apps Script editor → **Project Settings → Script Properties**, add:

| Property | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Claude API key from console.anthropic.com |
| `WEB_APP_URL` | Set this after step 6 below |

> `WEBHOOK_SECRET` is auto-generated on first run — you do not need to set it manually.

### 6. Deploy as Web App

In Apps Script editor → **Deploy → New Deployment**:
- Type: **Web App**
- Execute as: **Me**
- Who has access: **Anyone** (needed for digest action links to work)

Copy the deployment URL and save it as `WEB_APP_URL` in Script Properties.

### 7. Run one-time setup functions

In the Apps Script editor, run these functions **once** in order:

| Function | What it does |
|---|---|
| `setupLabels()` | Creates the full label taxonomy in your Gmail |
| `setupTriggers()` | Creates the 4 automatic time-based triggers |
| `buildWhitelist()` | Scans your Sent Mail to build the trusted sender list |

### 8. Run the historical scan (optional but recommended)

```
Run → runHistoricalScan()
```

Processes your entire existing inbox. Auto-continues across multiple runs due to the Apps Script 6-minute execution limit. You will receive a "Scan Complete" email when finished.

For a large inbox (10K+ emails), also run:
```
Run → runCategorizationScan()
```
This applies category labels to already-triaged emails without re-triaging them.

---

## Label Taxonomy

The agent automatically applies these nested Gmail labels:

| Label | Applied when |
|---|---|
| `Finance/Invoices` | Bills and payment requests |
| `Finance/Receipts` | Purchase receipts and payment confirmations |
| `Finance/Statements` | Bank and account statements |
| `Finance/Tax` | Tax documents and related correspondence |
| `Travel/Bookings` | Flight, hotel, and transport confirmations |
| `Travel/Itinerary` | Boarding passes, check-in reminders |
| `Work/Projects` | Project updates and team communications |
| `Work/HR` | Payroll, leave, benefits |
| `Work/Learning` | Courses, certifications, training |
| `Shopping/Orders` | Order confirmations |
| `Shopping/Shipping` | Dispatch and delivery notifications |
| `Shopping/Promos` | Discount codes and sale alerts |
| `Notifications/OTP` | One-time passwords and 2FA codes |
| `Notifications/Alerts` | Security and account alerts |
| `Notifications/Social` | LinkedIn and social media notifications |
| `Newsletters` | Subscription newsletters and digests |
| `Needs Reply` | Emails where someone is waiting on your response |
| `Time-Sensitive` | Emails with an explicit deadline or expiry |

---

## Daily Digest

Every morning at 8am you receive one HTML email with:

- **Needs Reply** — emails flagged as awaiting your response (Dismiss to clear)
- **Time-Sensitive** — pending emails with extracted deadlines (Delete or Keep)
- **Unsubscribe Suggestions** — auto-trashed senders with a detected unsubscribe link
- **Pending Review** — emails the AI wasn't confident enough to auto-delete (Delete or Keep)
- **Frequent Deletions** — senders deleted 3+ times, offered for permanent blocking
- **Auto-Trashed** — summary log of what ran automatically in the last 24 hours

All buttons execute immediately via the deployed Web App — no login required.

---

## Configuration

All thresholds are in `src/00_Config.gs`:

| Constant | Default | Meaning |
|---|---|---|
| `AUTO_DELETE_THRESHOLD` | `0.90` | Confidence above which emails are auto-trashed immediately |
| `BATCH_NOTIFY_THRESHOLD` | `0.72` | Confidence above which emails are queued for digest review |
| `BATCH_BLOCK_THRESHOLD` | `3` | Delete count before a sender appears in "Block Sender" section |
| `MAX_THREADS_PER_RUN` | `50` | Threads processed per 15-minute polling run |

---

## File Structure

```
src/
├── 00_Config.gs        — Constants, thresholds, Script Property helpers
├── 01_Storage.gs       — Google Sheets CRUD (Senders, Actions, Pending, Whitelist, ReplyRequired, BlockList)
├── 02_Whitelist.gs     — Trusted sender list built from Sent Mail
├── 03_RuleEngine.gs    — Pre-AI rule engine + category/time-sensitivity detection
├── 04_ClaudeAgent.gs   — Claude Haiku API calls and response parsing
├── 05_GmailFetcher.gs  — Gmail thread reads, trash, unsubscribe link extraction
├── 06_Unsubscribe.gs   — Executes List-Unsubscribe via mailto or HTTPS
├── 07_Digest.gs        — Builds and sends the daily HTML digest email
├── 08_WebApp.gs        — Web App handler for digest action links
├── 09_Triggers.gs      — Time-based trigger setup and expired pending cleanup
├── 10_Main.gs          — Entry points: scan, triage, digest, batch block
└── 11_Labels.gs        — Gmail label creation and taxonomy management
```

---

## Gmail API Quota

Google Apps Script has a daily Gmail API quota. To avoid hitting it:

- Run `runHistoricalScan()` and `runCategorizationScan()` on separate days if your inbox is large
- Block senders from the digest one at a time (3–5 per day max), not all at once
- The 15-minute triage trigger is lightweight and stays well within daily limits

---

## License

MIT — free to use, modify, and distribute.
