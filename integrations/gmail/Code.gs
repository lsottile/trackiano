const TRACKIANO_PROCESSED_LABEL = 'trackiano-ingested';
const TRACKIANO_TRIGGER_HANDLER = 'forwardTakenosEmails';

function requiredProperty_(properties, name) {
  const value = properties[name]?.trim();
  if (!value) throw new Error(`Missing script property: ${name}`);
  return value;
}

function getConfig_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  return {
    ingestUrl: requiredProperty_(properties, 'TRACKIANO_INGEST_URL').replace(/\/$/u, ''),
    token: requiredProperty_(properties, 'TRACKIANO_INGEST_TOKEN'),
    sender: requiredProperty_(properties, 'TAKENOS_EMAIL_SENDER'),
    startedAt: requiredProperty_(properties, 'TRACKIANO_STARTED_AT'),
  };
}

function getProcessedLabelId_() {
  const labels = Gmail.Users.Labels.list('me').labels ?? [];
  const existing = labels.find((label) => label.name === TRACKIANO_PROCESSED_LABEL);
  if (existing) return existing.id;
  return Gmail.Users.Labels.create({
    name: TRACKIANO_PROCESSED_LABEL,
    labelListVisibility: 'labelShow',
    messageListVisibility: 'show',
  }, 'me').id;
}

function headerValue_(headers, name) {
  return headers?.find((header) => header.name?.toLowerCase() === name)?.value ?? '';
}

function plainText_(part) {
  if (part?.mimeType === 'text/plain' && part.body?.data) {
    const bytes = Utilities.base64DecodeWebSafe(part.body.data);
    return Utilities.newBlob(bytes).getDataAsString('UTF-8');
  }
  for (const child of part?.parts ?? []) {
    const text = plainText_(child);
    if (text) return text;
  }
  return '';
}

function forwardMessage_(messageId, config, labelId) {
  const message = Gmail.Users.Messages.get('me', messageId, { format: 'full' });
  const payload = {
    id: message.id,
    from: headerValue_(message.payload?.headers, 'from'),
    subject: headerValue_(message.payload?.headers, 'subject'),
    text: plainText_(message.payload),
  };
  const response = UrlFetchApp.fetch(`${config.ingestUrl}/ingest/takenos/email`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${config.token}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const statusCode = response.getResponseCode();
  let result = {};
  try {
    result = JSON.parse(response.getContentText());
  } catch {
    return;
  }
  if (statusCode >= 200 && statusCode < 300 &&
      ['created', 'duplicate', 'pending'].includes(result.status)) {
    Gmail.Users.Messages.modify({ addLabelIds: [labelId] }, 'me', messageId);
  }
}

function forwardTakenosEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const config = getConfig_();
    const labelId = getProcessedLabelId_();
    const query = `from:(${config.sender}) -label:${TRACKIANO_PROCESSED_LABEL} after:${config.startedAt}`;
    const messages = Gmail.Users.Messages.list('me', { q: query, maxResults: 50 }).messages ?? [];
    for (const message of messages) {
      forwardMessage_(message.id, config, labelId);
    }
  } finally {
    lock.releaseLock();
  }
}

function setupTakenosEmailForwarder() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('TRACKIANO_STARTED_AT')) {
    properties.setProperty('TRACKIANO_STARTED_AT', String(Math.floor(Date.now() / 1000)));
  }
  getConfig_();
  getProcessedLabelId_();
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === TRACKIANO_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
    }
  }
  ScriptApp.newTrigger(TRACKIANO_TRIGGER_HANDLER)
    .timeBased()
    .everyMinutes(5)
    .create();
}
