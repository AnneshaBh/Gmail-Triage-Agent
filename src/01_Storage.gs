// Google Sheets is the persistent database — no external DB needed.
// Sheets: Senders | Actions | Pending | Whitelist

// ─── Column indices (0-based) ─────────────────────────────────────────────────
const SENDER_COL        = { EMAIL: 0, NAME: 1, COUNT: 2, DECISION: 3, CONFIDENCE: 4, APPROVALS: 5, REASON: 6, UNSUB_LINK: 7, LAST_SEEN: 8, CATEGORY: 9 };
const ACTION_COL        = { TIMESTAMP: 0, THREAD_ID: 1, SENDER: 2, SUBJECT: 3, ACTION: 4, REASON: 5, APPROVED_BY: 6, CATEGORY: 7 };
const PENDING_COL       = { ID: 0, THREAD_ID: 1, SENDER: 2, SUBJECT: 3, REASON: 4, CONFIDENCE: 5, EXPIRES_AT: 6, STATUS: 7, TIME_SENSITIVE: 8, DEADLINE: 9 };
const WHITELIST_COL     = { EMAIL: 0, SOURCE: 1, ADDED_AT: 2 };
const REPLY_REQUIRED_COL = { THREAD_ID: 0, SENDER: 1, SUBJECT: 2, SNIPPET: 3, DETECTED_AT: 4, STATUS: 5 };
const BLOCKLIST_COL     = { EMAIL: 0, NAME: 1, BLOCKED_AT: 2, REASON: 3, EMAILS_DELETED: 4 };

const REPLY_REQUIRED_HEADERS_ = ['ThreadId', 'Sender', 'Subject', 'Snippet', 'DetectedAt', 'Status'];
const BLOCKLIST_HEADERS_       = ['Email', 'Name', 'BlockedAt', 'Reason', 'EmailsDeleted'];

// ─── Spreadsheet bootstrap ────────────────────────────────────────────────────
function getOrCreateSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const ssId  = props.getProperty('SPREADSHEET_ID');

  if (ssId) {
    try { return SpreadsheetApp.openById(ssId); } catch (_) {}
  }

  const ss = SpreadsheetApp.create(SPREADSHEET_NAME);
  props.setProperty('SPREADSHEET_ID', ss.getId());
  initSheets_(ss);
  return ss;
}

function initSheets_(ss) {
  const defs = {
    Senders:       ['Email', 'Name', 'EmailCount', 'Decision', 'Confidence', 'Approvals', 'Reason', 'UnsubscribeLink', 'LastSeen', 'Category'],
    Actions:       ['Timestamp', 'ThreadId', 'Sender', 'Subject', 'Action', 'Reason', 'ApprovedBy', 'Category'],
    Pending:       ['Id', 'ThreadId', 'Sender', 'Subject', 'Reason', 'Confidence', 'ExpiresAt', 'Status', 'TimeSensitive', 'Deadline'],
    Whitelist:     ['Email', 'Source', 'AddedAt'],
    ReplyRequired: REPLY_REQUIRED_HEADERS_,
    BlockList:     BLOCKLIST_HEADERS_,
  };

  const defaultSheet = ss.getSheets()[0];
  Object.entries(defs).forEach(([name, headers], i) => {
    const sheet = i === 0 ? defaultSheet : ss.insertSheet(name);
    if (i === 0) sheet.setName(name);
    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  });
}

function getSheet_(name) {
  const ss = getOrCreateSpreadsheet_();
  return ss.getSheetByName(name) || (() => { initSheets_(ss); return ss.getSheetByName(name); })();
}

// ─── Senders ──────────────────────────────────────────────────────────────────
function getSender_(email) {
  const data = getSheet_('Senders').getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][SENDER_COL.EMAIL] === email) return { row: i + 1, data: data[i] };
  }
  return null;
}

function upsertSender_(email, name, decision, confidence, reason, unsubLink, category) {
  const sheet    = getSheet_('Senders');
  const existing = getSender_(email);
  const now      = new Date().toISOString();

  if (existing) {
    const r = existing.row;
    sheet.getRange(r, SENDER_COL.COUNT + 1).setValue((existing.data[SENDER_COL.COUNT] || 0) + 1);
    if (decision)   sheet.getRange(r, SENDER_COL.DECISION    + 1).setValue(decision);
    if (confidence) sheet.getRange(r, SENDER_COL.CONFIDENCE  + 1).setValue(confidence);
    if (reason)     sheet.getRange(r, SENDER_COL.REASON      + 1).setValue(reason);
    if (unsubLink)  sheet.getRange(r, SENDER_COL.UNSUB_LINK  + 1).setValue(unsubLink);
    if (category)   sheet.getRange(r, SENDER_COL.CATEGORY    + 1).setValue(category);
    sheet.getRange(r, SENDER_COL.LAST_SEEN + 1).setValue(now);
  } else {
    sheet.appendRow([email, name || '', 1, decision || '', confidence || '', 0, reason || '', unsubLink || '', now, category || '']);
  }
}

function incrementSenderApprovals_(email) {
  const existing = getSender_(email);
  if (existing) {
    const current = existing.data[SENDER_COL.APPROVALS] || 0;
    getSheet_('Senders').getRange(existing.row, SENDER_COL.APPROVALS + 1).setValue(current + 1);
  }
}

function isAutoApproved_(email) {
  const existing = getSender_(email);
  return existing &&
    existing.data[SENDER_COL.APPROVALS] >= 3 &&
    existing.data[SENDER_COL.DECISION]  === 'delete';
}

// ─── Actions log ──────────────────────────────────────────────────────────────
function logAction_(threadId, sender, subject, action, reason, approvedBy, category) {
  getSheet_('Actions').appendRow([
    new Date().toISOString(), threadId, sender, subject, action, reason, approvedBy || 'auto', category || '',
  ]);
}

function getRecentAutoDeletes_() {
  const data      = getSheet_('Actions').getDataRange().getValues();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  return data.slice(1).filter(r =>
    r[ACTION_COL.TIMESTAMP]   > yesterday &&
    r[ACTION_COL.ACTION]      === 'delete' &&
    r[ACTION_COL.APPROVED_BY] === 'auto'
  );
}

// ─── Pending queue ────────────────────────────────────────────────────────────
function addPending_(threadId, sender, subject, reason, confidence, timeSensitive, deadline) {
  const id        = Utilities.getUuid();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  getSheet_('Pending').appendRow([id, threadId, sender, subject, reason, confidence, expiresAt, 'pending', timeSensitive || false, deadline || '']);
  return id;
}

function resolvePending_(id, status) {
  const sheet = getSheet_('Pending');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][PENDING_COL.ID] === id) {
      sheet.getRange(i + 1, PENDING_COL.STATUS + 1).setValue(status);
      return data[i];
    }
  }
  return null;
}

function getPendingItems_() {
  const data = getSheet_('Pending').getDataRange().getValues();
  const now  = new Date();
  return data.slice(1)
    .filter(r => r[PENDING_COL.STATUS] === 'pending')
    .map(r => ({
      id:            r[PENDING_COL.ID],
      threadId:      r[PENDING_COL.THREAD_ID],
      sender:        r[PENDING_COL.SENDER],
      subject:       r[PENDING_COL.SUBJECT],
      reason:        r[PENDING_COL.REASON],
      confidence:    r[PENDING_COL.CONFIDENCE],
      expiresAt:     r[PENDING_COL.EXPIRES_AT],
      expired:       new Date(r[PENDING_COL.EXPIRES_AT]) < now,
      timeSensitive: !!r[PENDING_COL.TIME_SENSITIVE],
      deadline:      r[PENDING_COL.DEADLINE] || null,
    }));
}

// ─── Whitelist ────────────────────────────────────────────────────────────────
function isWhitelisted_(email) {
  const data = getSheet_('Whitelist').getDataRange().getValues();
  return data.slice(1).some(r => r[WHITELIST_COL.EMAIL] === email.toLowerCase());
}

function addToWhitelist_(email, source) {
  if (isWhitelisted_(email)) return;
  getSheet_('Whitelist').appendRow([email.toLowerCase(), source, new Date().toISOString()]);
}

// ─── UnsubscribeQueue ─────────────────────────────────────────────────────────
const UNSUB_COL = { SENDER: 0, NAME: 1, LINK: 2, EMAIL_COUNT: 3, REQUESTED_AT: 4, STATUS: 5 };
const UNSUB_HEADERS = ['Sender', 'Name', 'UnsubscribeLink', 'EmailCount', 'RequestedAt', 'Status'];

function getUnsubSheet_() {
  return getOrCreateSheet_('UnsubscribeQueue', UNSUB_HEADERS);
}

function addUnsubscribeRequest_(sender, senderName, unsubLink, emailCount) {
  if (!unsubLink) return;
  const sheet = getUnsubSheet_();
  const data  = sheet.getDataRange().getValues();
  const alreadyQueued = data.slice(1).some(r =>
    r[UNSUB_COL.SENDER] === sender && ['pending', 'done'].includes(r[UNSUB_COL.STATUS])
  );
  if (alreadyQueued) return;
  sheet.appendRow([sender, senderName || '', unsubLink, emailCount || 1, new Date().toISOString(), 'pending']);
}

function getPendingUnsubRequests_() {
  const data = getUnsubSheet_().getDataRange().getValues();
  return data.slice(1)
    .filter(r => r[UNSUB_COL.STATUS] === 'pending')
    .map(r => ({
      sender:     r[UNSUB_COL.SENDER],
      name:       r[UNSUB_COL.NAME],
      link:       r[UNSUB_COL.LINK],
      emailCount: r[UNSUB_COL.EMAIL_COUNT],
    }));
}

function resolveUnsubRequest_(sender, status) {
  const sheet = getUnsubSheet_();
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][UNSUB_COL.SENDER] === sender && data[i][UNSUB_COL.STATUS] === 'pending') {
      sheet.getRange(i + 1, UNSUB_COL.STATUS + 1).setValue(status);
      return data[i];
    }
  }
  return null;
}

// ─── Generic sheet creator (for sheets added after initial setup) ─────────────
function getOrCreateSheet_(name, headers) {
  const ss    = getOrCreateSpreadsheet_();
  let sheet   = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ─── ReplyRequired ────────────────────────────────────────────────────────────
function addReplyRequired_(threadId, sender, subject, snippet) {
  const sheet = getOrCreateSheet_('ReplyRequired', REPLY_REQUIRED_HEADERS_);
  const data  = sheet.getDataRange().getValues();
  const alreadyTracked = data.slice(1).some(
    r => r[REPLY_REQUIRED_COL.THREAD_ID] === threadId && r[REPLY_REQUIRED_COL.STATUS] === 'pending'
  );
  if (alreadyTracked) return;
  sheet.appendRow([threadId, sender, subject, snippet || '', new Date().toISOString(), 'pending']);
}

function getReplyRequiredItems_() {
  const data = getOrCreateSheet_('ReplyRequired', REPLY_REQUIRED_HEADERS_).getDataRange().getValues();
  return data.slice(1)
    .filter(r => r[REPLY_REQUIRED_COL.STATUS] === 'pending')
    .map(r => ({
      threadId:   r[REPLY_REQUIRED_COL.THREAD_ID],
      sender:     r[REPLY_REQUIRED_COL.SENDER],
      subject:    r[REPLY_REQUIRED_COL.SUBJECT],
      snippet:    r[REPLY_REQUIRED_COL.SNIPPET],
      detectedAt: r[REPLY_REQUIRED_COL.DETECTED_AT],
    }));
}

function resolveReplyRequired_(threadId, status) {
  const sheet = getOrCreateSheet_('ReplyRequired', REPLY_REQUIRED_HEADERS_);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][REPLY_REQUIRED_COL.THREAD_ID] === threadId && data[i][REPLY_REQUIRED_COL.STATUS] === 'pending') {
      sheet.getRange(i + 1, REPLY_REQUIRED_COL.STATUS + 1).setValue(status || 'dismissed');
      return data[i];
    }
  }
  return null;
}

// ─── BlockList ────────────────────────────────────────────────────────────────
function addToBlockList_(email, name, reason, emailsDeleted) {
  if (isBlocked_(email)) return;
  getOrCreateSheet_('BlockList', BLOCKLIST_HEADERS_).appendRow(
    [email.toLowerCase(), name || '', new Date().toISOString(), reason || '', emailsDeleted || 0]
  );
}

function isBlocked_(email) {
  const data = getOrCreateSheet_('BlockList', BLOCKLIST_HEADERS_).getDataRange().getValues();
  return data.slice(1).some(r => r[BLOCKLIST_COL.EMAIL] === email.toLowerCase());
}

function getFrequentDeletionSenders_() {
  const actions   = getSheet_('Actions').getDataRange().getValues().slice(1);
  const blockData = getOrCreateSheet_('BlockList', BLOCKLIST_HEADERS_).getDataRange().getValues();
  const blocked   = new Set(blockData.slice(1).map(r => r[BLOCKLIST_COL.EMAIL]));

  const counts = {};
  actions.forEach(r => {
    if (r[ACTION_COL.ACTION] === 'delete') {
      const sender = (r[ACTION_COL.SENDER] || '').toLowerCase();
      if (sender) counts[sender] = (counts[sender] || 0) + 1;
    }
  });

  return Object.entries(counts)
    .filter(([email, count]) => count >= BATCH_BLOCK_THRESHOLD && !blocked.has(email))
    .map(([email, count]) => {
      const senderData = getSender_(email);
      return {
        email,
        name:        senderData ? senderData.data[SENDER_COL.NAME] : '',
        deleteCount: count,
      };
    });
}
