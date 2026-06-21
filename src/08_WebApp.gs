// Web app endpoint — handles approve/deny links from the daily digest email.
// Deployed via: Deploy → New Deployment → Web App (Execute as Me, Anyone with link)

function doGet(e) {
  const p      = e.parameter || {};
  const action = p.action;
  const id     = p.id;
  const token  = p.token;

  if (!action || !id || !token) return htmlPage_('Invalid request', 'Missing required parameters.', '#888');

  const expected = generateToken_(id, getWebhookSecret_());
  if (token !== expected) return htmlPage_('Unauthorised', 'This link is invalid or has already been used.', '#dc3545');

  // ─── Pending email: approve (delete) / deny (keep) ──────────────────────────
  if (action === 'approve' || action === 'deny') {
    const item = resolvePending_(id, action === 'approve' ? 'approved' : 'denied');
    if (!item) return htmlPage_('Already resolved', 'This item has already been actioned.', '#888');

    if (action === 'approve') {
      const ok = trashThread_(item[PENDING_COL.THREAD_ID]);
      if (ok) {
        incrementSenderApprovals_(item[PENDING_COL.SENDER]);
        logAction_(item[PENDING_COL.THREAD_ID], item[PENDING_COL.SENDER], item[PENDING_COL.SUBJECT], 'delete', item[PENDING_COL.REASON], 'user-approved');
      }
      return htmlPage_('Deleted', `Email from <strong>${escapeHtml_(item[PENDING_COL.SENDER])}</strong> has been moved to Trash.`, '#dc3545');
    }

    logAction_(item[PENDING_COL.THREAD_ID], item[PENDING_COL.SENDER], item[PENDING_COL.SUBJECT], 'kept', 'User chose to keep', 'user-denied');
    return htmlPage_('Kept', `Email from <strong>${escapeHtml_(item[PENDING_COL.SENDER])}</strong> will stay in your inbox.`, '#28a745');
  }

  // ─── Unsubscribe: execute / skip ────────────────────────────────────────────
  if (action === 'unsubscribe') {
    const row = resolveUnsubRequest_(id, 'done');
    if (!row) return htmlPage_('Already resolved', 'This unsubscribe request has already been handled.', '#888');
    const result = executeUnsubscribe_(row[UNSUB_COL.LINK], id);
    const msg = result.success
      ? `Unsubscribe request sent to <strong>${escapeHtml_(id)}</strong> via ${result.method}.`
      : `Could not auto-unsubscribe from <strong>${escapeHtml_(id)}</strong>. You may need to unsubscribe manually.`;
    return htmlPage_(result.success ? 'Unsubscribed' : 'Could not unsubscribe', msg, result.success ? '#e67e22' : '#888');
  }

  if (action === 'skip-unsub') {
    resolveUnsubRequest_(id, 'skipped');
    return htmlPage_('Skipped', `You will not be unsubscribed from <strong>${escapeHtml_(id)}</strong>.`, '#aaa');
  }

  // ─── Reply-required: dismiss ─────────────────────────────────────────────────
  if (action === 'dismiss-reply') {
    const row = resolveReplyRequired_(id, 'dismissed');
    if (!row) return htmlPage_('Already dismissed', 'This reply reminder has already been cleared.', '#888');

    // Remove the inbox label so the visual flag clears immediately
    const thread = GmailApp.getThreadById(id);
    if (thread) {
      const label = GmailApp.getUserLabelByName('Needs Reply');
      if (label) thread.removeLabel(label);
    }

    return htmlPage_(
      'Dismissed',
      `Reply reminder for <strong>${escapeHtml_(row[REPLY_REQUIRED_COL.SUBJECT])}</strong> cleared from your digest. The email stays in your inbox.`,
      '#1a73e8'
    );
  }

  // ─── Batch block: trash all + permanent block ────────────────────────────────
  if (action === 'block-sender') {
    const name    = (p.name || '').trim();
    const display = escapeHtml_(name || id);
    let trashed;
    try {
      trashed = executeBatchSenderBlock_(id, name);
    } catch (e) {
      if (e.message && e.message.includes('Service invoked too many times')) {
        return htmlPage_(
          'Gmail Quota Reached',
          `Gmail's daily API limit has been hit — usually from blocking several senders at once or running a large scan today. <strong>${display}</strong> has <em>not</em> been blocked yet. Please try this link again tomorrow.`,
          '#e67e22'
        );
      }
      throw e;
    }

    // Clear any open unsubscribe request — redundant now that sender is blocked
    resolveUnsubRequest_(id, 'done');

    return htmlPage_(
      'Sender Blocked',
      `<strong>${display}</strong> is permanently blocked. ${trashed} email${trashed !== 1 ? 's' : ''} moved to Trash. Every future email from this sender will be auto-deleted immediately.`,
      '#e65100'
    );
  }

  return htmlPage_('Unknown action', 'Unrecognised action parameter.', '#888');
}

function htmlPage_(heading, body, color) {
  return HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html><body style="font-family:Arial,sans-serif;padding:40px;max-width:500px;margin:0 auto;text-align:center;">
      <h2 style="color:${color};">${heading}</h2>
      <p style="color:#555;font-size:15px;">${body}</p>
      <p style="color:#bbb;font-size:12px;margin-top:30px;">You can close this tab.</p>
    </body></html>`
  );
}
