import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { Window } = await import(process.env.HAPPY_DOM_MODULE
  ? pathToFileURL(path.resolve(process.env.HAPPY_DOM_MODULE)).href
  : 'happy-dom');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiSource = fs.readFileSync(path.join(root, 'v2/api.js'), 'utf8');
const releaseSource = fs.readFileSync(path.join(root, 'v2/release.js'), 'utf8');
const turn = () => new Promise(resolve => setImmediate(resolve));

function appState() {
  return {
    summary: {
      weekStart:'2030-01-01',
      weekEnd:'2030-01-07',
      periodStart:'2030-01-01',
      periodEnd:'2030-01-31',
      weeklyTotal:999,
      budgetTotal:30,
      categories:[
        {name:'Food',limit:50,spent:10},
        {name:'Shopping',limit:50,spent:20},
        {name:'GLP-1',limit:null,spent:30}
      ]
    }
  };
}

function calendarState() {
  return {
    days: {
      '2030-01-01': { transactions: [
        {category:'Food',usdAmount:10},
        {category:'Shopping & Others',usdAmount:20},
        {category:'GLP-1',usdAmount:30},
        {category:'Unconfigured',usdAmount:40}
      ]},
      '2030-01-08': { transactions: [
        {category:'Food',usdAmount:50}
      ]}
    }
  };
}

function apiHarness(activeView) {
  const w = new Window({
    url:'https://example.test/lexi-spend/v2/',
    settings:{disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableIframePageLoading:true}
  });
  w.document.body.dataset.activeView = activeView;
  w.localStorage.setItem('lexiSpendPrivateApiCodeV1','fixture-code');
  w.eval(apiSource);
  const messages = [];
  const target = { postMessage: message => messages.push(message) };
  const reply = data => w.dispatchEvent(new w.MessageEvent('message', {
    origin:'https://script.googleusercontent.com', source:target, data
  }));
  reply({type:'lexi-spend-bridge-ready'});
  return {w,messages,reply};
}

{
  const {w,messages,reply} = apiHarness('track');
  const pending = w.SpendApi.call('getAppState',['2030-01-03','THB']);
  await turn();
  assert.equal(messages.length,1);
  reply({type:'lexi-spend-result',id:messages[0].id,ok:true,result:appState()});
  const result = await pending;
  assert.equal(result.summary.weeklyTotal,999,'Track keeps the primary read fast and unchanged');
  assert.equal(messages.length,1,'Track must not add a Calendar request');
  w.close();
}

{
  const {w,messages,reply} = apiHarness('budget');
  const pending = w.SpendApi.call('getAppState',['2030-01-03','THB']);
  await turn();
  assert.equal(messages.length,1);
  reply({type:'lexi-spend-result',id:messages[0].id,ok:true,result:appState()});
  await turn();
  assert.equal(messages.length,2,'Budget adds one authoritative Calendar read');
  assert.equal(messages[1].functionName,'getCalendarMonth');
  assert.equal(JSON.stringify(messages[1].parameters),JSON.stringify(['2030-01']));
  reply({type:'lexi-spend-result',id:messages[1].id,ok:true,result:calendarState()});
  const result = await pending;
  assert.equal(result.summary.weeklyTotal,30,'weekly spend uses only budgeted categories');
  w.close();
}

{
  const w = new Window({url:'https://example.test/lexi-spend/v2/'});
  w.document.body.innerHTML = `
    <button class="lexi-tab" data-view="budget">Budget</button>
    <button id="refreshAppButton">Refresh</button>
    <small id="appVersion" data-version="v1.09"><span id="settingsFrontendVersion">v1.05</span></small>`;
  let refreshes = 0;
  w.document.getElementById('refreshAppButton').addEventListener('click', () => refreshes++);
  w.eval(releaseSource);
  assert.equal(w.document.getElementById('settingsFrontendVersion').textContent,'v1.09');
  w.document.querySelector('[data-view="budget"]').click();
  await new Promise(resolve => w.setTimeout(resolve,1));
  assert.equal(refreshes,1,'opening Budget triggers its authoritative refresh');
  w.close();
}

console.log('PASS Budget consistency: scoped refresh, budget-only weekly total, Shopping alias and v1.09 label.');
