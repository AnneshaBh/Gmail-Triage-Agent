// Executes unsubscribe via List-Unsubscribe header.
// Prefers mailto (silent, no browser needed). Falls back to HTTPS GET.

function executeUnsubscribe_(unsubLink, sender) {
  if (!unsubLink) return { success: false, method: 'none' };

  try {
    if (unsubLink.startsWith('mailto:')) return executeMailtoUnsub_(unsubLink, sender);
    if (unsubLink.startsWith('http'))    return executeHttpUnsub_(unsubLink);
  } catch (e) {
    Logger.log(`Unsubscribe failed for ${sender}: ${e.message}`);
    return { success: false, method: 'error', error: e.message };
  }

  return { success: false, method: 'unknown' };
}

function executeMailtoUnsub_(mailtoUrl, sender) {
  const url    = mailtoUrl.replace('mailto:', '');
  const parts  = url.split('?');
  const to     = parts[0];
  let subject  = 'Unsubscribe';
  let body     = '';

  if (parts[1]) {
    parts[1].split('&').forEach(param => {
      const [k, v] = param.split('=');
      if (k === 'subject') subject = decodeURIComponent(v || '');
      if (k === 'body')    body    = decodeURIComponent(v || '');
    });
  }

  GmailApp.sendEmail(to, subject, body);
  Logger.log(`Sent unsubscribe email to ${to} on behalf of ${sender}`);
  return { success: true, method: 'mailto', to };
}

function executeHttpUnsub_(url) {
  const resp    = UrlFetchApp.fetch(url, { method: 'GET', followRedirects: true, muteHttpExceptions: true });
  const success = resp.getResponseCode() < 400;
  Logger.log(`HTTP unsubscribe ${url} → ${resp.getResponseCode()}`);
  return { success, method: 'https', statusCode: resp.getResponseCode() };
}
