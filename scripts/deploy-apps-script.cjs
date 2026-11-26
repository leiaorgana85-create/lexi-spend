'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path'), crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const sources={Code:'apps-script-code.gs',V2Api:'apps-script-v2-api.gs',AuthTransfer:'apps-script-auth-transfer.gs',Bridge:'apps-script-bridge.html',appsscript:'appsscript.json'};
const names=Object.keys(sources);
function canon(k,s){if(k==='appsscript'){const sort=x=>Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;return JSON.stringify(sort(JSON.parse(s)));}return s.replace(/\r\n/g,'\n').replace(/\n$/,'');}
function same(a,b){return names.every(k=>typeof a[k]==='string'&&typeof b[k]==='string'&&canon(k,a[k])===canon(k,b[k]));}
function run(cmd,args,cwd){const p=spawnSync(cmd,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']});if(p.error||p.status!==0)throw Error('Command failed: '+cmd+' '+args[0]);return p.stdout;}
function read(dir){const files={},paths={};for(const e of fs.readdirSync(dir,{withFileTypes:true}).filter(e=>!e.name.startsWith('.'))){const m=e.name.match(/^(Code|V2Api|AuthTransfer)\.(?:gs|js)$|^(Bridge)\.html$|^(appsscript)\.json$/),k=m&&(m[1]||m[2]||m[3]);if(!e.isFile()||!k||Object.hasOwn(files,k))throw Error('Unknown or duplicate remote project file');files[k]=fs.readFileSync(path.join(dir,e.name),'utf8');paths[k]=e.name;}if(!names.every(k=>Object.hasOwn(files,k)))throw Error('Missing remote project file');return {files,paths};}
function deployment(output,id){const lines=output.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.startsWith('- '+id+' @')||x.startsWith(id+' @'));if(lines.length!==1)throw Error('Existing deployment not uniquely identified');const m=lines[0].match(/@(\d+)(?:\s|$)/);if(!m||Number(m[1])<1)throw Error('No numeric deployment version');return {version:Number(m[1]),line:lines[0]};}

// Only read operations are retried. A deployment update is never repeated
// just because a later read is stale or temporarily unavailable.
const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function verifyReadback(readMeta,readVersion,candidate,accept,wait=sleep,attempts=6){
  let stage='Deployment metadata readback';
  for(let i=0;i<attempts;i++){
    try {
      stage='Deployment metadata readback';
      const d=readMeta();
      if(accept(d)){
        stage='Selected-version parity';
        if(same(readVersion(d.version),candidate))return d;
      }
    }catch(_){ /* Keep provider output and identifiers out of public logs. */ }
    if(i+1<attempts)wait(Math.min(2000*2**i,15000));
  }
  throw Error(stage+' failed after '+attempts+' read-only attempts; inspect existing deployment before any retry of writes');
}
function testReadback(){
  const a=Object.fromEntries(names.map(k=>[k,k==='appsscript'?'{}':'new']));
  const old={...a,Code:'old'};
  let i=0, pulls=0, waits=[];
  const got=verifyReadback(()=>{i++;if(i===1)throw Error('temporary API error');return i===2?{version:4,line:'old'}:{version:5,line:'release'};},
    ()=>{pulls++;return pulls===1?old:a;},a,d=>d.version>4&&d.line==='release',ms=>waits.push(ms));
  assert.equal(got.version,5);assert.equal(i,4);assert.equal(pulls,2);assert.deepEqual(waits,[2000,4000,8000]);
  assert.throws(()=>verifyReadback(()=>({version:5,line:'wrong release'}),()=>a,a,d=>d.line==='release',()=>{},3),/metadata readback failed after 3/);
  assert.throws(()=>verifyReadback(()=>({version:5,line:'release'}),()=>old,a,d=>d.line==='release',()=>{},3),/Selected-version parity failed after 3/);
  assert.equal(verifyReadback(()=>({version:5,line:'release'}),()=>a,a,d=>d.version===5,()=>assert.fail('No wait for verified no-op')).version,5);
  console.log('PASS bounded read-only deployment verification: stale metadata, API failure, stale source, mismatch rejection and no-op verification');
}

function gate(e){if(e.DEPLOY_ENABLED!=='true')return false;if(!e.CLASPRC_JSON||!e.SCRIPT_ID||!e.DEPLOYMENT_ID)throw Error('Missing required deployment secret');if(!/^[A-Za-z0-9_-]+$/.test(e.SCRIPT_ID)||!/^AKfy[A-Za-z0-9_-]+$/.test(e.DEPLOYMENT_ID))throw Error('Invalid project configuration');JSON.parse(e.CLASPRC_JSON);return true;}
function selfTest(){const blank={};assert.equal(gate(blank),false);assert.throws(()=>gate({DEPLOY_ENABLED:'true'}));assert.throws(()=>gate({DEPLOY_ENABLED:'true',CLASPRC_JSON:'{}',SCRIPT_ID:'bad id',DEPLOYMENT_ID:'AKfyabc'}));assert.equal(gate({DEPLOY_ENABLED:'true',CLASPRC_JSON:'{}',SCRIPT_ID:'abc',DEPLOYMENT_ID:'AKfyabc'}),true);assert.equal(deployment('- AKfyabc @3 - release','AKfyabc').version,3);assert.throws(()=>deployment('- AKfyother @3','AKfyabc'));const a=Object.fromEntries(names.map(k=>[k,k==='appsscript'?'{"x":1,"y":2}':'source\n']));assert(same(a,{...a,appsscript:'{"y":2,"x":1}',Code:'source\r\n'}));assert(!same(a,{...a,Code:'changed'}));assert(!same(a,{...a,Bridge:undefined}));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'clasp-test-'));try{for(const k of names)fs.writeFileSync(path.join(dir,k+(k==='appsscript'?'.json':k==='Bridge'?'.html':'.js')),a[k]);assert(same(a,read(dir).files));fs.writeFileSync(path.join(dir,'Unknown.js'),'');assert.throws(()=>read(dir));}finally{fs.rmSync(dir,{recursive:true,force:true});}console.log('PASS: disabled/missing-secret gates, deployment identity, source parity, unknown-file refusal');}
function main(){if(process.argv.includes('--self-test')){selfTest();testReadback();return;}if(!gate(process.env)){console.log('Production disabled; no credential or Google operation');return;}const {SCRIPT_ID,DEPLOYMENT_ID,CLASPRC_JSON,GITHUB_SHA}=process.env;const root=process.cwd();if(!/^[a-f0-9]{40}$/.test(GITHUB_SHA||''))throw Error('Missing exact CI commit');const git=(...args)=>run('git',args,root).trim();const checkMain=()=>{if(git('rev-parse','HEAD')!==GITHUB_SHA||git('ls-remote','origin','refs/heads/main').split(/\s+/)[0]!==GITHUB_SHA)throw Error('Commit is not current main');};checkMain();
const candidate=Object.fromEntries(names.map(k=>[k,fs.readFileSync(path.join(root,sources[k]),'utf8')]));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spend-clasp-'));const cred=path.join(os.homedir(),'.clasprc.json');if(fs.existsSync(cred))throw Error('Unexpected pre-existing credential file');try{fs.writeFileSync(cred,CLASPRC_JSON,{mode:0o600,flag:'wx'});const project=label=>{const d=path.join(dir,label);fs.mkdirSync(d);fs.writeFileSync(path.join(d,'.clasp.json'),JSON.stringify({scriptId:SCRIPT_ID}));return d;};const clasp=(d,...args)=>run('clasp',args,d);const live=project('live'),old=project('old');const before=deployment(clasp(live,'list-deployments'),DEPLOYMENT_ID);clasp(live,'pull');clasp(old,'pull','--versionNumber',String(before.version));const current=read(live),published=read(old);if(!same(current.files,published.files))throw Error('Editor differs from deployed version; refusing push');
let readSerial=0;const readSelected=version=>{const selected=project('selected-'+(++readSerial));clasp(selected,'pull','--versionNumber',String(version));return read(selected).files;};const readMeta=()=>deployment(clasp(live,'list-deployments'),DEPLOYMENT_ID);
if(same(current.files,candidate)){const stable=verifyReadback(readMeta,readSelected,candidate,d=>d.version===before.version);console.log('Verified existing deployment version '+stable.version+' matches current backend; no changes');return;}
const prior=before.line.match(/lexi-spend ([a-f0-9]{40})/);if(prior){const baseline=Object.fromEntries(names.map(k=>[k,run('git',['show',prior[1]+':'+sources[k]],root)]));if(!same(current.files,baseline))throw Error('Live source does not match prior repository release');}else{if(before.version!==3)throw Error('Initial deployment must be Version 3');const hashes={Code:'b427b4bcb1598cec8fe0e0d35711853bb65fde63b5d6308aeb17f61c950a9757',V2Api:'eb155dbe5a67228937ffb5a9f44bed61de9960880f52ef532a5698c5d4bc0906'};for(const [k,h] of Object.entries(hashes)){const s=canon(k,current.files[k]);if(![s,s+'\n'].some(v=>crypto.createHash('sha256').update(v).digest('hex')===h))throw Error('Initial Version 3 source mismatch');}for(const k of ['AuthTransfer','Bridge','appsscript'])if(canon(k,current.files[k])!==canon(k,candidate[k]))throw Error('Initial unchanged file mismatch; reconcile before deployment');}
checkMain();const staging=project('staging');for(const k of names)fs.writeFileSync(path.join(staging,current.paths[k]),candidate[k]);clasp(staging,'push','--force');const verify=project('verify');clasp(verify,'pull');if(!same(read(verify).files,candidate))throw Error('Push parity failed; existing deployment not updated');checkMain();if(deployment(clasp(verify,'list-deployments'),DEPLOYMENT_ID).version!==before.version)throw Error('Deployment changed during operation');const description='lexi-spend '+GITHUB_SHA;clasp(verify,'update-deployment',DEPLOYMENT_ID,'--description',description);const after=verifyReadback(readMeta,readSelected,candidate,d=>d.version>before.version&&d.line.includes(description));console.log('Verified existing deployment updated to version '+after.version+'; commit '+GITHUB_SHA);
}finally{fs.rmSync(cred,{force:true});fs.rmSync(dir,{recursive:true,force:true});}}
try{main();}catch(e){console.error('Deployment stopped: '+(e instanceof SyntaxError?'Invalid configuration':e.message));process.exitCode=1;}
