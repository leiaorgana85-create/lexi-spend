import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
const { Window } = await import(process.env.HAPPY_DOM_MODULE
  ? pathToFileURL(path.resolve(process.env.HAPPY_DOM_MODULE)).href : 'happy-dom');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlRoot = process.env.SPEND_HTML_ROOT || root;
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
const emptyMonth = () => ({ days:{}, monthTotalUsd:0, transactionCount:0 });
function fixture() {
  return { appVersion:'fixture', currency:'THB', country:'Example', recent:[],
    cashWallets:{ THB:{currency:'THB',withdrawals:2000,cashSpent:0,balance:2000,
      calendarMonthFees:0,calendarMonthFeesUsd:0,monthWithdrawals:[],recentWithdrawals:[]} },
    summary:{periodDays:31,periodStart:'2030-01-01',periodEnd:'2030-01-31',
      weekStart:'2030-01-01',weekEnd:'2030-01-07',budgetLimit:100,budgetTotal:0,
      weeklyTotal:0,stayTotal:0,categories:[{name:'Category A',spent:0,limit:50},
      {name:'Category B',spent:0,limit:50}]} };
}
const windows=[];
function harness({ realApi=false, savedPending=null, savedCurrency=null, savedCashCurrency=null, savedOutbox=null }={}) {
  const w = new Window({url:'https://example.test/lexi-spend/v2/',settings:{
    disableCSSFileLoading:true,disableJavaScriptFileLoading:true,disableIframePageLoading:true }});
  windows.push(w);
  if(savedOutbox)w.localStorage.setItem('lexiSpendV2OutboxV1',savedOutbox);
  if(savedCashCurrency)w.localStorage.setItem('lexiSpendV2CashCurrency',savedCashCurrency);
  if(savedCurrency)w.localStorage.setItem('lexiSpendV2ExpenseCurrency',savedCurrency);
  if(savedPending)w.localStorage.setItem('lexiSpendV2PendingSaves',savedPending);
  const html=fs.readFileSync(path.join(htmlRoot,'v2/index.html'),'utf8')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  w.document.write(html);w.confirm=()=>true;
  let now=Date.parse('2030-01-15T12:00:00Z');
  const RealDate=w.Date;
  w.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[now]));} static now(){return now;} };
  const intervals=[];w.setInterval=fn=>{intervals.push(fn);return intervals.length;};
  const f=fixture();const calls=[];let handler=async name=>name==='getAppState'?clone(f):emptyMonth();
  w.SpendApi={hasCode:async()=>true,resetBridge(){calls.push(['reset']);},call:async(...args)=>{calls.push(args);return handler(...args);}};
  if(realApi){w.eval(source('v2/api.js'));w.SpendApi={...w.SpendApi,warmRate:()=>{}};}
  const code=source('v2/app.js').replace('  init();',`  window.audit={state,init,bind,renderApp,configureControls,loadAppState,loadCalendarMonth,
    beginLedgerWrite,finishLedgerWrite,saveExpense,deleteExpense,saveCash,deleteCash,flushOutbox,readOutbox,
    applyCalendarExpenseSave,applyCalendarExpenseDelete,refreshLocalDates,localIsoDate,saveCalendarCache,
    updateConverter,updateExpensePreview,updateCashPreview,scheduleConverter,scheduleExpensePreview,scheduleCashPreview};`);
  assert.notEqual(code,source('v2/app.js'),'test entrypoint marker');w.eval(code.replace('function writeOutbox(value) {', 'function writeOutbox(value) { if(window.auditStorageFull)throw Error("Storage full");'));
  const a=w.audit,$=id=>w.document.getElementById(id);
  a.state.app=clone(f);a.state.cashCurrency='THB';a.state.calendarCursor=new w.Date(2030,0,1);
  a.state.autoDates={expense:'2030-01-15',cash:'2030-01-15'};
  $('expenseDate').value='2030-01-15';$('cashDate').value='2030-01-15';a.renderApp();
  return {w,a,$,f,calls,intervals,setHandler:fn=>{handler=fn;},setNow:value=>{now=Date.parse(value);}};
}
let passed=0;
async function check(name,fn){await fn();passed++;console.log(`PASS ${name}`);}
try {
await check('FX coalesces concurrent amounts, calculates locally at full rate precision, persists and separates dates',async()=>{
  const h=harness({realApi:true}),{w}=h;
  w.localStorage.setItem('lexiSpendPrivateApiCodeV1','fixture-code');
  const messages=[],target={postMessage:message=>messages.push(message)};
  const reply=data=>w.dispatchEvent(new w.MessageEvent('message',{origin:'https://script.googleusercontent.com',source:target,data}));
  reply({type:'lexi-spend-bridge-ready'});
  const p=w.SpendApi.call('previewUsd',[100,'THB','2030-01-15']);
  const q=w.SpendApi.call('previewUsd',[200,'THB','2030-01-15']);await turn();
  assert.equal(messages.length,1);assert.deepEqual(clone(messages[0].parameters),[1,'THB','2030-01-15']);
  reply({type:'lexi-spend-result',id:messages[0].id,ok:true,result:{rate:1/33,effectiveDate:'2030-01-14'}});
  assert.equal((await p).usdAmount,3.03);assert.equal((await q).usdAmount,6.06);
  assert.equal((await w.SpendApi.call('previewUsd',[500,'THB','2030-01-15'])).usdAmount,15.15);
  assert.equal((await w.SpendApi.call('previewUsd',[500,'USD','2030-01-15'])).usdAmount,500);
  assert.equal(messages.length,1);
  const persisted=JSON.parse(w.localStorage.getItem('lexiSpendV2FxRatesV1'));assert.equal(persisted['THB:2030-01-15'].rate,1/33);
  const next=w.SpendApi.call('previewUsd',[100,'THB','2030-01-16']);await turn();assert.equal(messages.length,2);
  // An in-flight call must retain its transport, including while resuming.
  const frame=w.document.getElementById('lexiSpendV2ApiBridge');assert.equal(w.SpendApi.resetBridge(),false);
  assert.equal(w.document.getElementById('lexiSpendV2ApiBridge'),frame);
  reply({type:'lexi-spend-result',id:messages[1].id,ok:true,result:{rate:1/32,effectiveDate:'2030-01-16'}});
  assert.equal((await next).usdAmount,3.13);
  const reopened=harness({realApi:true});reopened.w.localStorage.setItem('lexiSpendV2FxRatesV1',JSON.stringify(persisted));
  reopened.w.eval(source('v2/api.js'));
  Object.defineProperty(reopened.w.navigator,'onLine',{value:false,configurable:true});
  assert.equal((await reopened.w.SpendApi.call('previewUsd',[330,'THB','2030-01-15'])).usdAmount,10);
});
await check('startup registers updates before network completion and drains pending writes before reads',async()=>{
  const h=harness({savedOutbox:JSON.stringify({'logExpense:e1':{name:'logExpense',params:[{entryId:'e1',date:'2030-01-15',merchant:'Example',currency:'THB',amount:10}],affectedDate:'2030-01-15',token:'t1'}})});
  let registered=false,resolveWrite;
  Object.defineProperty(h.w.navigator,'serviceWorker',{configurable:true,value:{register:()=>{registered=true;return Promise.resolve();}}});
  h.setHandler((name)=>name==='logExpense'?new Promise(resolve=>resolveWrite=resolve):Promise.resolve(clone(h.f)));
  const start=h.a.init();await turn();assert.equal(registered,true);
  assert.equal(h.calls[0][0],'logExpense');assert.equal(h.calls.filter(x=>x[0]==='getAppState').length,0);
  assert.equal(h.$('saveExpenseButton').disabled,false);
  resolveWrite({deduped:true});await start;
  assert.equal(h.calls.filter(x=>x[0]==='getAppState').length,1);assert.equal(Object.keys(h.a.readOutbox()).length,0);
  assert.equal(h.$('connectionBadge').textContent,'Connected');
});
await check('resume cannot remove a pending sync transport; new entries remain usable while flushing',async()=>{
  const h=harness({savedOutbox:JSON.stringify({'logExpense:e1':{name:'logExpense',params:[{entryId:'e1',date:'2030-01-15',merchant:'Example',currency:'THB',amount:10}],affectedDate:'2030-01-15',token:'t1'}})});
  h.a.bind();let resolveWrite;
  h.setHandler(name=>name==='logExpense'?new Promise(resolve=>resolveWrite=resolve):Promise.resolve(clone(h.f)));
  const flush=h.a.flushOutbox();await turn();assert.equal(h.a.state.flushing,true);assert.equal(h.$('saveExpenseButton').disabled,false);
  Object.defineProperty(h.w.document,'visibilityState',{configurable:true,value:'hidden'});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));
  h.setNow('2030-01-16T12:00:00Z');Object.defineProperty(h.w.document,'visibilityState',{configurable:true,value:'visible'});
  h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));await turn();assert.equal(h.calls.filter(x=>x[0]==='reset').length,0);
  h.$('merchant').value='New entry';h.$('expenseAmount').value='20';await h.a.saveExpense({preventDefault(){}});
  assert.equal(Object.keys(h.a.readOutbox()).length,2);assert.equal(h.calls.filter(x=>x[0]==='logExpense').length,1);
  resolveWrite({deduped:true});await flush;await turn();assert.equal(Object.keys(h.a.readOutbox()).length,1);
  h.setHandler(async name=>name==='getAppState'?clone(h.f):{deduped:true});await h.a.flushOutbox();
  assert.equal(Object.keys(h.a.readOutbox()).length,0);
});
await check('pending errors stay visible with working Retry sync and clear after confirmation',async()=>{
  const h=harness({savedOutbox:JSON.stringify({'deleteCashWithdrawal:c1':{name:'deleteCashWithdrawal',params:['c1'],token:'t1'}})});
  h.setHandler(async()=>{throw Error('Backend unavailable');});await h.a.flushOutbox();
  assert.match(h.$('pendingDetails').textContent,/Backend unavailable/);assert.equal(h.$('retryPendingButton').disabled,false);
  h.setHandler(async name=>name==='getAppState'?clone(h.f):{alreadyDeleted:true});h.$('retryPendingButton').click();await turn();await turn();
  assert.equal(Object.keys(h.a.readOutbox()).length,0);assert.equal(h.$('connectionBadge').textContent,'Connected');
});
await check('canonical Calendar refresh, request coalescing and no cache freshness renewal',async()=>{
  const h=harness({realApi:true}),{w,a}=h,key='lexiSpendV2Calendar:2030-01';
  w.localStorage.setItem('lexiSpendPrivateApiCodeV1','fixture-code');
  w.localStorage.setItem(key,JSON.stringify({savedAt:1,data:{days:{},monthTotalUsd:10}}));
  const messages=[],target={postMessage:message=>messages.push(message)};
  const reply=data=>w.dispatchEvent(new w.MessageEvent('message',{origin:'https://script.googleusercontent.com',source:target,data}));
  reply({type:'lexi-spend-bridge-ready'});
  assert.equal(await w.SpendApi.hasCode(),true);await turn();assert.equal(messages.length,0);
  let resolved=false;const p=a.loadCalendarMonth('2030-01',true).then(()=>{resolved=true;});
  const q=a.loadCalendarMonth('2030-01',true);await turn();
  assert.equal(messages.length,1);assert.equal(resolved,false);
  assert.equal(JSON.parse(w.localStorage.getItem(key)).savedAt,1);
  reply({type:'lexi-spend-result',id:messages[0].id,ok:true,result:{...emptyMonth(),monthTotalUsd:20}});
  await Promise.all([p,q]);assert.equal(a.state.calendar.get('2030-01').monthTotalUsd,20);
  assert(JSON.parse(w.localStorage.getItem(key)).savedAt>1);
});
await check('Calendar rejects a response predating a confirmed mutation and converges',async()=>{
  const h=harness(),{a}=h;const pending=[];h.setHandler(()=>new Promise(resolve=>pending.push(resolve)));
  a.saveCalendarCache('2030-01',emptyMonth());
  const p=a.loadCalendarMonth('2030-01');
  a.applyCalendarExpenseSave({entryId:'fixture1',date:'2030-01-15',usdAmount:2,category:'Category A'});
  const expected=clone(a.state.calendar.get('2030-01'));
  pending.shift()(emptyMonth());await p;await turn();
  assert.equal(a.state.calendar.get('2030-01').monthTotalUsd,2);assert.equal(pending.length,1);
  pending.shift()(expected);await turn();assert.equal(a.state.calendar.get('2030-01').monthTotalUsd,2);
  a.applyCalendarExpenseDelete({entryId:'fixture1',date:'2030-01-15'});
  assert.equal(a.state.calendar.get('2030-01').transactionCount,0);
});
await check('older app-state response cannot overwrite a confirmed mutation',async()=>{
  const h=harness(),{a}=h;const pending=[];h.setHandler(()=>new Promise(resolve=>pending.push(resolve)));
  const p=a.loadAppState();a.beginLedgerWrite();a.state.app.recent=[{entryId:'new'}];a.finishLedgerWrite();
  pending.shift()({...clone(h.f),recent:[{entryId:'old'}]});await p;await turn();
  assert.equal(a.state.app.recent[0].entryId,'new');assert.equal(pending.length,1);
  pending.shift()({...clone(h.f),recent:[{entryId:'new'}]});await turn();assert.equal(a.state.app.recent[0].entryId,'new');
});
await check('cash delete is single-flight; alreadyDeleted reconciles without another delta',async()=>{
  const h=harness(),{a}=h;let resolveDelete,resolveRead;
  h.setHandler(name=>new Promise(resolve=>{if(name==='deleteCashWithdrawal')resolveDelete=resolve;else resolveRead=resolve;}));
  const row={entryId:'fixture1',amount:1000,currency:'THB',date:'2030-01-15'};
  const p=a.deleteCash(row);await a.deleteCash(row);
  assert.equal(h.calls.filter(x=>x[0]==='deleteCashWithdrawal').length,1);
  resolveDelete({deleted:row});await p;assert.equal(a.state.app.cashWallets.THB.balance,1000);
  const q=a.deleteCash(row);resolveDelete({alreadyDeleted:true});await q;
  assert.equal(a.state.app.cashWallets.THB.balance,1000);
  const canonical=clone(h.f);canonical.cashWallets.THB.balance=1000;canonical.cashWallets.THB.withdrawals=1000;
  resolveRead(canonical);await turn();assert.equal(a.state.app.cashWallets.THB.balance,1000);
});
await check('expense save uses its submitted snapshot and preserves edits made during save',async()=>{
  const h=harness(),{a,$}=h;let resolveSave,payload;
  a.saveCalendarCache('2030-01',emptyMonth());
  h.setHandler((name,args)=>{assert.equal(name,'logExpense');payload=args[0];return new Promise(r=>resolveSave=r);});
  $('merchant').value='First';$('expenseAmount').value='10';$('expenseNote').value='Original';
  const p=a.saveExpense({preventDefault(){}});
  $('merchant').value='Next';$('expenseAmount').value='20';$('expenseNote').value='Next note';
  $('expenseDate').value='2030-01-16';$('expenseCurrency').value='USD';$('category').value='Category B';
  resolveSave({entryId:payload.entryId,usdAmount:1,recent:[],summary:clone(h.f.summary)});await p;
  const saved=a.state.calendar.get('2030-01').days['2030-01-15'].transactions[0];
  assert.equal(saved.merchant,'First');assert.equal(saved.currency,'THB');assert.equal(saved.note,'Original');
  assert.equal(a.state.calendar.get('2030-01').days['2030-01-16'],undefined);
  assert.equal($('merchant').value,'Next');assert.equal($('expenseAmount').value,'20');assert.equal($('expenseNote').value,'Next note');
  assert.equal($('expenseCurrency').value,'USD');assert.equal($('category').value,'Category B');
});
await check('background reads preserve all draft fields, selections and payment',async()=>{
  const h=harness(),{$,a}=h;$('merchant').value='Draft';$('expenseAmount').value='3';$('expenseNote').value='Note';
  $('category').value='Category B';$('expenseCurrency').value='USD';$('paymentMethod').value='Cash';
  $('cashAmount').value='99';$('cashNote').value='Cash draft';await a.loadAppState();
  assert.equal($('merchant').value,'Draft');assert.equal($('category').value,'Category B');
  assert.equal($('expenseCurrency').value,'USD');assert.equal($('paymentMethod').value,'Cash');
  assert.equal($('cashAmount').value,'99');assert.equal($('cashNote').value,'Cash draft');
});
await check('cash save preserves newer input and updates withdrawal/fee metrics',async()=>{
  const h=harness(),{a,$}=h;let resolveSave;
  h.setHandler(()=>new Promise(r=>resolveSave=r));$('cashAmount').value='100';$('atmFee').value='5';
  const p=a.saveCash({preventDefault(){}});$('cashAmount').value='200';$('cashNote').value='Next';
  resolveSave({withdrawal:{entryId:'fixture1',amount:100,currency:'THB',date:'2030-01-15',atmFee:5,atmFeeUsd:1}});await p;
  assert.equal($('cashAmount').value,'200');assert.equal($('atmFee').value,'');assert.equal($('cashNote').value,'Next');
  assert.equal(a.state.app.cashWallets.THB.balance,2100);assert.equal(a.state.app.cashWallets.THB.calendarMonthFeesUsd,1);
});
await check('local date rollover advances empty defaults and retains explicit dates/drafts',async()=>{
  const h=harness(),{a,$}=h;a.bind();h.setNow('2030-01-16T12:00:00Z');a.refreshLocalDates();
  assert.equal($('expenseDate').value,'2030-01-16');assert.equal($('cashDate').value,'2030-01-16');
  $('expenseDate').value='2030-01-10';$('expenseDate').dispatchEvent(new h.w.Event('change'));
  $('cashAmount').value='10';h.setNow('2030-01-17T12:00:00Z');a.refreshLocalDates();
  assert.equal($('expenseDate').value,'2030-01-10');assert.equal($('cashDate').value,'2030-01-16');
  $('cashAmount').value='';a.refreshLocalDates();assert.equal($('cashDate').value,'2030-01-17');
});
await check('resume during a write does not reset its bridge; refresh is deferred',async()=>{
  const h=harness(),{a,w}=h;a.bind();a.beginLedgerWrite();
  Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'hidden'});
  w.document.dispatchEvent(new w.Event('visibilitychange'));h.setNow('2030-01-16T12:00:00Z');
  Object.defineProperty(w.document,'visibilityState',{configurable:true,value:'visible'});
  w.document.dispatchEvent(new w.Event('visibilitychange'));await turn();
  assert.equal(h.calls.length,0);assert.equal(a.state.syncQueued,true);
  a.finishLedgerWrite();await turn();assert.equal(h.calls[0][0],'getAppState');
});
await check('failed delete preserves cash and unlocks controls',async()=>{
  const h=harness();h.setHandler(async()=>{throw new Error('Denied');});
  await h.a.deleteCash({entryId:'fixture1',currency:'THB',amount:100});
  assert.equal(h.a.state.app.cashWallets.THB.balance,2000);assert.equal(h.a.state.busy,false);
  assert.equal(h.$('saveCashButton').disabled,false);
});
await check('transient expense retry keeps the same Entry ID and submitted data',async()=>{
  const h=harness();h.$('merchant').value='Fixture';h.$('expenseAmount').value='1';let first;
  h.setHandler(async(name,args)=>{
    if(name==='getCalendarMonth')return emptyMonth();
    if(!first){first=clone(args[0]);throw new Error('network timeout');}
    assert.deepEqual(clone(args[0]),first);return {entryId:first.entryId,usdAmount:1,recent:[],summary:h.f.summary};
  });await h.a.saveExpense({preventDefault(){}});
  assert.match(h.$('expenseStatus').textContent,/Saved on device/);
  await h.a.flushOutbox();assert.equal(Object.keys(h.a.readOutbox()).length,0);
});
await check('durable expense/Cash queues survive restart, failures and duplicate acknowledgements',async()=>{
  for(const kind of ['expense','cash']){
    const h=harness(),method=kind==='expense'?'saveExpense':'saveCash',write=kind==='expense'?'logExpense':'addCashWithdrawal';
    h.$('merchant').value='Example';h.$('expenseAmount').value='10';h.$('cashAmount').value='100';
    Object.defineProperty(h.w.navigator,'onLine',{value:false,configurable:true});
    await h.a[method]({preventDefault(){}});
    assert.equal(h.calls.length,0);assert.equal(h.$(kind==='expense'?'expenseAmount':'cashAmount').value,'');
    let entries=Object.values(h.a.readOutbox());assert.equal(entries.length,1);assert.equal(entries[0].name,write);
    const submitted=clone(entries[0].params),firstId=submitted[0].entryId;
    assert.match(h.$('connectionBadge').textContent,/1 pending/);
    h.$('merchant').value='Example';h.$('expenseAmount').value='10';h.$('cashAmount').value='100';
    await h.a[method]({preventDefault(){}});entries=Object.values(h.a.readOutbox());
    assert.equal(entries.length,2);assert.notEqual(entries[1].params[0].entryId,firstId);
    const r=harness({savedOutbox:h.w.localStorage.getItem('lexiSpendV2OutboxV1')});
    r.setHandler(async(name)=>{if(name===write)throw Error('network timeout');return name==='getAppState'?clone(r.f):emptyMonth();});
    await r.a.flushOutbox();assert.equal(Object.keys(r.a.readOutbox()).length,2);
    const sent=[];r.setHandler(async(name,args)=>{if(name===write){sent.push(clone(args));return {deduped:true};}return name==='getAppState'?clone(r.f):emptyMonth();});
    await r.a.flushOutbox();assert.deepEqual(sent[0],submitted);assert.equal(sent.length,2);assert.equal(Object.keys(r.a.readOutbox()).length,0);
    assert.equal(r.a.state.app.cashWallets.THB.balance,2000);
  }
});
await check('ambiguous save preserves original row/date/Actual USD through a day change',async()=>{
  const h=harness();h.a.state.app.supportsActualUsd=true;
  h.$('merchant').value='Example';h.$('expenseAmount').value='10';h.$('expenseActualUsd').value='1.23';
  h.setHandler(async()=>{throw Error('network timeout');});await h.a.saveExpense({preventDefault(){}});
  const entry=Object.values(h.a.readOutbox())[0];h.setNow('2030-01-16T12:00:00Z');const sent=[];
  h.setHandler(async(name,args)=>{if(name==='logExpense'){sent.push(clone(args[0]));return {deduped:true};}return name==='getAppState'?clone(h.f):emptyMonth();});
  await h.a.flushOutbox();assert.equal(sent[0].entryId,entry.params[0].entryId);assert.equal(sent[0].date,'2030-01-15');assert.equal(sent[0].actualUsd,1.23);
});
await check('offline deletes retry once per ID and preserve balances before acknowledgement',async()=>{
  const h=harness();Object.defineProperty(h.w.navigator,'onLine',{value:false,configurable:true});
  await h.a.deleteExpense({entryId:'e1',merchant:'Example',date:'2030-01-15'});
  await h.a.deleteCash({entryId:'c1',amount:100,currency:'THB',date:'2030-01-15'});
  assert.equal(Object.keys(h.a.readOutbox()).length,2);assert.equal(h.a.state.app.cashWallets.THB.balance,2000);
  Object.defineProperty(h.w.navigator,'onLine',{value:true,configurable:true});const sent=[];
  h.setHandler(async(name,args)=>{if(name.startsWith('delete')){sent.push([name,args[0]]);return {alreadyDeleted:true};}return name==='getAppState'?clone(h.f):emptyMonth();});
  await Promise.all([h.a.flushOutbox(),h.a.flushOutbox()]);assert.deepEqual(sent,[['deleteExpense','e1'],['deleteCashWithdrawal','c1']]);assert.equal(Object.keys(h.a.readOutbox()).length,0);
});
await check('storage failure retains form and never sends an unrecorded row',async()=>{
  const h=harness();h.$('merchant').value='Example';h.$('expenseAmount').value='10';
  h.w.auditStorageFull=true;
  await h.a.saveExpense({preventDefault(){}});assert.equal(h.calls.length,0);assert.equal(h.$('expenseAmount').value,'10');assert.match(h.$('expenseStatus').textContent,/Storage full/);
});
await check('reconnect resets an offline bridge only outside an active ledger write',async()=>{
  const h=harness();h.a.bind();h.a.state.busy=true;
  h.w.dispatchEvent(new h.w.Event('online'));await turn();assert.equal(h.calls.filter(x=>x[0]==='reset').length,0);
  h.a.state.busy=false;h.w.dispatchEvent(new h.w.Event('online'));await turn();assert.equal(h.calls.filter(x=>x[0]==='reset').length,1);
});
await check('deduped withdrawal refreshes canonical balances without applying a second delta',async()=>{
  const h=harness(),{a,$}=h;let read;
  $('cashAmount').value='100';
  h.setHandler(async(name,args)=>{
    if(name==='getAppState')return new Promise(resolve=>read=resolve);
    return {deduped:true,withdrawal:{...args[0],atmFee:5,atmFeeUsd:1}};
  });
  await a.saveCash({preventDefault(){}});
  assert.equal(a.state.app.cashWallets.THB.balance,2000);assert.equal(a.state.app.cashWallets.THB.calendarMonthFeesUsd,0);
  const canonical=clone(h.f);canonical.cashWallets.THB.balance=2100;
  read(canonical);await turn();assert.equal(a.state.app.cashWallets.THB.balance,2100);
});
await check('all USD previews ignore out-of-order success/error, changed inputs, and cleared fields',async()=>{
  for(const [method,input,output] of [['updateConverter','converterAmount','converterUsd'],['updateExpensePreview','expenseAmount','expenseUsdPreview'],['updateCashPreview','cashAmount','cashUsdPreview']]){
    const h=harness(),pending=[];h.setHandler(()=>new Promise((resolve,reject)=>pending.push({resolve,reject})));
    h.$(input).value='10';const first=h.a[method]();h.$(input).value='20';const second=h.a[method]();
    pending[1].resolve({usdAmount:20,rate:1});await second;pending[0].resolve({usdAmount:10,rate:1});await first;
    assert(h.$(output).textContent.includes('$20.00'));
    h.$(input).value='30';const failure=h.a[method]();h.$(input).value='40';const current=h.a[method]();
    pending[3].resolve({usdAmount:40,rate:1});await current;pending[2].reject(new Error('old failure'));await failure;
    assert(h.$(output).textContent.includes('$40.00'));
    h.$(input).value='50';const cleared=h.a[method]();h.$(input).value='';await h.a[method]();
    pending[4].resolve({usdAmount:50,rate:1});await cleared;assert(!h.$(output).textContent.includes('$50.00'));
    h.$(input).value='60';const changedCurrency=h.a[method]();
    h.$(method==='updateCashPreview'?'cashCurrency':'expenseCurrency').value='USD';
    const previous=h.$(output).textContent;pending[5].resolve({usdAmount:60,rate:1});await changedCurrency;
    assert.equal(h.$(output).textContent,previous);
  }
});
await check('Cash preview snapshots date/fee and stale responses cannot repaint during debounce',async()=>{
  const h=harness(),pending=[];h.setHandler(()=>new Promise(resolve=>pending.push(resolve)));
  h.$('cashAmount').value='100';h.$('atmFee').value='5';const first=h.a.updateCashPreview();
  h.$('cashDate').value='2030-01-16';h.$('atmFee').value='10';
  pending.shift()({usdAmount:100,rate:1});await first;assert.equal(h.$('cashUsdPreview').textContent,'');
  h.$('expenseAmount').value='5';const second=h.a.updateExpensePreview();
  h.a.scheduleExpensePreview();pending.shift()({usdAmount:5});await second;
  assert.equal(h.$('expenseUsdPreview').textContent,'');
});
await check('blank expense amount is rejected locally while an explicit zero remains allowed',async()=>{
  const h=harness(),{a,$}=h;$('merchant').value='Example';$('expenseAmount').value='';
  await a.saveExpense({preventDefault(){}});assert.equal(h.calls.length,0);assert.match($('expenseStatus').textContent,/valid amount/);
  a.saveCalendarCache('2030-01',emptyMonth());let sent;
  h.setHandler(async(name,args)=>{sent=args[0];return {entryId:sent.entryId,usdAmount:0,recent:[],summary:h.f.summary};});
  $('expenseAmount').value='0';await a.saveExpense({preventDefault(){}});assert.equal(sent.amount,0);
});
await check('expense currency persists across relaunch and stays independent of Cash Wallet',async()=>{
  const h=harness(),{a,w,$}=h;await a.init();await turn();
  assert.equal($('expenseCurrency').value,'THB');
  $('expenseCurrency').value='KRW';$('expenseCurrency').dispatchEvent(new w.Event('change'));
  assert.equal(w.localStorage.getItem('lexiSpendV2ExpenseCurrency'),'KRW');
  await a.loadAppState();assert.equal($('expenseCurrency').value,'KRW');
  assert.equal($('cashCurrency').value,'THB');
  const reopened=harness({savedCurrency:w.localStorage.getItem('lexiSpendV2ExpenseCurrency')});
  await reopened.a.init();await turn();assert.equal(reopened.$('expenseCurrency').value,'KRW');
  const invalid=harness({savedCurrency:'INVALID'});assert.equal(invalid.$('expenseCurrency').value,'THB');
});
await check('real DOM startup, four tabs, settings, payment and date-label integration',async()=>{
  const h=harness(),{a,w,$}=h;const errors=[];w.addEventListener('error',e=>errors.push(e.message));
  w.eval(source('v2/track.js'));await a.init();await turn();
  for(const view of ['budget','cash','calendar','track']){
    w.document.querySelector(`[data-view="${view}"]`).click();
    assert.equal(a.state.activeView,view);
    assert.equal(w.document.querySelector(`[data-screen="${view}"]`).classList.contains('active'),true);
  }
  $('settingsButton').click();assert.equal($('settingsDialog').open,true);$('closeSettingsButton').click();
  for(const method of ['Cash','Card','Cash']) {
    $(`pay${method}`).click();assert.equal($('paymentMethod').value,method);
    for(const other of ['Cash','Card']) {
      assert.equal($(`pay${other}`).classList.contains('active'),other===method);
      assert.equal($(`pay${other}`).getAttribute('aria-pressed'),String(other===method));
    }
  }
  h.setNow('2030-01-16T12:00:00Z');a.refreshLocalDates();assert.match($('dateMain').textContent,/16/);
  assert.deepEqual(errors,[]);
});
await check('compact dark-mode dropdowns preserve category, independent currencies and submitted ledger payloads',async()=>{
  const h=harness(),{a,w,$}=h;const errors=[];w.addEventListener('error',e=>errors.push(e.message));
  a.bind();w.eval(source('v2/track.js'));await turn();
  const button=id=>$(id).nextElementSibling;
  const choose=(id,value)=>{
    w.document.querySelector(`[data-view="${id==='cashCurrency'?'cash':'track'}"]`).click();
    button(id).click();const option=[...w.document.querySelectorAll('.spend-select-option')].find(el=>el.textContent===value);assert(option,`${id}: ${value}`);option.click();
    assert.equal($(id).value,value);assert.equal(button(id).textContent,value);assert.equal(w.document.querySelector('[role="listbox"]'),null);
  };
  assert.equal(w.document.querySelectorAll('.spend-select-button').length,3);
  choose('category','Category B');choose('expenseCurrency','KRW');assert.equal($('converterSymbol').textContent,'₩');
  assert.equal(w.localStorage.getItem('lexiSpendV2ExpenseCurrency'),'KRW');assert.equal(button('expenseCurrency').getAttribute('aria-required'),'true');
  choose('cashCurrency','USD');assert.equal($('expenseCurrency').value,'KRW');assert.equal(a.state.cashCurrency,'USD');
  assert.equal(button('cashCurrency').getAttribute('aria-label'),'Currency: USD');
  button('cashCurrency').click();button('cashCurrency').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Home',bubbles:true}));button('cashCurrency').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));assert.equal($('cashCurrency').value,'THB');
  choose('cashCurrency','USD');choose('category','Category B');
  button('category').click();button('category').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(w.document.querySelector('[role="listbox"]'),null);
  button('category').click();$('merchant').dispatchEvent(new w.PointerEvent('pointerdown',{bubbles:true}));assert.equal(w.document.querySelector('[role="listbox"]'),null);
  $('merchant').value='Example market';$('expenseAmount').value='10';$('expenseNote').value='Existing draft';
  button('category').click();a.renderApp();await turn();assert.equal(w.document.querySelector('[role="listbox"]'),null);
  assert.equal(button('category').textContent,'Category B');assert.equal(button('expenseCurrency').textContent,'KRW');assert.equal(button('cashCurrency').textContent,'USD');assert.equal($('expenseNote').value,'Existing draft');
  assert.equal(new w.FormData($('expenseForm')).get('category'),'Category B');assert.equal(new w.FormData($('expenseForm')).get('currency'),'KRW');
  a.saveCalendarCache('2030-01',emptyMonth());let expense,cash;
  h.setHandler(async(name,args)=>{
    if(name==='logExpense'){expense=args[0];return {entryId:expense.entryId,usdAmount:1,recent:[],summary:h.f.summary};}
    if(name==='addCashWithdrawal'){cash=args[0];return {deduped:true};}
    if(name==='getAppState')return clone(h.f);
    return {};
  });
  await a.saveExpense({preventDefault(){}});await turn();assert.equal(expense.category,'Category B');assert.equal(expense.currency,'KRW');assert.equal(expense.note,'Existing draft');assert.equal(expense.paymentMethod,'Card');
  choose('cashCurrency','USD');$('cashAmount').value='100';await a.saveCash({preventDefault(){}});await turn();assert.equal(cash.currency,'USD');assert.equal(cash.amount,100);
  assert.equal($('expenseCurrency').value,'KRW');assert.equal(button('expenseCurrency').textContent,'KRW');assert.equal($('paymentMethod').value,'Card');assert.deepEqual(errors,[]);
  assert.match(source('v2/track.css'),/background: var\(--surface\)/);assert.doesNotMatch(source('v2/track.css'),/var\(--blue/);
});
await check('option taps survive trigger blur before click for every Spend dropdown',async()=>{
  const h=harness(),{a,w,$}=h;a.bind();w.eval(source('v2/track.js'));await turn();
  for(const [id,value] of [['category','Category B'],['expenseCurrency','KRW'],['cashCurrency','USD']]){
    w.document.querySelector(`[data-view="${id==='cashCurrency'?'cash':'track'}"]`).click();
    const trigger=$(id).nextElementSibling;trigger.click();
    const option=[...w.document.querySelectorAll('.spend-select-option')].find(el=>el.textContent===value);assert(option);
    option.dispatchEvent(new w.PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerType:'touch'}));
    trigger.blur();
    option.dispatchEvent(new w.PointerEvent('pointerup',{bubbles:true,pointerType:'touch'}));option.click();
    assert.equal($(id).value,value,`${id}: tapped value must survive focus loss before click`);
    assert.equal(trigger.textContent,value);assert.equal(w.document.querySelector('[role="listbox"]'),null);
  }
  assert.equal(w.localStorage.getItem('lexiSpendV2ExpenseCurrency'),'KRW');assert.equal(a.state.cashCurrency,'USD');
});
await check('JPY is absent from both currency menus and legacy preferences safely fall back without deleting history',async()=>{
  const h=harness({savedCurrency:'JPY',savedCashCurrency:'JPY'}),{a,$}=h;await a.init();await turn();
  for(const id of ['expenseCurrency','cashCurrency']){
    assert.deepEqual([...$(id).options].map(o=>o.value),['THB','KRW','VND','MXN','USD']);assert.equal($(id).value,'THB');
  }
  a.state.app.cashWallets.JPY={currency:'JPY',balance:1000,calendarMonthFeesUsd:2};a.state.cashCurrency='JPY';a.renderApp();
  assert.equal(a.state.cashCurrency,'THB');assert.equal($('cashCurrency').value,'THB');assert.equal(a.state.app.cashWallets.JPY.balance,1000);
});
await check('service worker keeps sibling caches and uses only its current offline shell',async()=>{
  const handlers={},deleted=[],matches=[],installed=[];let fetches=0;const own={match:async key=>{matches.push(key);return {own:true};},addAll:async requests=>installed.push(...requests)};
  const context={URL,Request,fetch:()=>{fetches++;return new Promise(()=>{});},caches:{keys:async()=>['lexi-spend2-shell-v31','lexi-spend2-shell-v32','lexi-spend2-shell-v33','lexi-spend2-shell-v34','lexi-spend2-shell-v35','lexi-spend2-shell-v36','lexi-spend2-shell-v37','lexi-spend2-shell-v38','lexi-spend2-shell-v39','lexi-spend-v2-old','sibling-shell'],delete:async k=>deleted.push(k),open:async()=>own,match(){throw new Error('origin-wide lookup');}},
    self:{location:{origin:'https://example.test',href:'https://example.test/lexi-spend/v2/sw.js'},addEventListener:(t,f)=>handlers[t]=f,skipWaiting(){},clients:{claim:async()=>{}}}};
  vm.runInNewContext(source('v2/sw.js'),context);let work;
  handlers.install({waitUntil:p=>work=p});await work;assert(installed.length>5);assert(installed.every(request=>request.cache==='reload'));
  handlers.activate({waitUntil:p=>work=p});await work;
  assert.deepEqual(deleted.sort(),['lexi-spend-v2-old','lexi-spend2-shell-v31','lexi-spend2-shell-v32','lexi-spend2-shell-v33','lexi-spend2-shell-v34','lexi-spend2-shell-v35','lexi-spend2-shell-v36','lexi-spend2-shell-v37','lexi-spend2-shell-v38','lexi-spend2-shell-v39']);
  const request={url:'https://example.test/lexi-spend/v2/app.js',method:'GET'};
  handlers.fetch({request,respondWith:p=>work=p});assert.equal((await work).own,true);assert.equal(matches.length,1);assert.equal(fetches,0,'cached launch cannot wait for a hanging online request');
  let handled=false;handlers.fetch({request:{url:'https://example.test/sibling/app.js',method:'GET'},respondWith(){handled=true;}});
  assert.equal(handled,false);
});
await check('Actual USD overrides preview and is submitted, including explicit zero',async()=>{
  for (const value of ['11.11','0']) {
    const h=harness(),{a,$}=h;a.state.app.supportsActualUsd=true;
    $('merchant').value='Posted charge';$('expenseAmount').value='100';$('expenseActualUsd').value=value;
    await a.updateExpensePreview();assert.equal(h.calls.length,0);
    assert.equal($('expenseUsdPreview').textContent,`Actual $${Number(value).toFixed(2)}`);
    let payload;h.setHandler((name,args)=>{if(name!=='logExpense') return emptyMonth();payload=args[0];return {usdAmount:Number(value),recent:[],summary:h.f.summary};});
    await a.saveExpense({preventDefault(){}});assert.equal(payload.actualUsd,Number(value));
    assert.equal($('expenseActualUsd').value,'');
  }
});
await check('blank Actual USD preserves old backend saves; overrides cannot be silently ignored',async()=>{
  const h=harness(),{a,$}=h;$('merchant').value='Shop';$('expenseAmount').value='100';
  let payload;h.setHandler((name,args)=>{if(name!=='logExpense') return emptyMonth();payload=args[0];return {usdAmount:3,recent:[],summary:h.f.summary};});
  await a.saveExpense({preventDefault(){}});assert(!('actualUsd' in payload));
  $('merchant').value='Shop';$('expenseAmount').value='100';$('expenseActualUsd').value='2.50';
  const before=h.calls.length;await a.saveExpense({preventDefault(){}});
  assert.equal(h.calls.length,before);assert.match($('expenseStatus').textContent,/backend update/);
});
await check('FX preview cannot overwrite a newer Actual USD draft',async()=>{
  const h=harness(),{a,$}=h;let reply;$('expenseAmount').value='100';
  h.setHandler(()=>new Promise(resolve=>reply=resolve));const pending=a.updateExpensePreview();
  $('expenseActualUsd').value='2.50';await a.updateExpensePreview();reply({usdAmount:3});await pending;
  assert.equal($('expenseUsdPreview').textContent,'Actual $2.50');
});
await check('Actual USD draft survives background reads and edits during save',async()=>{
  const h=harness(),{a,$}=h;a.state.app.supportsActualUsd=true;
  $('merchant').value='Shop';$('expenseAmount').value='100';$('expenseActualUsd').value='2.50';
  let resolveSave;h.setHandler(()=>new Promise(resolve=>resolveSave=resolve));
  const pending=a.saveExpense({preventDefault(){}});$('expenseActualUsd').value='2.60';
  resolveSave({usdAmount:2.5,recent:[],summary:h.f.summary});await pending;
  assert.equal($('expenseActualUsd').value,'2.60');
});
console.log(`${passed} regression groups passed. DOM/API responses are simulated; no live ledger writes.`);
} finally {for(const w of windows)await w.happyDOM.close();}
