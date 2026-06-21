// Rule engine runs before Claude — handles obvious cases for free.
// Returns a decision object or null (meaning: send to Claude).

const PROMO_KEYWORDS      = ['unsubscribe', 'newsletter', 'promotional', 'offer', 'deal', 'discount', 'sale', 'marketing', 'coupon'];
const NEWSLETTER_KEYWORDS = ['newsletter', 'mailing list', 'you are receiving this', 'you received this because', 'opt out', 'email preferences', 'manage preferences', 'unsubscribe'];
const IMPORTANT_KEYWORDS  = ['invoice', 'receipt', 'order', 'confirmation', 'booking', 'ticket', 'statement', 'account', 'security', 'password', 'verify', 'otp', '2fa', 'alert'];
const IMPORTANT_DOMAINS   = ['bank', 'paypal', 'amazon', 'apple', 'google', 'microsoft', 'gov', 'irs', 'insurance', 'hdfc', 'icici', 'sbi', 'axis']; // add your own bank/institution domains here

// Gmail categories that are always auto-deleted — no AI, no pending queue
const AUTO_DELETE_CATEGORIES = ['promotions', 'social', 'updates', 'forums'];

const TIME_SENSITIVE_KEYWORDS_ = [
  'expires', 'expiring', 'deadline', 'respond by', 'rsvp by',
  'last chance', 'today only', 'offer ends', 'ends today', 'ends tonight',
  '24 hours', '48 hours', 'act now', 'limited time',
];

// Ordered — first match wins
const DEADLINE_PATTERNS_ = [
  /\b(today|tonight|tomorrow)\b/i,
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i,
  /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
  /by\s+\w+\s+\d{1,2}\b/i,
];

function applyRules_(sender, senderName, subject, snippet, gmailCategory) {
  const emailLow   = sender.toLowerCase();
  const subjectLow = (subject  || '').toLowerCase();
  const snippetLow = (snippet  || '').toLowerCase();

  // BlockList → immediate delete, bypasses all other logic
  if (isBlocked_(emailLow)) {
    return { action: 'delete', confidence: 1.0, reason: 'Sender is on your block list', source: 'rule' };
  }

  // Whitelisted → always keep, even if in Promotions/Social category
  if (isWhitelisted_(emailLow)) {
    return { action: 'keep', confidence: 1.0, reason: 'Sender is in your whitelist (you have emailed them before)', source: 'rule' };
  }

  // Important subject keywords → keep; resolve category and time-sensitivity
  if (IMPORTANT_KEYWORDS.some(k => subjectLow.includes(k))) {
    const category = detectCategory_(subjectLow, snippetLow, gmailCategory);
    const ts       = detectTimeSensitive_(subjectLow, snippetLow);
    return { action: 'keep', confidence: 0.88, reason: 'Subject contains an important keyword (receipt, invoice, etc.)', source: 'rule', category, ...ts };
  }

  // Known financial / government domain → keep
  if (IMPORTANT_DOMAINS.some(d => emailLow.includes(d))) {
    const category = detectCategory_(subjectLow, snippetLow, gmailCategory) || 'Finance/Statements';
    const ts       = detectTimeSensitive_(subjectLow, snippetLow);
    return { action: 'keep', confidence: 0.90, reason: 'Sender appears to be a financial or institutional domain', source: 'rule', category, ...ts };
  }

  // Gmail category Promotions / Social / Updates / Forums → always auto-delete, ask to unsubscribe
  if (AUTO_DELETE_CATEGORIES.includes(gmailCategory)) {
    const catMap = { promotions: 'Shopping/Promos', social: 'Notifications/Social', updates: 'Newsletters', forums: 'Newsletters' };
    return { action: 'delete', confidence: 0.99, reason: `Auto-deleted: Gmail category "${gmailCategory}"`, source: 'rule', needsUnsubscribeCheck: true, category: catMap[gmailCategory] };
  }

  // Newsletter detected in email body → auto-delete, ask to unsubscribe
  if (NEWSLETTER_KEYWORDS.some(k => snippetLow.includes(k))) {
    return { action: 'delete', confidence: 0.99, reason: 'Newsletter content detected', source: 'rule', needsUnsubscribeCheck: true, category: 'Newsletters' };
  }

  // Previously auto-approved 3+ times → auto-delete immediately
  if (isAutoApproved_(emailLow)) {
    const category = detectCategory_(subjectLow, snippetLow, gmailCategory);
    return { action: 'delete', confidence: 0.98, reason: 'Sender was approved for auto-deletion 3+ times', source: 'rule', category };
  }

  // No rule matched — defer to Claude
  return null;
}

function getGmailCategory_(thread) {
  const labels = thread.getLabels().map(l => l.getName().toLowerCase());
  if (labels.some(l => l.includes('promotions'))) return 'promotions';
  if (labels.some(l => l.includes('social')))      return 'social';
  if (labels.some(l => l.includes('forums')))      return 'forums';
  if (labels.some(l => l.includes('updates')))     return 'updates';
  return 'primary';
}

// ─── Category detection ───────────────────────────────────────────────────────
// Checks subject + snippet text against keyword patterns; returns the most
// specific matching label path or null (Claude will decide at that point).
function detectCategory_(subjectLow, snippetLow, gmailCategory) {
  const text = subjectLow + ' ' + snippetLow;

  // Finance
  if (/\b(invoice|billing)\b/.test(text))                                     return 'Finance/Invoices';
  if (/\b(receipt|paid|payment received|payment confirmation)\b/.test(text))  return 'Finance/Receipts';
  if (/\b(statement|account summary|account statement)\b/.test(text))         return 'Finance/Statements';
  if (/\b(tax|gst|vat|itr|form 16|pan)\b/.test(text))                        return 'Finance/Tax';

  // Travel
  if (/\b(flight|hotel|booking|reservation|check.in|train ticket|bus ticket|car rental)\b/.test(text)) return 'Travel/Bookings';
  if (/\b(boarding pass|itinerary|departure|gate|baggage|e-ticket)\b/.test(text))                      return 'Travel/Itinerary';

  // Shopping
  if (/\b(order confirm|order placed|order #|purchase confirm|order received)\b/.test(text)) return 'Shopping/Orders';
  if (/\b(shipped|dispatched|tracking|out for delivery|delivered|delivery update)\b/.test(text))        return 'Shopping/Shipping';
  if (/\b(discount|coupon|promo code|sale|% off|special offer|deal)\b/.test(text))                     return 'Shopping/Promos';

  // Notifications
  if (/\b(otp|one.time (password|code)|2fa|verification code|authenticat)\b/.test(text)) return 'Notifications/OTP';
  if (/\b(security alert|password reset|suspicious|login attempt|unusual activity)\b/.test(text))       return 'Notifications/Alerts';
  if (/\b(linkedin|twitter|instagram|facebook|youtube|social)\b/.test(text))                            return 'Notifications/Social';

  // Work
  if (/\b(payslip|payroll|salary|reimbursement|expense claim|leave balance)\b/.test(text)) return 'Work/HR';
  if (/\b(course|certificate|learning path|training|webinar|udemy|coursera|pluralsight)\b/.test(text))  return 'Work/Learning';

  // Newsletters — fallback before Gmail-category fallback
  if (/\b(newsletter|digest|weekly roundup|monthly update|edition)\b/.test(text)) return 'Newsletters';

  // Gmail category fallback
  const catMap = { promotions: 'Shopping/Promos', social: 'Notifications/Social', updates: 'Newsletters', forums: 'Newsletters' };
  return catMap[gmailCategory] || null;
}

// ─── Time-sensitivity detection ───────────────────────────────────────────────
// Returns { timeSensitive, deadline } spread into the decision object.
function detectTimeSensitive_(subjectLow, snippetLow) {
  const text = subjectLow + ' ' + snippetLow;
  if (!TIME_SENSITIVE_KEYWORDS_.some(k => text.includes(k))) {
    return { timeSensitive: false, deadline: null };
  }
  let deadline = null;
  for (const pattern of DEADLINE_PATTERNS_) {
    const match = text.match(pattern);
    if (match) { deadline = match[0].trim(); break; }
  }
  return { timeSensitive: true, deadline };
}
