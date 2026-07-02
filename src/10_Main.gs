// ─── Entry points ─────────────────────────────────────────────────────────────
// runHistoricalScan()      — run once manually from the editor
// runCategorizationScan()  — run once manually (Phase D.2) — label-only, no re-triage
// triageNewEmails()        — called by 15-min trigger automatically
// runDailyDigest()         — called by 8am daily trigger automatically
// buildWhitelist()         — run once manually, then weekly trigger handles it
// runAgeBasedCleanup()     — run once manually, then weekly trigger handles it

// ─── Historical scan (one-time) ───────────────────────────────────────────────
// Processes all existing emails in batches of 50.
// Apps Script has a 6-min execution limit, so it saves progress and
// auto-reschedules itself until the full inbox is scanned.

function runHistoricalScan() {
  const START_TIME   = Date.now();
  const MAX_RUNTIME  = 4 * 60 * 1000; // 4 min — leaves 2-min buffer before 6-min hard kill
  const BATCH_SIZE   = 50;
  const props        = PropertiesService.getScriptProperties();

  let offset         = parseInt(props.getProperty('HISTORICAL_SCAN_OFFSET') || '0');
  let totalProcessed = 0;
  let totalDeleted   = 0;
  let totalPending   = 0;

  Logger.log(`Historical scan starting at offset ${offset}`);

  while (Date.now() - START_TIME < MAX_RUNTIME) {
    const threads = fetchThreadsForScan_(offset, BATCH_SIZE);

    if (threads.length === 0) {
      props.deleteProperty('HISTORICAL_SCAN_OFFSET');
      Logger.log(`Scan complete — processed: ${totalProcessed}, deleted: ${totalDeleted}, pending: ${totalPending}`);
      sendScanCompleteEmail_(totalProcessed, totalDeleted, totalPending);
      return;
    }

    threads.forEach(thread => {
      const info     = extractThreadInfo_(thread);
      const decision = resolveDecision_(info);

      upsertSender_(info.sender, info.senderName, decision.action, decision.confidence, decision.reason, info.unsubscribeLink, decision.category);
      applyDecision_(info, decision);

      if (decision.action === 'delete' && decision.confidence >= AUTO_DELETE_THRESHOLD) totalDeleted++;
      else if (decision.action === 'delete' && decision.confidence >= BATCH_NOTIFY_THRESHOLD) totalPending++;
      totalProcessed++;
    });

    offset += threads.length;
    props.setProperty('HISTORICAL_SCAN_OFFSET', offset.toString());

    if (threads.length < BATCH_SIZE) {
      props.deleteProperty('HISTORICAL_SCAN_OFFSET');
      Logger.log(`Scan complete — processed: ${totalProcessed}, deleted: ${totalDeleted}, pending: ${totalPending}`);
      sendScanCompleteEmail_(totalProcessed, totalDeleted, totalPending);
      return;
    }
  }

  // 4-min self-limit hit — schedule continuation in 60 seconds
  Logger.log(`Time limit reached at offset ${offset}. ${totalProcessed} processed this run. Scheduling continuation…`);
  ScriptApp.newTrigger('runHistoricalScan').timeBased().after(60 * 1000).create();
}

// ─── Categorisation scan (Phase D.2 — run once manually) ─────────────────────
// Label-only pass over the current inbox. Detects category from subject/snippet
// using the same keyword rules as the rule engine — no re-triage, no deletes.
// Uses the same 5-min time-check + auto-reschedule pattern as runHistoricalScan.
function runCategorizationScan() {
  const START_TIME  = Date.now();
  const MAX_RUNTIME = 5 * 60 * 1000;
  const BATCH_SIZE  = 50;
  const props       = PropertiesService.getScriptProperties();

  let offset        = parseInt(props.getProperty('CAT_SCAN_OFFSET') || '0');
  let totalLabelled = 0;

  Logger.log(`Categorization scan starting at offset ${offset}`);

  while (Date.now() - START_TIME < MAX_RUNTIME) {
    const threads = GmailApp.search('in:inbox', offset, BATCH_SIZE);

    if (threads.length === 0) {
      props.deleteProperty('CAT_SCAN_OFFSET');
      Logger.log(`Categorization scan complete — ${totalLabelled} threads labelled this run.`);
      return;
    }

    threads.forEach(thread => {
      const messages   = thread.getMessages();
      const lastMsg    = messages[messages.length - 1];
      const subjectLow = (thread.getFirstMessageSubject() || '').toLowerCase();
      const snippetLow = lastMsg.getPlainBody().substring(0, 200).replace(/\s+/g, ' ').toLowerCase();
      const gmailCat   = getGmailCategory_(thread);
      const category   = detectCategory_(subjectLow, snippetLow, gmailCat);

      if (category) {
        applyLabel_(thread, category);
        totalLabelled++;
      }
    });

    offset += threads.length;
    props.setProperty('CAT_SCAN_OFFSET', offset.toString());

    if (threads.length < BATCH_SIZE) {
      props.deleteProperty('CAT_SCAN_OFFSET');
      Logger.log(`Categorization scan complete — ${totalLabelled} threads labelled this run.`);
      return;
    }
  }

  Logger.log(`Time limit reached at offset ${offset}. ${totalLabelled} labelled this run. Scheduling continuation…`);
  ScriptApp.newTrigger('runCategorizationScan').timeBased().after(60 * 1000).create();
}

// ─── New email triage (runs every 15 min via trigger) ─────────────────────────
function triageNewEmails() {
  const threads = fetchNewThreads_();
  if (threads.length === 0) return;

  Logger.log(`Triaging ${threads.length} new emails`);
  const infos   = threads.map(t => extractThreadInfo_(t));

  // Split: rule/cache decisions vs emails that need Claude
  const aiQueue = [];
  infos.forEach(info => {
    const decision = resolveDecision_(info, /* skipAi */ true);
    if (decision) {
      upsertSender_(info.sender, info.senderName, decision.action, decision.confidence, decision.reason, info.unsubscribeLink, decision.category);
      applyDecision_(info, decision);
    } else {
      aiQueue.push(info);
    }
  });

  // Batch the AI calls for cost efficiency
  if (aiQueue.length > 0) {
    const results = triageWithClaude_(aiQueue);
    results.forEach((result, i) => {
      const info = aiQueue[i];
      upsertSender_(info.sender, info.senderName, result.action, result.confidence, result.reason, info.unsubscribeLink, result.category);
      applyDecision_(info, result);
    });
  }
}

// ─── Daily digest (runs at 8am via trigger) ───────────────────────────────────
function runDailyDigest() {
  sendDailyDigest_();
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

// resolveDecision_ checks category → cache → rules → optionally Claude.
// Gmail category (Promotions/Social/Updates/Forums) always takes priority over cache.
// skipAi=true returns null when AI would be needed (used to batch AI calls).
function resolveDecision_(info, skipAi) {
  // 0. BlockList — permanently blocked senders skip all other logic
  if (isBlocked_(info.sender)) {
    return { action: 'delete', confidence: 1.0, reason: 'Sender is on your block list', source: 'rule' };
  }

  // 1. Gmail category check takes absolute priority — always auto-delete, no cache override
  if (AUTO_DELETE_CATEGORIES.includes(info.gmailCategory) && !isWhitelisted_(info.sender)) {
    return applyRules_(info.sender, info.senderName, info.subject, info.snippet, info.gmailCategory);
  }

  // 2. Check sender cache — avoids re-analysing known senders
  const cached = getSender_(info.sender);
  if (cached && cached.data[SENDER_COL.DECISION]) {
    return {
      action:     cached.data[SENDER_COL.DECISION],
      confidence: cached.data[SENDER_COL.CONFIDENCE],
      reason:     cached.data[SENDER_COL.REASON] + ' (cached)',
      source:     'cache',
    };
  }

  // 3. Emails with attachments are always kept (receipts, tickets, docs)
  if (info.hasAttachment) {
    return { action: 'keep', confidence: 0.95, reason: 'Email has an attachment — kept for safety', source: 'rule' };
  }

  // 4. Rule engine (newsletter detection, important domains, etc.)
  const ruleDecision = applyRules_(info.sender, info.senderName, info.subject, info.snippet, info.gmailCategory);
  if (ruleDecision) return ruleDecision;

  // 5. No rule matched — needs Claude
  if (skipAi) return null;
  const results = triageWithClaude_([info]);
  return { ...results[0], source: 'ai' };
}

function applyDecision_(info, decision) {
  if (!decision) return;

  // Time-Sensitive and Needs Reply labels only apply to emails less than 6 months old.
  // Older emails still get category labels but are excluded from these two labels and the digest sections.
  const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
  const isRecent      = !info.date || (Date.now() - new Date(info.date).getTime()) < SIX_MONTHS_MS;

  const applyInboxLabels_ = (thread) => {
    if (decision.category)                  applyLabel_(thread, decision.category);
    if (decision.timeSensitive && isRecent) applyLabel_(thread, 'Time-Sensitive');
  };

  if (decision.action === 'keep') {
    logAction_(info.threadId, info.sender, info.subject, 'keep', decision.reason, 'auto', decision.category);
    if (decision.category || (isRecent && (decision.replyRequired || decision.timeSensitive))) {
      const thread = GmailApp.getThreadById(info.threadId);
      if (thread) {
        applyInboxLabels_(thread);
        if (decision.replyRequired && isRecent) {
          applyLabel_(thread, 'Needs Reply');
          addReplyRequired_(info.threadId, info.sender, info.subject, info.snippet);
        }
      }
    }
    return;
  }

  if (decision.action === 'delete') {
    if (decision.confidence >= AUTO_DELETE_THRESHOLD) {
      trashThread_(info.threadId);
      logAction_(info.threadId, info.sender, info.subject, 'delete', decision.reason, 'auto', decision.category);
      if (decision.needsUnsubscribeCheck && info.unsubscribeLink) {
        addUnsubscribeRequest_(info.sender, info.senderName, info.unsubscribeLink, 1);
      }
    } else if (decision.confidence >= BATCH_NOTIFY_THRESHOLD) {
      // Strip time-sensitivity from old emails so they don't surface in the digest TS section
      addPending_(info.threadId, info.sender, info.subject, decision.reason, decision.confidence, isRecent && decision.timeSensitive, isRecent ? decision.deadline : null);
      if (decision.category || (decision.timeSensitive && isRecent)) {
        const thread = GmailApp.getThreadById(info.threadId);
        if (thread) applyInboxLabels_(thread);
      }
    } else {
      logAction_(info.threadId, info.sender, info.subject, 'review', decision.reason + ' (low confidence)', 'auto', decision.category);
      if (decision.category || (decision.timeSensitive && isRecent)) {
        const thread = GmailApp.getThreadById(info.threadId);
        if (thread) applyInboxLabels_(thread);
      }
    }
    return;
  }

  // 'review' — leave in inbox, log it
  logAction_(info.threadId, info.sender, info.subject, 'review', decision.reason, 'auto', decision.category);
  if (decision.category || (decision.timeSensitive && isRecent)) {
    const thread = GmailApp.getThreadById(info.threadId);
    if (thread) applyInboxLabels_(thread);
  }
}

// ─── Age-based auto-trash ─────────────────────────────────────────────────────
// Trashes emails older than 1 year that belong to low-value categories:
// social, promotions, updates, newsletters, alerts, OTP, orders, shipping,
// promos, HR, and purchase/receipts.
// Run once manually for the initial cleanup; weekly trigger handles ongoing cleanup.
function runAgeBasedCleanup() {
  const START_TIME  = Date.now();
  const MAX_RUNTIME = 4 * 60 * 1000;
  const BATCH_SIZE  = 100;
  const props       = PropertiesService.getScriptProperties();

  const cutoff     = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const beforeDate = `${cutoff.getFullYear()}/${String(cutoff.getMonth() + 1).padStart(2, '0')}/${String(cutoff.getDate()).padStart(2, '0')}`;

  // Gmail built-in categories catch unlabelled threads; taxonomy labels catch labelled ones.
  const PURGE_QUERIES = [
    'category:promotions',
    'category:social',
    'category:updates',
    'label:Shopping/Promos',
    'label:Shopping/Orders',
    'label:Shopping/Shipping',
    'label:Notifications/OTP',
    'label:Notifications/Alerts',
    'label:Notifications/Social',
    'label:Newsletters',
    'label:Work/HR',
    'label:Finance/Receipts',
  ];

  let queryIndex   = parseInt(props.getProperty('AGE_CLEANUP_QUERY_IDX') || '0');
  let offset       = parseInt(props.getProperty('AGE_CLEANUP_OFFSET')    || '0');
  let totalTrashed = 0;

  while (queryIndex < PURGE_QUERIES.length && Date.now() - START_TIME < MAX_RUNTIME) {
    const query   = `${PURGE_QUERIES[queryIndex]} before:${beforeDate} -in:trash -in:spam`;
    const threads = GmailApp.search(query, offset, BATCH_SIZE);

    if (threads.length === 0) {
      queryIndex++;
      offset = 0;
      props.setProperty('AGE_CLEANUP_QUERY_IDX', queryIndex.toString());
      props.setProperty('AGE_CLEANUP_OFFSET', '0');
      continue;
    }

    threads.forEach(thread => thread.moveToTrash());
    totalTrashed += threads.length;

    if (threads.length < BATCH_SIZE) {
      queryIndex++;
      offset = 0;
    } else {
      offset += threads.length;
    }

    props.setProperty('AGE_CLEANUP_QUERY_IDX', queryIndex.toString());
    props.setProperty('AGE_CLEANUP_OFFSET', offset.toString());
  }

  if (queryIndex >= PURGE_QUERIES.length) {
    props.deleteProperty('AGE_CLEANUP_QUERY_IDX');
    props.deleteProperty('AGE_CLEANUP_OFFSET');
    Logger.log(`Age-based cleanup complete — ${totalTrashed} threads trashed.`);
  } else {
    Logger.log(`Age-based cleanup paused at "${PURGE_QUERIES[queryIndex]}", offset ${offset}. ${totalTrashed} trashed this run. Rescheduling…`);
    // Delete any stale continuation triggers for this function before adding a new one
    // (Apps Script caps at 20 triggers per script — stale ones cause "too many triggers")
    ScriptApp.getProjectTriggers()
      .filter(t => t.getHandlerFunction() === 'runAgeBasedCleanup')
      .forEach(t => ScriptApp.deleteTrigger(t));
    ScriptApp.newTrigger('runAgeBasedCleanup').timeBased().after(60 * 1000).create();
  }
}

// Run once manually to immediately trash all 131 existing pending items.
// Safe to run — pending items were already flagged as delete candidates.
function bulkTrashAllPending() {
  const items   = getPendingItems_();
  let trashed   = 0;
  let skipped   = 0;

  items.forEach(item => {
    const ok = trashThread_(item.threadId);
    if (ok) {
      resolvePending_(item.id, 'bulk-approved');
      incrementSenderApprovals_(item.sender);
      logAction_(item.threadId, item.sender, item.subject, 'delete', item.reason, 'bulk-approved');
      trashed++;
    } else {
      skipped++;
    }
  });

  Logger.log(`Bulk trash complete — ${trashed} trashed, ${skipped} skipped (thread not found or already gone)`);
}

// ─── Batch sender block ───────────────────────────────────────────────────────
// Called from 08_WebApp.gs when the user clicks "Block All & Unsubscribe".
// Trashes every thread from the sender across all of Gmail (not just inbox),
// adds them to the BlockList, and queues an unsubscribe if a link is found.
function executeBatchSenderBlock_(senderEmail, senderName) {
  const query = `from:${senderEmail} -in:trash -in:spam`;
  let trashed   = 0;
  let unsubLink = null;
  let start     = 0;

  while (true) {
    const threads = GmailApp.search(query, start, 100);
    if (threads.length === 0) break;

    threads.forEach(thread => {
      if (!unsubLink) {
        try { unsubLink = getUnsubscribeLink_(thread.getMessages()[0]); } catch (_) {}
      }
      thread.moveToTrash();
      trashed++;
    });

    start += threads.length;
    if (threads.length < 100) break;
  }

  addToBlockList_(senderEmail, senderName || '', `Blocked via batch action — ${trashed} emails deleted`, trashed);

  if (unsubLink) {
    addUnsubscribeRequest_(senderEmail, senderName || '', unsubLink, trashed);
  }

  Logger.log(`executeBatchSenderBlock_: trashed ${trashed} threads from ${senderEmail}.`);
  return trashed;
}

function sendScanCompleteEmail_(processed, deleted, pending) {
  GmailApp.sendEmail(
    getUserEmail_(),
    'Gmail Triage — Historical Scan Complete',
    '',
    {
      htmlBody: `
        <h2 style="font-family:Arial;color:#333;">Historical Scan Complete</h2>
        <p style="font-family:Arial;">Here is what happened:</p>
        <ul style="font-family:Arial;line-height:1.8;">
          <li><strong>${processed}</strong> emails scanned</li>
          <li><strong>${deleted}</strong> emails auto-trashed (high confidence)</li>
          <li><strong>${pending}</strong> emails queued for your review (check your next daily digest)</li>
        </ul>
        <p style="font-family:Arial;">Your Gmail Triage Agent is now active and running every 15 minutes.</p>
        <p style="font-family:Arial;color:#aaa;font-size:12px;">Check your <em>Gmail Triage DB</em> spreadsheet in Google Drive for full details.</p>
      `,
      name: 'Gmail Triage Agent',
    }
  );
}
