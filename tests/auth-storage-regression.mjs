import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('v2/api.js','utf8');
function harness(localCode='') {
  const values=new Map(); if(localCode)values.set('lexiSpendPrivateApiCodeV1',localCode);
  const timers=[]; let deleted=0;
  const localStorage={getItem:k=>values.has(k)?values.get(k):null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)};
  const document={body:{appendChild(n){n.isConnected=true;}},createElement(){return {style:{},isConnected:false,setAttribute(){},remove(){this.isConnected=false;}};}};
  const indexedDB={open(){return {};},deleteDatabase(){deleted++;return {};}};
  const window={document,localStorage,indexedDB,addEventListener(){}};
  const context={window,document,localStorage,indexedDB,navigator:{onLine:true},URL,console,
    setTimeout(fn,ms){const t={fn,ms,cleared:false};timers.push(t);return t;},clearTimeout(t){if(t)t.cleared=true;}};
  context.globalThis=context; vm.runInNewContext(source,context,{filename:'v2/api.js'});
  return {window,timers,values,deleted:()=>deleted};
}
{
  const h=harness(); const pending=h.window.SpendApi.hasCode(); await Promise.resolve();
  const deadline=h.timers.find(t=>t.ms===5000&&!t.cleared);
  assert.ok(deadline,'authorization storage lookup must have a 5-second deadline');
  deadline.fn(); assert.equal(await pending,false);
  assert.equal(h.deleted(),0); assert.equal(h.values.size,0);
}
{
  const h=harness('saved-code'); assert.equal(await h.window.SpendApi.hasCode(),true);
  assert.equal(h.timers.some(t=>t.ms===5000&&!t.cleared),false);
  assert.equal(h.values.get('lexiSpendPrivateApiCodeV1'),'saved-code');
}
console.log('PASS bounded authorization storage fallback');
