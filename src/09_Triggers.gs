// Run setupTriggers() once from the Apps Script editor after deployment.
// Deletes all existing triggers first to prevent duplicates on re-runs.

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));

  // New email triage — every 15 minutes
  ScriptApp.newTrigger('triageNewEmails')
    .timeBased().everyMinutes(15).create();

  // Daily digest — 8am in the script timezone (set "timeZone" in appsscript.json)
  ScriptApp.newTrigger('runDailyDigest')
    .timeBased().atHour(8).everyDays(1).create();

  // Rebuild whitelist — every Sunday at 2am
  ScriptApp.newTrigger('buildWhitelist')
    .timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).create();

  // Process expired pending items — hourly (24h silence = auto-trash)
  ScriptApp.newTrigger('processExpiredPending_')
    .timeBased().everyHours(1).create();

  Logger.log('All 4 triggers set up successfully.');
}

// Called by hourly trigger — auto-trashes any pending items older than 24h.
function processExpiredPending_() {
  getPendingItems_()
    .filter(item => item.expired)
    .forEach(item => {
      trashThread_(item.threadId);
      resolvePending_(item.id, 'auto-expired');
      incrementSenderApprovals_(item.sender);
      logAction_(item.threadId, item.sender, item.subject, 'delete', 'Auto-trashed after 24h — no user response', 'auto-expired');
      Logger.log(`Auto-trashed expired pending: ${item.sender} — ${item.subject}`);
    });
}
