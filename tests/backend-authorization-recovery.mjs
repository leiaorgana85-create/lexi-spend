import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('v2/api.js', 'utf8');
const BACKEND_URL = 'https://script.google.com/macros/s/AKfycby084l1Rupc838tdinecb2J5NCdOurkIa-smKFJqhypYINd_5walm15NLMWH7vSPWrA/exec';
const timers = [];
const listeners = new Map();
const nodes = new Map();
let opened = '';

function node(id='') {
  const handlers = new Map();
  return {
    id, textContent:'', className:'', hidden:false, type:'', isConnected:false, style:{},
    setAttribute(){}, remove(){ this.isConnected=false; },
    addEventListener(type, fn){ handlers.set(type, fn); },
    click(){ handlers.get('click')?.(); },
    querySelector(selector){
      if (id === 'settingsDialog' && selector === '.dialog-actions') return actions;
      return null;
    }
  };
}
const actions = { prepend(n){ nodes.set(n.id, n); } };
nodes.set('connectionBadge', node('connectionBadge'));
nodes.set('settingsConnection', node('settingsConnection'));
nodes.set('settingsDialog', node('settingsDialog'));
const document = {
  readyState:'complete', visibilityState:'visible',
  body:{ appendChild(n){ n.isConnected=true; } },
  createElement(tag){ return node(tag); },
  getElementById(id){ return nodes.get(id) || null; },
  addEventListener(type, fn){ listeners.set('document:'+type, fn); }
};
const values = new Map([['lexiSpendPrivateApiCodeV1','saved-code']]);
const localStorage = { getItem:k=>values.get(k) ?? null, setItem:(k,v)=>values.set(k,String(v)), removeItem:k=>values.delete(k) };
const window = {
  document, localStorage,
  addEventListener(type, fn){ listeners.set('window:'+type, fn); },
  dispatchEvent(){},
  open(url){ opened=url; }
};
const context = {
  window, document, localStorage, indexedDB:{open(){return {}; }}, navigator:{onLine:true}, URL, console,
  Event: class Event { constructor(type){this.type=type;} },
  setTimeout(fn,ms){ const t={fn,ms,cleared:false}; timers.push(t); return t; },
  clearTimeout(t){ if(t)t.cleared=true; }
};
context.globalThis=context;
vm.runInNewContext(source, context, {filename:'v2/api.js'});

const pending = window.SpendApi.call('getAppState', []);
await Promise.resolve();
const readyTimer = timers.find(t => t.ms === 20000 && !t.cleared);
assert.ok(readyTimer, 'backend readiness must remain bounded');
readyTimer.fn();
await assert.rejects(pending, /Backend access may need authorization/);
const promptTimer = timers.find(t => t.ms === 0 && !t.cleared);
assert.ok(promptTimer, 'authorization recovery prompt must be scheduled after readiness failure');
promptTimer.fn();
assert.equal(nodes.get('connectionBadge').textContent, 'Authorization needed');
assert.equal(nodes.get('settingsConnection').textContent, 'Backend access may need authorization');
const button = nodes.get('backendAuthorizationButton');
assert.ok(button && !button.hidden, 'one-tap authorization button must appear in Settings');
button.click();
assert.equal(opened, BACKEND_URL, 'recovery button must open the existing deployed backend URL');
assert.equal(values.get('lexiSpendPrivateApiCodeV1'), 'saved-code', 'backend authorization recovery must not clear the private API code');

const sourceWindow = {};
listeners.get('window:message')({data:{type:'lexi-spend-bridge-ready'}, source:sourceWindow, origin:'https://script.google.com'});
assert.equal(button.hidden, true, 'recovery button must hide once the bridge is ready again');
console.log('PASS backend authorization recovery');
