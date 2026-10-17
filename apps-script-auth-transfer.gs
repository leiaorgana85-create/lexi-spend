// Lexi Spend secure reinstall authorization.
// Add this file to the live "Lexi Spend API" Apps Script project.
// It reuses the existing Code.gs helpers assertLexiSpendApiCode_(),
// lexiSpendSha256Hex_(), and runLexiSpendApiFunction_().

const LEXI_SPEND_GOOGLE_CLIENT_ID = '543436064136-27a477uk691qocpaft25q925lg88hl98.apps.googleusercontent.com';
const LEXI_SPEND_GOOGLE_SUB_PROP = 'LEXI_SPEND_GOOGLE_SUB_V1';
const LEXI_SPEND_SESSION_PROP = 'LEXI_SPEND_TRANSFER_SESSIONS_V1';
const LEXI_SPEND_SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const LEXI_SPEND_MAX_SESSIONS = 12;
const LEXI_SPEND_INSTALL_HASH_PROP = 'LEXI_SPEND_INSTALL_TOKEN_HASH_V1';
const LEXI_SPEND_INSTALL_EXPIRES_PROP = 'LEXI_SPEND_INSTALL_TOKEN_EXPIRES_V1';

function authGoogleBootstrap(credential, currentCredential) {
  const identity = verifyLexiSpendGoogleCredential_(credential);
  const props = PropertiesService.getScriptProperties();
  const linkedSub = String(props.getProperty(LEXI_SPEND_GOOGLE_SUB_PROP) || '').trim();
  let linkedNow = false;

  if (!linkedSub) {
    assertLexiSpendExistingCredential_(currentCredential);
    props.setProperty(LEXI_SPEND_GOOGLE_SUB_PROP, identity.sub);
    linkedNow = true;
  } else if (identity.sub !== linkedSub) {
    throw new Error('This Google account is not linked to Lexi Spend.');
  }

  // Retire any stale state from the temporary cookie-transfer experiment.
  props.deleteProperty(LEXI_SPEND_INSTALL_HASH_PROP);
  props.deleteProperty(LEXI_SPEND_INSTALL_EXPIRES_PROP);

  const session = issueLexiSpendSession_();
  return {
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
    linkedNow: linkedNow
  };
}

function assertLexiSpendExistingCredential_(credential) {
  const value = String(credential || '').trim();
  if (!value) throw new Error('First Google link requires existing Lexi Spend authorization on this device.');
  if (value.startsWith('lxs1.')) {
    assertLexiSpendTransferSession_(value);
    return;
  }
  assertLexiSpendApiCode_(value);
}

function verifyLexiSpendGoogleCredential_(credential) {
  const token = String(credential || '').trim();
  if (!token) throw new Error('Google sign-in credential is missing.');

  const response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('Google sign-in could not be verified.');
  }

  let data;
  try {
    data = JSON.parse(response.getContentText());
  } catch (_) {
    throw new Error('Google sign-in response was invalid.');
  }

  const issuer = String(data.iss || '');
  if (String(data.aud || '') !== LEXI_SPEND_GOOGLE_CLIENT_ID) {
    throw new Error('Google sign-in audience mismatch.');
  }
  if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
    throw new Error('Google sign-in issuer mismatch.');
  }
  if (String(data.email_verified || '').toLowerCase() !== 'true') {
    throw new Error('Google account email is not verified.');
  }
  if (!data.sub || Number(data.exp || 0) * 1000 <= Date.now()) {
    throw new Error('Google sign-in credential expired.');
  }

  return { sub: String(data.sub) };
}

function issueLexiSpendSession_() {
  const sessionToken = 'lxs1.' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const sessions = readLexiSpendTransferSessions_();
  const now = Date.now();
  const expiresAt = now + LEXI_SPEND_SESSION_TTL_MS;
  sessions.push({ hash: lexiSpendSha256Hex_(sessionToken), expiresAt: expiresAt });
  const active = sessions
    .filter(item => item && item.hash && Number(item.expiresAt) > now)
    .slice(-LEXI_SPEND_MAX_SESSIONS);
  PropertiesService.getScriptProperties().setProperty(LEXI_SPEND_SESSION_PROP, JSON.stringify(active));
  return { sessionToken: sessionToken, expiresAt: new Date(expiresAt).toISOString() };
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
