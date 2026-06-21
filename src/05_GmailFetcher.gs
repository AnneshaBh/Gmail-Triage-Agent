// All Gmail read/write operations live here.

function fetchThreadsForScan_(offset, limit) {
  return GmailApp.search('in:all -in:sent -in:drafts -in:trash -in:spam', offset, limit);
}

function fetchNewThreads_() {
  const props     = PropertiesService.getScriptProperties();
  const lastCheck = props.getProperty('LAST_NEW_EMAIL_CHECK');

  let query = 'in:inbox is:unread';
  if (lastCheck) {
    const d       = new Date(parseInt(lastCheck));
    const dateStr = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
    query        += ` after:${dateStr}`;
  }

  props.setProperty('LAST_NEW_EMAIL_CHECK', Date.now().toString());
  return GmailApp.search(query, 0, MAX_THREADS_PER_RUN);
}

function extractThreadInfo_(thread) {
  const messages = thread.getMessages();
  const lastMsg  = messages[messages.length - 1];
  const fromHdr  = lastMsg.getFrom();

  return {
    threadId:       thread.getId(),
    sender:         extractSenderEmail_(fromHdr),
    senderName:     extractSenderName_(fromHdr),
    subject:        thread.getFirstMessageSubject() || '(no subject)',
    snippet:        lastMsg.getPlainBody().substring(0, 200).replace(/\s+/g, ' '),
    gmailCategory:  getGmailCategory_(thread),
    messageCount:   messages.length,
    hasAttachment:  lastMsg.getAttachments().length > 0,
    unsubscribeLink: getUnsubscribeLink_(lastMsg),
  };
}

function trashThread_(threadId) {
  try {
    const thread = GmailApp.getThreadById(threadId);
    if (thread) thread.moveToTrash();
    return true;
  } catch (e) {
    Logger.log(`Failed to trash thread ${threadId}: ${e.message}`);
    return false;
  }
}

function getUnsubscribeLink_(message) {
  try {
    const header = message.getHeader('List-Unsubscribe');
    if (header) {
      const httpsMatch  = header.match(/<(https?:\/\/[^>]+)>/);
      if (httpsMatch) return httpsMatch[1];
      const mailtoMatch = header.match(/<(mailto:[^>]+)>/);
      if (mailtoMatch) return mailtoMatch[1];
    }
    // Fallback: scan HTML body for an unsubscribe href
    const body  = message.getBody();
    const match = body.match(/href="([^"]*unsubscribe[^"]*)"[^>]*>/i);
    if (match) return match[1];
  } catch (_) {}
  return null;
}
