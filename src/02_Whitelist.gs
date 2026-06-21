// Builds a whitelist of email addresses you have ever sent mail to.
// Anyone you've replied to is treated as a trusted contact — never auto-deleted.

function buildWhitelist() {
  const START_TIME  = Date.now();
  const MAX_RUNTIME = 5 * 60 * 1000; // 5 min — stay under Apps Script 6-min limit
  const props       = PropertiesService.getScriptProperties();

  let offset = parseInt(props.getProperty('WHITELIST_BUILD_OFFSET') || '0');
  let total  = 0;

  Logger.log(`Building whitelist from Sent Mail (offset ${offset})…`);

  while (Date.now() - START_TIME < MAX_RUNTIME) {
    const threads = GmailApp.search('in:sent', offset, 100);

    if (threads.length === 0) {
      props.deleteProperty('WHITELIST_BUILD_OFFSET');
      Logger.log(`Whitelist build complete — ${total} addresses added this run.`);
      return;
    }

    threads.forEach(thread => {
      thread.getMessages().forEach(msg => {
        const recipients = [msg.getTo(), msg.getCc()].join(',');
        extractEmails_(recipients).forEach(email => {
          addToWhitelist_(email, 'sent-mail');
          total++;
        });
      });
    });

    offset += threads.length;
    props.setProperty('WHITELIST_BUILD_OFFSET', offset.toString());

    if (threads.length < 100) {
      props.deleteProperty('WHITELIST_BUILD_OFFSET');
      Logger.log(`Whitelist build complete — ${total} addresses added this run.`);
      return;
    }
  }

  // Time limit hit — auto-schedule continuation in 60 seconds
  Logger.log(`Time limit reached at offset ${offset}. Scheduling continuation…`);
  ScriptApp.newTrigger('buildWhitelist').timeBased().after(60 * 1000).create();
}

// ─── Email string helpers (used across files) ─────────────────────────────────
function extractEmails_(str) {
  if (!str) return [];
  const matches = str.match(/[\w.+\-]+@[\w\-]+\.[\w.]+/g);
  return matches ? [...new Set(matches.map(e => e.toLowerCase()))] : [];
}

function extractSenderEmail_(fromHeader) {
  const match = fromHeader.match(/<?([\w.+\-]+@[\w\-]+\.[\w.]+)>?/);
  return match ? match[1].toLowerCase() : fromHeader.toLowerCase().trim();
}

function extractSenderName_(fromHeader) {
  const match = fromHeader.match(/^([^<]+)</);
  return match ? match[1].trim().replace(/"/g, '') : '';
}
