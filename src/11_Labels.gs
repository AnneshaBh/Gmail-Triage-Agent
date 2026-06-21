// Source of truth for every label this script creates and manages in Gmail.
// Both setupLabels() and clearHistoricalLabels() reference this list.
// Keep children in sync with LABEL_TAXONOMY in 00_Config.gs (added in B.2).
const ALL_LABELS_ = [
  // Parent folders (explicit so they appear cleanly in Gmail sidebar)
  'Finance', 'Travel', 'Work', 'Shopping', 'Notifications',
  // Finance
  'Finance/Invoices', 'Finance/Receipts', 'Finance/Statements', 'Finance/Tax',
  // Travel
  'Travel/Bookings', 'Travel/Itinerary',
  // Work
  'Work/Projects', 'Work/HR', 'Work/Learning',
  // Shopping
  'Shopping/Orders', 'Shopping/Shipping', 'Shopping/Promos',
  // Notifications
  'Notifications/OTP', 'Notifications/Alerts', 'Notifications/Social',
  // Flat special labels
  'Newsletters', 'Needs Reply', 'Time-Sensitive',
];

// ─── One-time setup ───────────────────────────────────────────────────────────
// Run once from the editor after clasp push (Phase C.3).
// Creates the full label tree; skips any label that already exists.
function setupLabels() {
  const existing = new Set(GmailApp.getUserLabels().map(l => l.getName()));
  let created = 0;

  ALL_LABELS_.forEach(name => {
    if (!existing.has(name)) {
      GmailApp.createLabel(name);
      created++;
    }
  });

  Logger.log(`setupLabels complete — ${created} created, ${ALL_LABELS_.length - created} already existed.`);
}

// ─── Historical label clear ───────────────────────────────────────────────────
// Run once from the editor (Phase D.1) before the categorisation scan.
// Discovers all user-created labels at runtime, strips them from every thread,
// then deletes each label — except taxonomy labels created by setupLabels().
// Uses the 5-min time-check + auto-reschedule pattern for large inboxes.
function clearHistoricalLabels() {
  const START_TIME  = Date.now();
  const MAX_RUNTIME = 5 * 60 * 1000;
  const props       = PropertiesService.getScriptProperties();

  // First call: snapshot the labels to clear. Continuation calls: resume from saved list.
  let pending = JSON.parse(props.getProperty('CLEAR_LABELS_PENDING') || 'null');
  if (!pending) {
    const taxonomySet = new Set(ALL_LABELS_);
    pending = GmailApp.getUserLabels()
      .map(l => l.getName())
      .filter(name => !taxonomySet.has(name));
    props.setProperty('CLEAR_LABELS_PENDING', JSON.stringify(pending));
    Logger.log(`clearHistoricalLabels starting — ${pending.length} labels to clear.`);
  }

  let clearedCount = 0;

  while (pending.length > 0 && Date.now() - START_TIME < MAX_RUNTIME) {
    const labelName = pending[0];
    const label     = GmailApp.getUserLabelByName(labelName);

    // Label was already deleted externally — skip it
    if (!label) {
      pending.shift();
      props.setProperty('CLEAR_LABELS_PENDING', JSON.stringify(pending));
      continue;
    }

    // Remove all threads from the label in batches of 100
    let threads;
    do {
      threads = label.getThreads(0, 100);
      if (threads.length > 0) label.removeFromThreads(threads);
    } while (threads.length === 100 && Date.now() - START_TIME < MAX_RUNTIME);

    // Only delete the label once all threads have been removed
    if (label.getThreads(0, 1).length === 0) {
      label.deleteLabel();
      clearedCount++;
      pending.shift();
      props.setProperty('CLEAR_LABELS_PENDING', JSON.stringify(pending));
    } else {
      // Time ran out mid-label — save state and break to reschedule
      props.setProperty('CLEAR_LABELS_PENDING', JSON.stringify(pending));
      break;
    }
  }

  if (pending.length > 0) {
    Logger.log(`Time limit hit — ${clearedCount} labels cleared this run, ${pending.length} remaining. Rescheduling…`);
    ScriptApp.newTrigger('clearHistoricalLabels').timeBased().after(60 * 1000).create();
  } else {
    props.deleteProperty('CLEAR_LABELS_PENDING');
    Logger.log(`clearHistoricalLabels complete — all historical labels removed.`);
  }
}

// ─── Label helper ─────────────────────────────────────────────────────────────
// Internal. Called from applyDecision_() in 10_Main.gs after every triage decision.
function applyLabel_(thread, labelName) {
  if (!labelName) return;
  const label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    Logger.log(`applyLabel_: "${labelName}" not found — run setupLabels() first.`);
    return;
  }
  thread.addLabel(label);
}
