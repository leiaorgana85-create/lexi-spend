// Read-only staging smoke test. Never sends API credentials or writes to the ledger.
'use strict';
const assert = require('node:assert/strict');
const WEBAPP = process.env.LEXI_SPEND_STAGED_WEBAPP_URL;
assert.match(WEBAPP || '', /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/);
(async()=>{
  const response=await fetch(WEBAPP+'?migration-smoke=1',{
    redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(45000)
  });
  const html=await response.text();
  const finalHost=new URL(response.url).hostname;
  assert(response.ok, 'Staged web app not HTTP 200: '+response.status);
  assert(/script\.google\.com|script\.googleusercontent\.com|\.googleusercontent\.com$/.test(finalHost),
    'Unexpected redirect host '+finalHost);
  assert(!/accounts\.google\.com|sign in with google/i.test(response.url),'Redirected to sign-in page');
  assert(!/Authorization is required|Sorry, unable to open the file|This app is blocked|You need access/i.test(html),
    'Staged web app appears to require authorization or permission');
  assert(html.length>300,'Staged web app returned a short or empty response');
  const containsBridge=/lexi-spend-bridge-ready|bridgeExecuteV2|Lexi Spend API/.test(html);
  console.log('Staged Apps Script: HTTP '+response.status+', final host '+finalHost+
    ', body length '+html.length+', bridge text embedded '+containsBridge);
  // HTMLService may encode the user HTML, so this is an HTTP/permissions smoke test,
  // not an authenticated google.script.run or data-mutation test.
  console.log('PASS staged endpoint GET and redirect. Bridge interaction remains user-browser verification.');
})().catch(err=>{console.error('STAGED ENDPOINT FAIL: '+err.message);process.exitCode=1;});
