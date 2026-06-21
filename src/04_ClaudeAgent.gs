// Calls Claude Haiku in batches for cost efficiency.
// Only emails that pass through the rule engine without a decision reach here.

function triageWithClaude_(emails) {
  const apiKey  = getApiKey_();
  const payload = {
    model:      CLAUDE_MODEL_FAST,
    max_tokens: 2048,
    messages:   [{ role: 'user', content: buildTriagePrompt_(emails) }],
  };

  const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method:           'POST',
    headers: {
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    payload:           JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`Claude API error ${response.getResponseCode()}: ${response.getContentText()}`);
    return emails.map(() => ({ action: 'review', confidence: 0.5, reason: 'AI triage failed — flagged for manual review' }));
  }

  try {
    const body = JSON.parse(response.getContentText());
    return parseTriageResponse_(body.content[0].text, emails.length);
  } catch (e) {
    Logger.log(`Failed to parse Claude response: ${e.message}`);
    return emails.map(() => ({ action: 'review', confidence: 0.5, reason: 'Could not parse AI response' }));
  }
}

function buildTriagePrompt_(emails) {
  const taxonomyLines = Object.entries(LABEL_TAXONOMY)
    .map(([path, desc]) => `  "${path}" — ${desc}`)
    .join('\n');

  const list = emails.map((e, i) =>
    `${i + 1}. From: ${e.senderName} <${e.sender}>\n   Subject: ${e.subject}\n   Preview: ${e.snippet}\n   Gmail category: ${e.gmailCategory}`
  ).join('\n\n');

  return `You are a personal email triage assistant. Analyse each email and return a structured decision.

Valid category labels (use the exact string, or null if none fit):
${taxonomyLines}

Emails to triage:
${list}

Reply with a JSON array only — one object per email, in the same order. Each object must have:
- "action": "keep" | "delete" | "review"
- "confidence": float 0.0–1.0
- "reason": one concise sentence explaining the decision
- "category": one of the exact label strings above, or null if none fit
- "replyRequired": true only if a human is waiting on a response or there is a direct question/action request addressed to the user; false otherwise
- "timeSensitive": true if there is an explicit deadline, expiry, or urgent timeframe; false otherwise
- "deadline": the extracted date or phrase if timeSensitive is true (e.g. "June 20", "by Friday", "tomorrow"), otherwise null

Triage guidelines:
- delete: newsletters, marketing, automated social alerts, bulk promotions, digest emails the user never reads
- keep: anything personal, financial, legal, job-related, requires a reply, time-sensitive, or has an attachment
- review: genuinely ambiguous — when in doubt, use keep or review, never delete
- Reserve confidence > 0.92 for very obvious cases only
- Be conservative — deleting something important is worse than keeping something unnecessary

Respond with the JSON array only, no other text.`;
}

function parseTriageResponse_(text, expectedCount) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('No JSON array in Claude response');

  const validCategories = new Set(Object.keys(LABEL_TAXONOMY));
  const parsed = JSON.parse(match[0]);

  // Pad with safe defaults if Claude returned fewer items than expected
  while (parsed.length < expectedCount) {
    parsed.push({ action: 'review', confidence: 0.5, reason: 'Missing from AI response', category: null, replyRequired: false, timeSensitive: false, deadline: null });
  }

  return parsed.slice(0, expectedCount).map(item => ({
    action:        ['keep', 'delete', 'review'].includes(item.action) ? item.action : 'review',
    confidence:    Math.min(1.0, Math.max(0.0, parseFloat(item.confidence) || 0.5)),
    reason:        item.reason || 'No reason provided',
    category:      validCategories.has(item.category) ? item.category : null,
    replyRequired: item.replyRequired === true,
    timeSensitive: item.timeSensitive === true,
    deadline:      item.timeSensitive === true && item.deadline ? String(item.deadline) : null,
  }));
}
