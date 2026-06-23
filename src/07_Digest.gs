// Sends a daily HTML digest email to you with:
//  - What was auto-trashed in the last 24 hours
//  - Items pending your approval (delete / keep buttons)

function sendDailyDigest_() {
  const userEmail        = getUserEmail_();
  const allPending       = getPendingItems_();
  const timeSensitive    = allPending.filter(item => item.timeSensitive);
  const regularPending   = allPending.filter(item => !item.timeSensitive);
  const autoDeleted      = getRecentAutoDeletes_();
  const unsubReqs        = getPendingUnsubRequests_();
  const replyRequired    = getReplyRequiredItems_();
  const frequentDeletors = getFrequentDeletionSenders_();
  const webAppUrl        = getWebAppUrl_();
  const secret           = getWebhookSecret_();

  const html = buildDigestHtml_(regularPending, timeSensitive, autoDeleted, unsubReqs, replyRequired, frequentDeletors, webAppUrl, secret);

  GmailApp.sendEmail(
    userEmail,
    `Gmail Triage Digest — ${formatDate_(new Date())}`,
    'Please view this email in an HTML-capable client.',
    { htmlBody: html, name: 'Gmail Triage Agent' }
  );

  Logger.log(`Daily digest sent to ${userEmail} — ${replyRequired.length} reply-required, ${timeSensitive.length} time-sensitive, ${regularPending.length} pending, ${autoDeleted.length} auto-deleted, ${unsubReqs.length} unsubscribe suggestions, ${frequentDeletors.length} senders to block`);
}

function buildDigestHtml_(regularPending, timeSensitive, autoDeleted, unsubReqs, replyRequired, frequentDeletors, webAppUrl, secret) {
  const MAX_PENDING = 10;
  const MAX_UNSUB   = 8;
  const MAX_DELETED = 5;

  const pendingToShow = regularPending.slice(0, MAX_PENDING);
  const pendingMore   = Math.max(0, regularPending.length - MAX_PENDING);
  const unsubToShow   = unsubReqs.slice(0, MAX_UNSUB);
  const unsubMore     = Math.max(0, unsubReqs.length - MAX_UNSUB);

  // ─── Regular pending rows ─────────────────────────────────────────────────
  const pendingRows = pendingToShow.map(item => {
    const approveUrl = `${webAppUrl}?action=approve&id=${encodeURIComponent(item.id)}&token=${generateToken_(item.id, secret)}`;
    const denyUrl    = `${webAppUrl}?action=deny&id=${encodeURIComponent(item.id)}&token=${generateToken_(item.id, secret)}`;
    const pct        = Math.round(item.confidence * 100);
    return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:13px;">${escapeHtml_(truncate_(item.sender, 40))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:13px;">${escapeHtml_(truncate_(item.subject, 55))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:13px;color:#888;">${pct}%</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:13px;color:#555;">${escapeHtml_(truncate_(item.reason, 70))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;white-space:nowrap;">
          <a href="${approveUrl}" style="background:#dc3545;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;margin-right:4px;">Delete</a>
          <a href="${denyUrl}"    style="background:#28a745;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;">Keep</a>
        </td>
      </tr>`;
  }).join('');

  // ─── Auto-deleted rows ────────────────────────────────────────────────────
  const deletedRows = autoDeleted.slice(0, MAX_DELETED).map(r => `
    <tr>
      <td style="padding:6px;border-bottom:1px solid #eee;font-size:12px;color:#666;">${escapeHtml_(r[ACTION_COL.SENDER])}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;font-size:12px;color:#666;">${escapeHtml_(r[ACTION_COL.SUBJECT])}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;font-size:12px;color:#999;">${escapeHtml_(r[ACTION_COL.REASON])}</td>
    </tr>`
  ).join('');

  // ─── Unsubscribe suggestions ──────────────────────────────────────────────
  const unsubRows = unsubToShow.map(req => {
    const unsubUrl = `${webAppUrl}?action=unsubscribe&id=${encodeURIComponent(req.sender)}&token=${generateToken_(req.sender, secret)}`;
    const skipUrl  = `${webAppUrl}?action=skip-unsub&id=${encodeURIComponent(req.sender)}&token=${generateToken_(req.sender, secret)}`;
    return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:13px;">${escapeHtml_(req.name || req.sender)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;font-size:13px;color:#888;">${escapeHtml_(req.sender)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #eee;white-space:nowrap;">
          <a href="${unsubUrl}" style="background:#e67e22;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;margin-right:4px;">Unsubscribe</a>
          <a href="${skipUrl}"  style="background:#aaa;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;">Skip</a>
        </td>
      </tr>`;
  }).join('');

  // ─── Section blocks ───────────────────────────────────────────────────────
  const totalPending  = regularPending.length + timeSensitive.length;

  const pendingSection = regularPending.length > 0 ? `
    <h3 style="color:#444;margin-top:28px;">Pending Your Approval</h3>
    <p style="color:#888;font-size:12px;margin-top:-8px;">These will be auto-trashed in 24 hours if you take no action.</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f5f5f5;">
        <th style="padding:8px 6px;text-align:left;font-size:12px;">Sender</th>
        <th style="padding:8px 6px;text-align:left;font-size:12px;">Subject</th>
        <th style="padding:8px 6px;text-align:left;font-size:12px;">Confidence</th>
        <th style="padding:8px 6px;text-align:left;font-size:12px;">Reason</th>
        <th style="padding:8px 6px;text-align:left;font-size:12px;">Action</th>
      </tr></thead>
      <tbody>${pendingRows}</tbody>
    </table>
    ${pendingMore > 0 ? `<p style="color:#888;font-size:12px;margin-top:8px;">...and <strong>${pendingMore}</strong> more. They will be auto-trashed within 24 hours.</p>` : ''}` :
    (totalPending === 0 ? '<p style="color:#28a745;font-size:14px;">No pending items — inbox is clean!</p>' : '');

  const deletedSection = autoDeleted.length > 0 ? `
    <h3 style="color:#444;margin-top:28px;">Auto-Trashed in Last 24 Hours</h3>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#f5f5f5;">
        <th style="padding:6px;text-align:left;font-size:12px;">Sender</th>
        <th style="padding:6px;text-align:left;font-size:12px;">Subject</th>
        <th style="padding:6px;text-align:left;font-size:12px;">Reason</th>
      </tr></thead>
      <tbody>${deletedRows}</tbody>
    </table>` : '';

  const unsubSection = unsubReqs.length > 0 ? `
    <h3 style="color:#444;margin-top:28px;">Unsubscribe Suggestions</h3>
    <p style="color:#888;font-size:12px;margin-top:-8px;">These senders were auto-trashed. Click Unsubscribe to stop future emails, or Skip to leave as-is.</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="background:#fff3e0;">
        <th style="padding:8px 6px;text-align:left;font-size:12px;">Sender Name</th>
        <th style="padding:8px 6px;text-align:left;font-size:12px;">Email</th>
        <th style="padding:8px 6px;text-align:left;font-size:12px;">Action</th>
      </tr></thead>
      <tbody>${unsubRows}</tbody>
    </table>
    ${unsubMore > 0 ? `<p style="color:#888;font-size:12px;margin-top:8px;">...and <strong>${unsubMore}</strong> more unsubscribe suggestions. They will appear in tomorrow's digest.</p>` : ''}` : '';

  const replySection = buildReplyRequiredSection_(replyRequired, webAppUrl, secret);
  const tsSection    = buildTimeSensitiveSection_(timeSensitive, webAppUrl, secret);
  const blockSection = buildBatchBlockSection_(frequentDeletors, webAppUrl, secret);

  return `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;max-width:820px;margin:0 auto;padding:20px;color:#333;">
  <h2 style="border-bottom:2px solid #eee;padding-bottom:10px;">Gmail Triage Digest — ${formatDate_(new Date())}</h2>
  <div style="background:#f8f9fa;padding:14px 18px;border-radius:8px;margin-bottom:20px;line-height:2;">
    <span style="margin-right:20px;">🗑 <strong>${autoDeleted.length}</strong> auto-trashed</span>
    ${frequentDeletors.length > 0 ? `<span style="margin-right:20px;color:#e65100;font-weight:bold;">${frequentDeletors.length} senders to block</span>`                : ''}
    <span style="margin-right:20px;">📧 <strong>${unsubReqs.length}</strong> unsubscribe suggestions</span>
    <span style="margin-right:20px;">⏳ <strong>${totalPending}</strong> pending review</span>
    ${timeSensitive.length    > 0 ? `<span style="margin-right:20px;color:#dc3545;font-weight:bold;">${timeSensitive.length} time-sensitive</span>`   : ''}
    ${replyRequired.length    > 0 ? `<span style="color:#1a73e8;font-weight:bold;">${replyRequired.length} needs reply</span>`    : ''}
  </div>
  ${deletedSection}
  ${blockSection}
  ${unsubSection}
  ${pendingSection}
  ${tsSection}
  ${replySection}
  <p style="color:#bbb;font-size:11px;margin-top:30px;">Gmail Triage Agent — running automatically every 15 minutes</p>
</body></html>`;
}

// ─── New section builders ─────────────────────────────────────────────────────

function buildReplyRequiredSection_(items, webAppUrl, secret) {
  if (items.length === 0) return '';

  const toShow   = items.slice(0, 10);
  const overflow = items.length - toShow.length;
  items = toShow;

  const rows = items.map(item => {
    const dismissUrl = `${webAppUrl}?action=dismiss-reply&id=${encodeURIComponent(item.threadId)}&token=${generateToken_(item.threadId, secret)}`;
    return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #c5d8fc;font-size:13px;">${escapeHtml_(truncate_(item.sender, 40))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #c5d8fc;font-size:13px;">${escapeHtml_(truncate_(item.subject, 55))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #c5d8fc;font-size:12px;color:#555;max-width:260px;">${escapeHtml_(truncate_(item.snippet, 80))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #c5d8fc;white-space:nowrap;">
          <a href="${dismissUrl}" style="background:#1a73e8;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;">Dismiss</a>
        </td>
      </tr>`;
  }).join('');

  const replyOverflow = overflow > 0
    ? `<p style="color:#888;font-size:12px;margin-top:8px;">...and <strong>${overflow}</strong> more. Check your <em>ReplyRequired</em> sheet for the full list.</p>`
    : '';

  return `
    <div style="border-left:4px solid #1a73e8;background:#e8f0fe;padding:14px 18px;border-radius:6px;margin-bottom:20px;">
      <h3 style="color:#1a73e8;margin:0 0 6px;">Needs Your Reply</h3>
      <p style="color:#3c4043;font-size:12px;margin:0 0 12px;">Someone is waiting on you. Dismiss removes it from this section — the email stays in your inbox.</p>
      <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:4px;">
        <thead><tr style="background:#c5d8fc;">
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Sender</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Subject</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Preview</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${replyOverflow}
    </div>`;
}

function buildTimeSensitiveSection_(items, webAppUrl, secret) {
  if (items.length === 0) return '';

  const tsToShow   = items.slice(0, 10);
  const tsOverflow = items.length - tsToShow.length;
  items = tsToShow;

  const rows = items.map(item => {
    const approveUrl    = `${webAppUrl}?action=approve&id=${encodeURIComponent(item.id)}&token=${generateToken_(item.id, secret)}`;
    const denyUrl       = `${webAppUrl}?action=deny&id=${encodeURIComponent(item.id)}&token=${generateToken_(item.id, secret)}`;
    const pct           = Math.round(item.confidence * 100);
    const deadlineBadge = item.deadline
      ? `<span style="background:#dc3545;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;margin-left:6px;white-space:nowrap;">${escapeHtml_(item.deadline)}</span>`
      : `<span style="background:#fd7e14;color:#fff;padding:2px 6px;border-radius:3px;font-size:11px;margin-left:6px;">Urgent</span>`;
    return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #f5c6cb;font-size:13px;">${escapeHtml_(truncate_(item.sender, 40))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #f5c6cb;font-size:13px;">${escapeHtml_(truncate_(item.subject, 55))}${deadlineBadge}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #f5c6cb;font-size:13px;color:#888;">${pct}%</td>
        <td style="padding:8px 6px;border-bottom:1px solid #f5c6cb;font-size:13px;color:#555;">${escapeHtml_(truncate_(item.reason, 70))}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #f5c6cb;white-space:nowrap;">
          <a href="${approveUrl}" style="background:#dc3545;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;margin-right:4px;">Delete</a>
          <a href="${denyUrl}"    style="background:#28a745;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;">Keep</a>
        </td>
      </tr>`;
  }).join('');

  const tsOverflowNote = tsOverflow > 0
    ? `<p style="color:#888;font-size:12px;margin-top:8px;">...and <strong>${tsOverflow}</strong> more time-sensitive items. Check your <em>Pending</em> sheet for the full list.</p>`
    : '';

  return `
    <div style="border:2px solid #dc3545;border-radius:6px;padding:14px 18px;margin-bottom:20px;">
      <h3 style="color:#dc3545;margin:0 0 6px;">Time-Sensitive</h3>
      <p style="color:#555;font-size:12px;margin:0 0 12px;">Pending emails with an upcoming deadline. Act before the deadline shown on each row.</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f8d7da;">
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Sender</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Subject / Deadline</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Confidence</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Reason</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${tsOverflowNote}
    </div>`;
}

function buildBatchBlockSection_(senders, webAppUrl, secret) {
  if (senders.length === 0) return '';

  const MAX_BLOCK  = 25;
  const sorted     = senders.slice().sort((a, b) => b.deleteCount - a.deleteCount);
  const toShow     = sorted.slice(0, MAX_BLOCK);
  const overflow   = sorted.length - toShow.length;

  const rows = toShow.map(s => {
    const blockUrl = `${webAppUrl}?action=block-sender&id=${encodeURIComponent(s.email)}&name=${encodeURIComponent(s.name || '')}&token=${generateToken_(s.email, secret)}`;
    return `
      <tr>
        <td style="padding:8px 6px;border-bottom:1px solid #ffe0b2;font-size:13px;">${escapeHtml_(s.name || s.email)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #ffe0b2;font-size:13px;color:#888;">${escapeHtml_(s.email)}</td>
        <td style="padding:8px 6px;border-bottom:1px solid #ffe0b2;font-size:13px;text-align:center;"><strong>${s.deleteCount}</strong></td>
        <td style="padding:8px 6px;border-bottom:1px solid #ffe0b2;white-space:nowrap;">
          <a href="${blockUrl}" style="background:#e65100;color:#fff;padding:4px 10px;border-radius:4px;text-decoration:none;font-size:12px;">Block All &amp; Unsubscribe</a>
        </td>
      </tr>`;
  }).join('');

  const overflowNote = overflow > 0
    ? `<p style="color:#888;font-size:12px;margin-top:8px;">Showing top ${MAX_BLOCK} of <strong>${sorted.length}</strong> by delete count — see your <em>Actions</em> sheet for the full list.</p>`
    : '';

  return `
    <div style="background:#fff3e0;border:1px solid #ffcc80;border-radius:6px;padding:14px 18px;margin-bottom:20px;">
      <h3 style="color:#e65100;margin:0 0 6px;">Frequent Deletions — Block Sender?</h3>
      <p style="color:#555;font-size:12px;margin:0 0 12px;">Deleted ${BATCH_BLOCK_THRESHOLD}+ times. Block All permanently trashes every email from this sender across your entire Gmail.</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#ffe0b2;">
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Sender Name</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Email</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Times Deleted</th>
          <th style="padding:8px 6px;text-align:left;font-size:12px;">Action</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${overflowNote}
    </div>`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generateToken_(id, secret) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, id + ':' + secret);
  return digest.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('').substring(0, 16);
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'MMMM d, yyyy');
}

function escapeHtml_(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate_(str, max) {
  const s = String(str || '');
  return s.length <= max ? s : s.substring(0, max - 1) + '…';
}
