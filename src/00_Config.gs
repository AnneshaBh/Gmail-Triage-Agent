// ─── Constants ────────────────────────────────────────────────────────────────
const CLAUDE_MODEL_FAST  = 'claude-haiku-4-5-20251001'; // bulk triage — cheap & fast
const CLAUDE_MODEL_SMART = 'claude-sonnet-4-6';          // edge cases only

const AUTO_DELETE_THRESHOLD  = 0.90; // above this → auto-trash immediately
const BATCH_NOTIFY_THRESHOLD = 0.72; // above this → queue for digest approval
const MAX_THREADS_PER_RUN    = 50;   // threads processed per polling run
const SPREADSHEET_NAME       = 'Gmail Triage DB';
const BATCH_BLOCK_THRESHOLD  = 3;    // delete count before sender surfaces in digest Batch Actions

// ─── Label taxonomy ───────────────────────────────────────────────────────────
// Maps every valid category label path to a plain-English description.
// Used in the Claude prompt (04_ClaudeAgent.gs) so the AI always picks from
// this list, and in the rule engine (03_RuleEngine.gs) for keyword→category mapping.
// Special labels (Needs Reply, Time-Sensitive) are applied by the system, not Claude.
const LABEL_TAXONOMY = {
  'Finance/Invoices':     'Bills, invoices, payment requests from services or vendors',
  'Finance/Receipts':     'Purchase receipts and payment confirmations',
  'Finance/Statements':   'Bank, credit card, or investment account statements',
  'Finance/Tax':          'Tax documents, filings, and related correspondence',
  'Travel/Bookings':      'Flight, hotel, train, or car rental confirmations',
  'Travel/Itinerary':     'Check-in reminders, boarding passes, travel schedules',
  'Work/Projects':        'Work email, project updates, team communications',
  'Work/HR':              'Payroll, leave, benefits, HR notices',
  'Work/Learning':        'Courses, certifications, training materials, upskilling',
  'Shopping/Orders':      'E-commerce order confirmations',
  'Shopping/Shipping':    'Dispatch notifications, tracking updates, delivery confirmations',
  'Shopping/Promos':      'Discount codes, sale alerts, promotional offers',
  'Notifications/OTP':    'One-time passwords, 2FA codes, login verification',
  'Notifications/Alerts': 'Account alerts, security notices, app notifications',
  'Notifications/Social': 'LinkedIn and other social media platform notifications',
  'Newsletters':          'Subscription newsletters, digests, editorial content',
};

// ─── Property helpers ─────────────────────────────────────────────────────────
function getApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY not set — add it in Project Settings → Script Properties');
  return key;
}

function getUserEmail_() {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('USER_EMAIL');
  if (stored) return stored;
  const email = Session.getActiveUser().getEmail();
  props.setProperty('USER_EMAIL', email);
  return email;
}

function getWebAppUrl_() {
  return PropertiesService.getScriptProperties().getProperty('WEB_APP_URL') || '';
}

function getWebhookSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('WEBHOOK_SECRET');
  if (!secret) {
    secret = Utilities.getUuid();
    props.setProperty('WEBHOOK_SECRET', secret);
  }
  return secret;
}
