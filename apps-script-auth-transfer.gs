// Lexi Spend secure Home Screen reinstall transfer.
// Add this file to the live "Lexi Spend API" Apps Script project.
// It reuses the existing Code.gs helpers assertLexiSpendApiCode_(),
// lexiSpendSha256Hex_(), and runLexiSpendApiFunction_().

const LEXI_SPEND_INSTALL_HASH_PROP = 'LEXI_SPEND_INSTALL_TOKEN_HASH_V1';
const LEXI_SPEND_INSTALL_EXPIRES_PROP = 'LEXI_SPEND_INSTALL_TOKEN_EXPIRES_V1';
const LEXI_SPEND_SESSION_PROP = 'LEXI_SPEND_TRANSFER_SESSIONS_V1';
const LEXI_SPEND_INSTALL_TTL_MS = 10 * 60 * 1000;
const LEXI_SPEND_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const LEXI_SPEND_MAX_SESSIONS = 12;

function authMintInstallToken(apiCode) {
  assertLexiSpendApiCode_(apiCode);
  const token = 'lxi1.' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const expiresAt = Date.now() + LEXI_SPEND_INSTALL_TTL_MS;
  PropertiesService.getScriptProperties().setProperties({
    [LEXI_SPEND_INSTALL_HASH_PROP]: lexiSpendSha256Hex_(token),
    [LEXI_SPEND_INSTALL_EXPIRES_PROP]: String(expiresAt)
  }, false);
  return { token: token, expiresAt: new Date(expiresAt).toISOString() };
}

function authRedeemInstallToken(token) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const value = String(token || '').trim();
    if (!value) throw new Error('Missing Lexi Spend install token.');

    const props = PropertiesService.getScriptProperties();
    const savedHash = props.getProperty(LEXI_SPEND_INSTALL_HASH_PROP);
    const expiresAt = Number(props.getProperty(LEXI_SPEND_INSTALL_EXPIRES_PROP) || 0);

    if (!savedHash || !expiresAt || Date.now() > expiresAt) {
      props.deleteProperty(LEXI_SPEND_INSTALL_HASH_PROP);
      props.deleteProperty(LEXI_SPEND_INSTALL_EXPIRES_PROP);
      throw new Error('Lexi Spend install token expired.');
    }

    if (lexiSpendSha256Hex_(value) !== savedHash) {
      throw new Error('Invalid Lexi Spend install token.');
    }

    props.deleteProperty(LEXI_SPEND_INSTALL_HASH_PROP);
    props.deleteProperty(LEXI_SPEND_INSTALL_EXPIRES_PROP);

    const sessionToken = 'lxs1.' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    const sessions = readLexiSpendTransferSessions_();
    const now = Date.now();
    sessions.push({ hash: lexiSpendSha256Hex_(sessionToken), expiresAt: now + LEXI_SPEND_SESSION_TTL_MS });
    const active = sessions
      .filter(item => item && item.hash && Number(item.expiresAt) > now)
      .slice(-LEXI_SPEND_MAX_SESSIONS);
    props.setProperty(LEXI_SPEND_SESSION_PROP, JSON.stringify(active));

    return { sessionToken: sessionToken, expiresAt: new Date(now + LEXI_SPEND_SESSION_TTL_MS).toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function authBridgeExecuteSession(sessionToken, functionName, parameters) {
  assertLexiSpendTransferSession_(sessionToken);
  return runLexiSpendApiFunction_(functionName, parameters);
}

function readLexiSpendTransferSessions_() {
  const raw = PropertiesService.getScriptProperties().getProperty(LEXI_SPEND_SESSION_PROP) || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function assertLexiSpendTransferSession_(sessionToken) {
  const value = String(sessionToken || '').trim();
  if (!value || !value.startsWith('lxs1.')) throw new Error('Invalid Lexi Spend session.');

  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  const wantedHash = lexiSpendSha256Hex_(value);
  const sessions = readLexiSpendTransferSessions_();
  const active = sessions.filter(item => item && item.hash && Number(item.expiresAt) > now);
  if (active.length !== sessions.length) props.setProperty(LEXI_SPEND_SESSION_PROP, JSON.stringify(active));

  const match = active.some(item => String(item.hash) === wantedHash);
  if (!match) throw new Error('Expired Lexi Spend session.');
}
