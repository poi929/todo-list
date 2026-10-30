const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const {test} = require('node:test');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1].replace(/\n    initUi\(\);/,'');
const MAIN='todo-calendar-board-v96', SETTINGS='todo-calendar-board-github-sync';
const BACKUP='todo-calendar-board-pre-github-restore', REPO='poi929/todoboard-data';
const AUTO='todo-calendar-board-github-auto-sync';
// Deliberately not a GitHub token. All API calls below are in-memory fakes.
const DEMO='test-only-credential';
const sha='a'.repeat(40), nextSha='b'.repeat(40);
const reply=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const file=(text,hash=sha)=>({type:'file',path:'data.json',encoding:'base64',sha:hash,
  size:Buffer.byteLength(text),content:Buffer.from(text).toString('base64')});

function harness(options={}) {
  const values=options.values || new Map();
  const nodes=new Map(), timers=new Map(), requests=[], confirmations=[], downloads=[], backups=[], events=new Map();
  let timerId=0,reloads=0,now=Date.parse('2026-10-30T12:00:00+09:00');
  const addEvent=(prefix,name,fn)=>{const key=prefix+name;if(!events.has(key))events.set(key,[]);events.get(key).push(fn);};
  const locks=options.locks||{held:false,async request(name,config,callback){if(this.held)return callback(null);this.held=true;try{return await callback({name});}finally{this.held=false;}}};
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{value:'',checked:false,hidden:false,disabled:false,
      textContent:'',style:{},attributes:{},listeners:new Map(),classList:{toggle(){}},
      setAttribute(name,value){this.attributes[name]=value;},
      addEventListener(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}});
    return nodes.get(selector);
  };
  const localStorage={getItem:key=>values.get(key)??null,
    setItem(key,value){if(options.failWrite?.(key,value))throw new Error('storage failed');values.set(key,String(value));},
    removeItem:key=>values.delete(key),key:index=>[...values.keys()][index]??null,get length(){return values.size;}};
  const server=options.server||{file:null};
  async function route(url,init) {
    const parsed=new URL(url);
    assert.equal(parsed.origin,'https://api.github.com');
    if(parsed.pathname===`/repos/${REPO}`)return reply(server.repoStatus||200,server.repo||{private:true,full_name:REPO,default_branch:'main'});
    assert.equal(parsed.pathname,`/repos/${REPO}/contents/data.json`);
    if(init.method==='GET')return server.file ? reply(200,server.file) : reply(404,{message:'Not Found'});
    assert.equal(init.method,'PUT');
    if(server.putStatus)return reply(server.putStatus,{message:DEMO});
    const body=JSON.parse(init.body);
    assert.equal(body.branch,'main');assert.equal(body.message,'TodoBoard data sync');
    if(server.file)assert.equal(body.sha,server.file.sha);else assert.equal('sha' in body,false);
    server.revision=(server.revision||0)+1;
    const revision=server.revision===1?nextSha:server.revision.toString(16).padStart(40,'0');
    server.file=file(Buffer.from(body.content,'base64').toString('utf8'),revision);
    return reply(201,{content:{sha:revision}});
  }
  const context=vm.createContext({console,structuredClone,URL,TextEncoder,TextDecoder,AbortController,btoa,atob,crypto:webcrypto,
    Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms,at:now+ms});return id;},clearTimeout:id=>timers.delete(id),
    localStorage,document:{visibilityState:'visible',addEventListener:(name,fn)=>addEvent('document:',name,fn),getElementById:()=>null,querySelector:node},
    window:{innerWidth:390,innerHeight:844,addEventListener:(name,fn)=>addEvent('window:',name,fn)},navigator:{onLine:true,...(options.noLocks?{}:{locks})},
    location:{reload:()=>{reloads++;options.onReload?.(context);}},
    fetch:async(url,init)=>{requests.push({url,init});return options.fetch ? options.fetch(url,init,route) : route(url,init);}});
  vm.runInContext(script,context);
  vm.runInContext(`globalThis.api={initGitHubSync,saveToGitHub,restoreFromGitHub,exportGitHubRestoreBackup,
    githubSyncEncode,githubSyncDecodeFile,exportableState,saveState,flushSave,scheduleSave,removeOldStorageKeys,
    collectUnusedImages,afterStateReplaced,getState:()=>state,setTodos:todos=>{state.todos=todos;dataVersion+=1;},
    setBlocked:value=>saveBlocked=value,setImage:(id,src)=>{imageCache.set(id,src);imageStoreAvailable=true;},
    flags:()=>({saveBlocked,savePending}),getStorageKey:()=>STORAGE_KEY,
    auto:{start:startGitHubAutoSync,enable:enableGitHubAutoSync,run:githubAutoRun,flush:githubAutoFlush,retry:githubAutoRetry,inspect:inspectGitHubAutoRemote,
      record:()=>githubAuto,comparable:githubAutoComparable,local:githubAutoLocalCanonical,busy:()=>githubSyncBusy,
      external:()=>githubAutoExternal}};`,context);
  context.renderSystemBanner=()=>{};
  context.loadImageCache=async()=>{};
  context.backupRawToIdb=async(raw,reason)=>{backups.push({raw,reason});if(options.noIdb)throw new Error('unavailable');};
  context.confirmDialog=async config=>{confirmations.push(config);return typeof options.confirm==='function' ? options.confirm(config,context) : options.confirm===undefined?true:options.confirm;};
  context.downloadText=(text,name)=>downloads.push({text,name});
  const api=context.api;
  if(!values.has(MAIN)&&!options.skipInitialSave)assert.equal(api.saveState({silent:true}),true);
  api.initGitHubSync();
  node('#githubSyncToken').value=DEMO;
  const fire=(selector,name)=>{for(const fn of node(selector).listeners.get(name)||[])fn({target:node(selector)});};
  const emit=async(name,event={})=>{for(const fn of events.get(name)||[])await fn(event);};
  const tick=async(ms)=>{now+=ms;for(let i=0;i<100;i++){const next=[...timers.entries()].filter(([,timer])=>timer.at<=now).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)return;timers.delete(next[0]);await next[1].fn();}throw new Error('timer loop');};
  return {api,context,node,values,localStorage,requests,confirmations,downloads,backups,server,timers,fire,emit,tick,
    status:()=>node('#githubSyncStatus').textContent,get reloads(){return reloads;}};
}

test('opening the feature and editing settings never trigger automatic network requests',()=>{
  const h=harness();assert.equal(h.requests.length,0);
  h.fire('#githubSyncToken','change');h.fire('#githubSyncRepo','change');
  assert.equal(h.requests.length,0);assert.equal(h.api.getStorageKey(),MAIN);
});

test('create saves export-compatible UTF-8 JSON including images and excludes credentials',async()=>{
  const h=harness();h.api.setTodos([{id:'ja',kind:'todo',title:'予定と😀',date:'2026-10-30',imageId:'picture'}]);
  h.api.setImage('picture','data:image/png;base64,YWJj');
  assert.equal(await h.api.saveToGitHub(),true);
  const payload=JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8'));
  assert.deepEqual(Object.keys(payload),['app','storageKey','exportedAt','state']);
  assert.match(payload.app,/^Todo Calendar Board v/);assert.equal(payload.storageKey,MAIN);
  assert.equal(payload.state.todos[0].title,'予定と😀');assert.equal(payload.state.todos[0].imageData,'data:image/png;base64,YWJj');
  assert.equal(JSON.stringify(payload).includes(DEMO),false);
  assert.equal(h.values.get(SETTINGS).includes(DEMO),false);assert.equal(h.confirmations.length,0);
  assert.match(h.status(),/保存しました/);
  for(const request of h.requests){assert.equal(request.url.includes(DEMO),false);assert.equal(request.init.headers.Authorization,'Bearer '+DEMO);
    assert.equal(request.init.cache,'no-store');assert.equal(request.init.redirect,'error');assert.equal(request.init.credentials,'omit');}
});

test('known SHA updates without another overwrite question',async()=>{
  const h=harness();assert.equal(await h.api.saveToGitHub(),true);assert.equal(await h.api.saveToGitHub(),true);
  assert.equal(h.confirmations.length,0);assert.equal(h.requests.filter(r=>r.init.method==='PUT').length,2);
});

test('unseen remote version requires confirmation; cancellation never performs a PUT',async()=>{
  const h=harness({confirm:null});const raw=h.values.get(MAIN);
  h.server.file=file(JSON.stringify({exportedAt:'2026-10-29T00:00:00Z',state:{}}));
  assert.equal(await h.api.saveToGitHub(),false);assert.equal(h.confirmations.length,1);
  assert.equal(h.requests.some(r=>r.init.method==='PUT'),false);assert.equal(h.values.get(MAIN),raw);
  assert.match(h.status(),/取り消しました/);
});

test('confirmed update includes the fetched SHA and never retries a concurrent conflict',async()=>{
  const h=harness();h.server.file=file('{}');h.server.putStatus=409;
  assert.equal(await h.api.saveToGitHub(),false);assert.equal(h.confirmations.length,1);
  assert.equal(h.requests.filter(r=>r.init.method==='PUT').length,1);assert.match(h.status(),/HTTP 409/);
  assert.equal(h.status().includes(DEMO),false);
});

test('public or mismatched repository metadata aborts before reading or uploading user data',async()=>{
  for(const repo of [{private:false,full_name:REPO,default_branch:'main'},
    {private:true,full_name:'other/repo',default_branch:'main'}]) {
    const h=harness({server:{repo}});assert.equal(await h.api.saveToGitHub(),false);
    assert.equal(h.requests.length,1);assert.match(h.status(),/非公開/);
  }
});

test('invalid destination paths and missing credentials make no request',async()=>{
  for(const destination of ['https://github.com/poi929/todoboard-data','poi929/../x','poi929/..','a/b?c']) {
    const h=harness();h.node('#githubSyncRepo').value=destination;
    assert.equal(await h.api.saveToGitHub(),false);assert.equal(h.requests.length,0);
  }
  const h=harness();h.node('#githubSyncToken').value='';
  assert.equal(await h.api.saveToGitHub(),false);assert.equal(h.requests.length,0);
});

test('authentication, permission and network errors are visible and never include server text or secrets',async()=>{
  for(const status of [401,403,404,429,500]) {
    const h=harness({server:{repoStatus:status}});assert.equal(await h.api.saveToGitHub(),false);
    assert.match(h.status(),new RegExp('HTTP '+status));assert.equal(h.status().includes(DEMO),false);
    assert.equal(h.node('#githubSyncSave').disabled,false);
  }
  const h=harness({fetch:async()=>{throw new Error(DEMO);}});
  assert.equal(await h.api.saveToGitHub(),false);assert.match(h.status(),/取得できません/);
  assert.equal(h.status().includes(DEMO),false);
});

test('uncertain PUT failure reports an unknown result instead of retrying or claiming no remote change',async()=>{
  const h=harness({fetch:async(url,init,route)=>{
    const result=await route(url,init);if(init.method==='PUT')throw new Error(DEMO);return result;
  }});
  assert.equal(await h.api.saveToGitHub(),false);assert.ok(h.server.file);
  assert.match(h.status(),/保存結果を確認できません/);assert.equal(h.requests.filter(r=>r.init.method==='PUT').length,1);
});

test('950KB limit measures UTF-8 bytes and blocks a large upload',async()=>{
  const h=harness();assert.ok(h.api.githubSyncEncode('あ'.repeat(316666)));
  assert.throws(()=>h.api.githubSyncEncode('あ'.repeat(316667)),/950KB/);
  h.api.setTodos([{id:'large',kind:'todo',title:'あ'.repeat(330000),date:'2026-10-30'}]);
  assert.equal(await h.api.saveToGitHub(),false);assert.match(h.status(),/950KB/);
  assert.equal(h.requests.some(r=>r.init.method==='PUT'),false);
});

test('cancelling the missing-image warning stops the upload and preserves local references',async()=>{
  const h=harness({confirm:null});h.api.setTodos([{id:'missing',kind:'todo',title:'task',date:'2026-10-30',imageId:'missing'}]);
  assert.equal(await h.api.saveToGitHub(),false);assert.match(h.status(),/取り消しました/);
  assert.equal(h.requests.some(r=>r.init.method==='PUT'),false);
  assert.equal(h.confirmations.length,1);assert.match(h.confirmations[0].message,/task/);
  assert.match(h.confirmations[0].message,/復元しても表示できません/);
  assert.equal(h.api.getState().todos[0].imageId,'missing');
  assert.equal(JSON.parse(h.values.get(MAIN)).todos[0].imageId,'missing');
});

test('confirmed save omits only unreadable images, preserving all items and readable images locally and remotely',async()=>{
  const h=harness();h.api.setTodos([
    {id:'missing',kind:'todo',title:'課題',date:'2026-10-30',done:true,failed:true,imageId:'missing'},
    {id:'cached',kind:'event',title:'予定',date:'2026-10-30',imageId:'available'},
    {id:'inline',kind:'todo',title:'別の課題',date:'2026-10-30',imageId:'old-id',imageData:'data:image/png;base64,YWJj'}
  ]);
  h.api.setImage('available','data:image/png;base64,ZGVm');
  const before=JSON.stringify(h.api.getState().todos);
  assert.equal(await h.api.saveToGitHub(),true);
  const payload=JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8'));
  assert.deepEqual(Object.keys(payload),['app','storageKey','exportedAt','state']);
  assert.equal(payload.state.todos.length,3);assert.equal(payload.state.todos[0].title,'課題');
  assert.equal(payload.state.todos[0].done,true);assert.equal(payload.state.todos[0].failed,true);
  assert.equal('imageId' in payload.state.todos[0],false);assert.equal(payload.state.todos[0].imageData,'');
  assert.equal(payload.state.todos[1].imageData,'data:image/png;base64,ZGVm');
  assert.equal(payload.state.todos[2].imageData,'data:image/png;base64,YWJj');
  assert.equal(JSON.stringify(h.api.getState().todos),before);
  assert.equal(JSON.stringify(JSON.parse(h.values.get(MAIN)).todos),before);
  assert.equal(h.confirmations.length,1);assert.match(h.status(),/参考画像1件は含めず/);
});

test('the missing-image warning bounds the displayed list and states the full count',async()=>{
  const h=harness({confirm:null});h.api.setTodos(Array.from({length:8},(_,i)=>({id:String(i),title:'task-'+i+'x'.repeat(100),imageId:'missing-'+i})));
  assert.equal(await h.api.saveToGitHub(),false);
  assert.match(h.confirmations[0].message,/8件/);assert.match(h.confirmations[0].message,/ほか3件/);
  assert.equal(h.confirmations[0].message.includes('task-5'),false);
});

test('an edit during the image confirmation does not change the snapshot that was reviewed',async()=>{
  const h=harness({confirm:async(config,context)=>{context.api.getState().todos[0].title='edited later';return true;}});
  h.api.setTodos([{id:'missing',kind:'todo',title:'reviewed title',date:'2026-10-30',imageId:'missing'}]);
  assert.equal(await h.api.saveToGitHub(),true);
  const payload=JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8'));
  assert.equal(payload.state.todos[0].title,'reviewed title');assert.equal(h.api.getState().todos[0].title,'edited later');
});

test('local storage becoming blocked during confirmation prevents a PUT',async()=>{
  const h=harness({confirm:async(config,context)=>{context.api.setBlocked(true);return true;}});
  h.api.setTodos([{id:'missing',kind:'todo',title:'task',date:'2026-10-30',imageId:'missing'}]);
  assert.equal(await h.api.saveToGitHub(),false);assert.match(h.status(),/端末内の保存/);
  assert.equal(h.requests.some(r=>r.init.method==='PUT'),false);
});

test('a local history failure still reports that unreadable images were omitted from the saved file',async()=>{
  let h;h=harness({failWrite:key=>key===SETTINGS&&Boolean(h?.server.file)});
  h.api.setTodos([{id:'missing',kind:'todo',title:'task',date:'2026-10-30',imageId:'missing'}]);
  assert.equal(await h.api.saveToGitHub(),true);
  assert.match(h.status(),/履歴を記録できません/);assert.match(h.status(),/参考画像1件は含めず/);
});

test('the remember option and forget action change only dedicated settings',()=>{
  const h=harness();const raw=h.values.get(MAIN);
  h.node('#githubSyncRemember').checked=true;h.fire('#githubSyncRemember','change');
  assert.equal(JSON.parse(h.values.get(SETTINGS)).token,DEMO);
  const reopened=harness({values:new Map(h.values)});
  assert.equal(reopened.node('#githubSyncRemember').checked,true);
  h.fire('#githubSyncForget','click');assert.equal(h.node('#githubSyncToken').value,'');
  assert.equal(h.values.get(SETTINGS).includes(DEMO),false);assert.equal(h.values.get(MAIN),raw);
});

test('old data-key cleanup preserves the GitHub settings and recovery data',()=>{
  const h=harness();h.values.set(SETTINGS,'settings');h.values.set(BACKUP,'backup');h.values.set('todo-calendar-board-v20','old');
  h.api.removeOldStorageKeys();assert.equal(h.values.get(SETTINGS),'settings');assert.equal(h.values.get(BACKUP),'backup');
  assert.equal(h.values.has('todo-calendar-board-v20'),false);assert.ok(h.values.has(MAIN));
});

async function uploadedFixture() {
  const source=harness();source.api.setTodos([{id:'remote',kind:'todo',title:'別端末の日本語Todo😀',date:'2026-10-30',done:false}]);
  assert.equal(await source.api.saveToGitHub(),true);return source.server;
}

test('another device restores the exported state into the current key with exact pre-restore backup',async()=>{
  const server=await uploadedFixture();const target=harness({server});const oldRaw=target.values.get(MAIN);
  const payload=JSON.parse(Buffer.from(server.file.content,'base64').toString('utf8'));
  payload.storageKey='todo-calendar-board-v999';server.file=file(JSON.stringify(payload));
  assert.equal(await target.api.restoreFromGitHub(),true);assert.equal(target.reloads,1);
  assert.equal(target.values.get(BACKUP),oldRaw);assert.equal(target.values.has('todo-calendar-board-v999'),false);
  assert.equal(JSON.parse(target.values.get(MAIN)).todos[0].title,'別端末の日本語Todo😀');
  assert.match(target.confirmations[0].message,/保存日時/);assert.match(target.confirmations[0].message,/Todo 1件/);
  const reopened=harness({values:new Map(target.values)});
  assert.equal(reopened.api.getState().todos[0].id,'remote');assert.match(reopened.status(),/最後の復元/);
  assert.equal(reopened.node('#githubSyncRecovery').hidden,false);
});

test('pagehide and pending saves cannot replace restored storage with the old in-memory state',async()=>{
  const server=await uploadedFixture();let target;
  target=harness({server,onReload:()=>{target.api.scheduleSave(0);target.api.flushSave();}});
  assert.equal(await target.api.restoreFromGitHub(),true);
  assert.equal(JSON.parse(target.values.get(MAIN)).todos[0].id,'remote');assert.equal(target.api.flags().saveBlocked,true);
});

test('restore cancellation leaves data, backup and navigation keys unchanged',async()=>{
  const server=await uploadedFixture();const h=harness({server,confirm:null});const raw=h.values.get(MAIN);
  h.values.set('todo-calendar-board-v99-navigation','navigation');
  assert.equal(await h.api.restoreFromGitHub(),false);assert.equal(h.values.get(MAIN),raw);
  assert.equal(h.values.has(BACKUP),false);assert.equal(h.values.get('todo-calendar-board-v99-navigation'),'navigation');
  assert.equal(h.reloads,0);assert.equal(h.backups.length,0);
});

test('invalid or missing state is rejected before confirmation or any replacement',async()=>{
  for(const text of ['not JSON','{}','{"state":null}','{"state":{"todos":[],"parents":null}}',
    '{"state":{"todos":[null],"parents":[]}}']) {
    const h=harness({server:{file:file(text)}});const raw=h.values.get(MAIN);
    assert.equal(await h.api.restoreFromGitHub(),false);assert.equal(h.confirmations.length,0);
    assert.equal(h.values.get(MAIN),raw);assert.equal(h.reloads,0);assert.match(h.status(),/読み込めません/);
  }
});

test('missing, oversized and non-base64 files fail safely',async()=>{
  for(const remote of [null,{...file('{}'),size:950001},{...file('{}'),encoding:'none'},
    {...file('{}'),type:'dir'},{...file('{}'),content:'not-base64!'}]) {
    const h=harness({server:{file:remote}});const raw=h.values.get(MAIN);
    assert.equal(await h.api.restoreFromGitHub(),false);assert.equal(h.values.get(MAIN),raw);assert.equal(h.reloads,0);
  }
});

test('unavailable IndexedDB uses the verified dedicated local backup',async()=>{
  const h=harness({server:await uploadedFixture(),noIdb:true});const raw=h.values.get(MAIN);
  assert.equal(await h.api.restoreFromGitHub(),true);assert.equal(h.values.get(BACKUP),raw);
});

test('quota failure during backup aborts restoration and preserves current data',async()=>{
  const h=harness({server:await uploadedFixture(),failWrite:key=>key===BACKUP});const raw=h.values.get(MAIN);
  assert.equal(await h.api.restoreFromGitHub(),false);assert.equal(h.values.get(MAIN),raw);assert.equal(h.reloads,0);
  assert.match(h.status(),/現在のデータは変更していません/);assert.equal(h.api.flags().saveBlocked,false);
});

test('main-key write failure keeps current data, recovery copy and a usable save state',async()=>{
  let fail=false;const h=harness({server:await uploadedFixture(),failWrite:key=>fail&&key===MAIN});
  const raw=h.values.get(MAIN);fail=true;
  assert.equal(await h.api.restoreFromGitHub(),false);assert.equal(h.values.get(MAIN),raw);assert.equal(h.values.get(BACKUP),raw);
  assert.equal(h.api.flags().saveBlocked,false);assert.equal(h.reloads,0);
  assert.notEqual(JSON.parse(h.values.get(SETTINGS)).lastAction,'restore');
});

test('an edit made while safety backup is pending is never silently overwritten',async()=>{
  const h=harness({server:await uploadedFixture()});
  h.context.backupRawToIdb=async()=>{h.api.setTodos([{id:'edit',kind:'todo',title:'changed',date:'2026-10-30'}]);h.api.saveState({silent:true});};
  assert.equal(await h.api.restoreFromGitHub(),false);assert.equal(JSON.parse(h.values.get(MAIN)).todos[0].id,'edit');
  assert.match(h.status(),/データが変わった/);assert.equal(h.reloads,0);
});

test('recovery export includes images and excludes sync credentials',async()=>{
  const h=harness();h.values.set(BACKUP,JSON.stringify({...h.api.exportableState(),todos:[{id:'old',imageId:'old-image'}]}));
  h.api.setImage('old-image','data:image/png;base64,YWJj');await h.api.exportGitHubRestoreBackup();
  const payload=JSON.parse(h.downloads[0].text);assert.equal(payload.state.todos[0].imageData,'data:image/png;base64,YWJj');
  assert.equal(h.downloads[0].text.includes(DEMO),false);
});

test('image cleanup retains images referenced by the dedicated recovery snapshot',async()=>{
  const h=harness();h.api.setTodos([]);h.api.setImage('protected','data:image/png;base64,YWJj');
  h.values.set(BACKUP,JSON.stringify({todos:[{id:'old',imageId:'protected'}]}));
  const removed=[];h.context.listBackups=async()=>[];
  h.context.idbRequest=async(store,mode,operation)=>mode==='readonly'
    ? [{id:'protected',createdAt:'2020-01-01'}, {id:'unused',createdAt:'2020-01-01'}]
    : operation({delete:id=>removed.push(id)});
  assert.equal(await h.api.collectUnusedImages(),1);assert.deepEqual(removed,['unused']);
});

test('a second operation is ignored while the first request is pending',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});let first=true;
  const h=harness({fetch:async(url,init,route)=>{if(first){first=false;await gate;}return route(url,init);}});
  const running=h.api.saveToGitHub();assert.equal(h.node('#githubSyncSave').disabled,true);
  assert.equal(await h.api.restoreFromGitHub(),false);assert.equal(h.requests.length,1);
  release();assert.equal(await running,true);assert.equal(h.node('#githubSyncRestore').disabled,false);
});

test('remembered credentials remain outside the uploaded state',async()=>{
  const h=harness();h.node('#githubSyncRemember').checked=true;h.fire('#githubSyncRemember','change');
  assert.equal(await h.api.saveToGitHub(),true);
  const uploaded=Buffer.from(h.server.file.content,'base64').toString('utf8');
  assert.equal(uploaded.includes(DEMO),false);assert.equal(JSON.stringify(h.api.exportableState()).includes(DEMO),false);
  assert.equal(h.values.get(SETTINGS).includes(DEMO),true);
  h.node('#githubSyncRemember').checked=false;h.fire('#githubSyncRemember','change');
  assert.equal(h.values.get(SETTINGS).includes(DEMO),false);
});

test('an empty Git repository can receive its first data.json commit',async()=>{
  const h=harness({fetch:async(url,init,route)=>{
    if(init.method==='GET'&&url.includes('/contents/'))return reply(409,{message:'Git Repository is empty.'});
    return route(url,init);
  }});
  assert.equal(await h.api.saveToGitHub(),true);assert.ok(h.server.file);
});

test('GitHub base64 line breaks preserve Japanese characters and emoji',()=>{
  const h=harness();const remote=file('日本語と😀');
  remote.content=remote.content.replace(/(.{4})/g,'$1\n');
  assert.equal(h.api.githubSyncDecodeFile(remote),'日本語と😀');
});

test('request timeout releases the UI and shows an error without retrying',async()=>{
  const h=harness({fetch:async(url,init)=>new Promise((resolve,reject)=>{
    init.signal.addEventListener('abort',()=>reject(new Error('timeout')));
  })});
  const pending=h.api.saveToGitHub();
  [...h.timers.values()].find(timer=>timer.ms===30000).fn();
  assert.equal(await pending,false);assert.equal(h.requests.length,1);
  assert.equal(h.node('#githubSyncSave').disabled,false);assert.match(h.status(),/取得できません/);
});

test('a successful remote commit is not reported as failed when local history cannot be recorded',async()=>{
  let h;h=harness({failWrite:key=>key===SETTINGS&&Boolean(h?.server.file)});
  assert.equal(await h.api.saveToGitHub(),true);assert.ok(h.server.file);
  assert.match(h.status(),/に保存しました/);assert.match(h.status(),/履歴を記録できません/);
});

test('blocked main storage stops synchronization before any network call',async()=>{
  const h=harness();h.api.setBlocked(true);
  assert.equal(await h.api.saveToGitHub(),false);assert.equal(await h.api.restoreFromGitHub(),false);
  assert.equal(h.requests.length,0);assert.match(h.status(),/端末内の保存/);
});

const puts=h=>h.requests.filter(request=>request.init.method==='PUT').length;
const remoteState=h=>JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8')).state;
async function autoReady(options={}) {
  const h=harness(options);
  h.api.setTodos([{id:'shared',kind:'todo',title:'original',date:'2026-10-30',importance:'高',done:false}]);
  await h.api.auto.start();
  assert.equal(await h.api.saveToGitHub(),true);
  assert.equal(await h.api.auto.enable(),true);
  assert.equal(h.api.auto.record().enabled,true);
  return h;
}
function edit(h,title) {h.api.getState().todos[0].title=title;assert.equal(h.api.saveState({silent:true}),true);}

test('auto sync defaults off and a new or old browser cannot upload different local data on enable',async()=>{
  const source=await autoReady();
  for(const todos of [[],[{id:'old',title:'stale',date:'2026-10-29'}]]) {
    const h=harness({server:source.server});h.api.setTodos(todos);await h.api.auto.start();
    assert.equal(await h.api.auto.enable(),false);assert.equal(h.api.auto.record().enabled,false);
    assert.equal(h.api.auto.record().paused,'setup');assert.equal(puts(h),0);
    assert.equal(h.node('#githubAutoRestore').hidden,false);
    assert.equal(remoteState(source).todos[0].title,'original');
  }
});

test('auto setup with no remote file requires an explicit first manual save',async()=>{
  const h=harness();await h.api.auto.start();assert.equal(await h.api.auto.enable(),false);
  assert.equal(puts(h),0);assert.equal(h.server.file,null);assert.equal(h.api.auto.record().enabled,false);
  assert.match(h.node('#githubAutoStatus').textContent,/最初の1回/);
});

test('auto setup reconciles existing data without making a commit',async()=>{
  const h=await autoReady();assert.equal(puts(h),1);
  assert.equal(h.api.auto.record().baseSha,h.server.file.sha);
  assert.match(h.api.auto.record().baseHash,/^[a-f0-9]{64}$/);
  assert.equal(h.api.auto.record().pending,false);
});

test('checking while auto sync is off cannot turn it on',async()=>{
  const h=await autoReady();h.node('#githubAutoEnabled').checked=false;h.fire('#githubAutoEnabled','change');
  assert.equal(await h.api.auto.enable({enable:false}),true);assert.equal(h.api.auto.record().enabled,false);assert.equal(puts(h),1);
});

test('auto debounce sends exactly three seconds after the latest substantive change',async()=>{
  const h=await autoReady();edit(h,'first');
  assert.equal(JSON.parse(h.values.get(MAIN)).todos[0].title,'first');
  assert.equal(h.api.auto.record().pending,true);await h.tick(2000);assert.equal(puts(h),1);
  edit(h,'last');await h.tick(2999);assert.equal(puts(h),1);
  await h.tick(1);assert.equal(puts(h),2);assert.equal(remoteState(h).todos[0].title,'last');
  assert.equal(h.api.auto.record().pending,false);
});

test('no-change, UI navigation, current-day updates and time passing never create an auto commit',async()=>{
  const h=await autoReady(),count=puts(h),raw=h.server.file.content;
  h.api.getState().selectedDate='2026-10-29';h.api.getState().lastKnownToday='2026-10-31';h.api.getState().view='calendar';
  h.api.getState().filterKind='todo';h.api.getState().categorySearchQuery='search';h.api.saveState();
  await h.tick(10000);assert.equal(puts(h),count);
  assert.equal(await h.api.auto.run(),true);assert.equal(puts(h),count);assert.equal(h.server.file.content,raw);
});

test('changing an item and then undoing it within the debounce avoids a commit',async()=>{
  const h=await autoReady();edit(h,'changed');edit(h,'original');await h.tick(3000);
  assert.equal(puts(h),1);assert.equal(h.api.auto.record().pending,false);
});

test('offline changes persist across restart and are sent only after a fresh remote check',async()=>{
  const h=await autoReady();h.context.navigator.onLine=false;edit(h,'offline edit');await h.tick(3000);
  assert.equal(puts(h),1);assert.equal(h.api.auto.record().pending,true);
  const restarted=harness({values:new Map(h.values),server:h.server});await restarted.api.auto.start();await restarted.tick(0);
  assert.equal(puts(restarted),1);assert.equal(remoteState(restarted).todos[0].title,'offline edit');
  assert.equal(restarted.api.auto.record().pending,false);
});

test('a resumed offline browser detects a newer remote and does not replay an old snapshot',async()=>{
  const h=await autoReady();h.context.navigator.onLine=false;edit(h,'offline edit');
  const other=harness({values:new Map(h.values),server:h.server});
  other.api.getState().todos[0].title='newer elsewhere';
  assert.equal(await other.api.saveToGitHub(),true);
  const restarted=harness({values:new Map(h.values),server:h.server});await restarted.api.auto.start();await restarted.tick(0);
  assert.equal(puts(restarted),0);assert.equal(restarted.api.auto.record().paused,'conflict');
  assert.equal(restarted.api.getState().todos[0].title,'offline edit');assert.equal(remoteState(h).todos[0].title,'newer elsewhere');
});

test('remote changes pause a clean browser too without accepting a new baseline',async()=>{
  const h=await autoReady(),base=h.api.auto.record().baseSha;
  const payload=JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8'));
  payload.state.todos[0].title='other device';h.server.file=file(JSON.stringify(payload),'c'.repeat(40));
  assert.equal(await h.api.auto.run(),false);assert.equal(h.api.auto.record().paused,'remote');
  assert.equal(h.api.auto.record().baseSha,base);assert.equal(puts(h),1);
  h.api.auto.retry();await h.tick(60000);assert.equal(puts(h),1);
});

test('remote version changes cannot be bypassed by a newer exportedAt or by retry',async()=>{
  const h=await autoReady(),base=h.api.auto.record().baseSha;edit(h,'local edit');
  const payload=JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8'));
  payload.exportedAt='2000-01-01T00:00:00Z';payload.state.todos[0].title='elsewhere';h.server.file=file(JSON.stringify(payload),'c'.repeat(40));
  await h.tick(3000);assert.equal(h.api.auto.record().paused,'conflict');assert.equal(h.api.auto.record().baseSha,base);
  h.api.auto.retry();await h.tick(60000);assert.equal(puts(h),1);assert.equal(remoteState(h).todos[0].title,'elsewhere');
});

test('a concurrent write between GET and PUT stops on HTTP409 and never refreshes the SHA to retry',async()=>{
  let conflict=false;
  const h=await autoReady({fetch:async(url,init,route)=>conflict&&init.method==='PUT'?reply(409,{message:DEMO}):route(url,init)});
  conflict=true;edit(h,'local edit');await h.tick(3000);
  assert.equal(h.api.auto.record().paused,'conflict');assert.equal(puts(h),2);
  await h.tick(60000);assert.equal(puts(h),2);assert.equal(remoteState(h).todos[0].title,'original');
});

test('an auto PUT whose response is lost is reconciled after restart without a duplicate commit',async()=>{
  let lose=false;
  const h=await autoReady({fetch:async(url,init,route)=>{const result=await route(url,init);if(lose&&init.method==='PUT')throw new Error(DEMO);return result;}});
  lose=true;edit(h,'committed despite lost response');await h.tick(3000);
  assert.ok(h.api.auto.record().inFlight);assert.equal(remoteState(h).todos[0].title,'committed despite lost response');
  const restarted=harness({values:new Map(h.values),server:h.server});await restarted.api.auto.start();await restarted.tick(0);
  assert.equal(puts(restarted),0);assert.equal(restarted.api.auto.record().inFlight,null);assert.equal(restarted.api.auto.record().pending,false);
});

test('a PUT that never reached the server is rechecked before the latest state is retried',async()=>{
  let lose=false;
  const h=await autoReady({fetch:async(url,init,route)=>{if(lose&&init.method==='PUT')throw new Error(DEMO);return route(url,init);}});
  lose=true;edit(h,'first attempt');await h.tick(3000);assert.ok(h.api.auto.record().inFlight);
  edit(h,'latest offline state');lose=false;await h.api.auto.run();
  assert.equal(remoteState(h).todos[0].title,'latest offline state');assert.equal(h.api.auto.record().inFlight,null);
});

test('additional edits while a PUT is pending stay dirty after the first commit',async()=>{
  let inject=false,h;
  h=await autoReady({fetch:async(url,init,route)=>{const result=await route(url,init);if(inject&&init.method==='PUT'){inject=false;edit(h,'second edit during upload');}return result;}});
  inject=true;edit(h,'first sent edit');await h.tick(3000);
  assert.equal(remoteState(h).todos[0].title,'first sent edit');assert.equal(h.api.auto.record().pending,true);
  await h.tick(3000);assert.equal(remoteState(h).todos[0].title,'second edit during upload');assert.equal(h.api.auto.record().pending,false);
});

test('hiding or closing before three seconds bypasses the debounce and attempts a send',async()=>{
  const h=await autoReady();edit(h,'before close');
  await h.api.auto.flush();assert.equal(remoteState(h).todos[0].title,'before close');assert.equal(puts(h),2);
});

test('another tab’s main-data write prevents stale local and remote writes',async()=>{
  const h=await autoReady();const otherRaw=JSON.stringify({...h.api.getState(),todos:[]});
  h.values.set(MAIN,otherRaw);h.api.getState().todos[0].title='stale edit';
  assert.equal(h.api.saveState({silent:true}),false);assert.equal(h.values.get(MAIN),otherRaw);
  assert.equal(await h.api.auto.run(),false);assert.equal(h.api.auto.external(),true);assert.equal(puts(h),1);
});

test('another tab’s updated baseline cannot be attached to this tab’s stale data',async()=>{
  const h=await autoReady();const foreign={...h.api.auto.record(),baseSha:'d'.repeat(40)};
  h.values.set(AUTO,JSON.stringify(foreign));
  h.api.getState().todos[0].title='stale';
  assert.equal(h.api.saveState({silent:true}),false);assert.equal(await h.api.auto.run(),false);assert.equal(puts(h),1);
  assert.equal(JSON.parse(h.values.get(AUTO)).baseSha,'d'.repeat(40));
});

test('storage events stop an old tab, and clear events are also detected',async()=>{
  const h=await autoReady();await h.emit('window:storage',{key:null});
  assert.equal(h.api.auto.external(),true);assert.equal(await h.api.auto.run(),false);assert.equal(puts(h),1);
});

test('repository changes disable auto sync and erase the old destination baseline',async()=>{
  const h=await autoReady();h.node('#githubSyncRepo').value='poi929/different';h.fire('#githubSyncRepo','change');
  assert.equal(h.api.auto.record().enabled,false);assert.equal(h.api.auto.record().baseSha,undefined);
  await h.tick(60000);assert.equal(puts(h),1);
});

test('branch changes or remote file deletion never recreate or overwrite data automatically',async()=>{
  for(const kind of ['branch','deleted']) {
    const h=await autoReady();edit(h,'local edit');
    if(kind==='branch')h.server.repo={private:true,full_name:REPO,default_branch:'different'};else h.server.file=null;
    await h.tick(3000);assert.equal(puts(h),1);assert.ok(h.api.auto.record().paused);
    if(kind==='deleted')assert.equal(h.server.file,null);
  }
});

test('an unapproved unreadable image pauses auto sync without showing repeated dialogs',async()=>{
  const h=await autoReady(),confirmations=h.confirmations.length;
  h.api.getState().todos[0].imageId='new-missing';h.api.saveState();await h.tick(3000);
  assert.equal(puts(h),1);assert.equal(h.confirmations.length,confirmations);assert.equal(h.api.auto.record().paused,'attention');
  assert.equal(h.api.getState().todos[0].imageId,'new-missing');
});

test('a manually approved missing image may be omitted again only for the same item and reference',async()=>{
  const h=await autoReady();h.api.getState().todos[0].imageId='missing';h.api.saveState();
  assert.equal(await h.api.saveToGitHub(),true);assert.equal(h.api.auto.record().omissions[0].imageId,'missing');
  const count=h.confirmations.length;edit(h,'safe repeat omission');await h.tick(3000);
  assert.equal(remoteState(h).todos[0].title,'safe repeat omission');assert.equal(h.confirmations.length,count);
  assert.equal(h.api.getState().todos[0].imageId,'missing');
  h.api.getState().todos[0].imageId='different-missing';h.api.saveState();await h.tick(3000);
  assert.equal(h.api.auto.record().paused,'attention');assert.equal(h.confirmations.length,count);
});

test('moving an available image into IndexedDB does not produce a change-only commit',async()=>{
  const h=await autoReady();h.api.getState().todos[0].imageData='data:image/png;base64,YWJj';h.api.saveState();await h.tick(3000);
  const count=puts(h);h.api.setImage('local-new-id','data:image/png;base64,YWJj');
  h.api.getState().todos[0].imageId='local-new-id';h.api.getState().todos[0].imageData='';h.api.saveState();
  await h.tick(3000);await h.api.auto.run();assert.equal(puts(h),count);
});

test('an expired token pauses requests and forgetting it never discards unsent changes',async()=>{
  const h=await autoReady();edit(h,'unsent');h.server.repoStatus=401;await h.tick(3000);
  assert.equal(h.api.auto.record().paused,'auth');const count=h.requests.length;await h.tick(60000);assert.equal(h.requests.length,count);
  h.fire('#githubSyncForget','click');assert.equal(h.api.auto.record().pending,true);assert.equal(h.node('#githubSyncToken').value,'');
});

test('quota failure when writing the durable outbox aborts before PUT while retaining main data',async()=>{
  let fail=false;const h=await autoReady({failWrite:(key,value)=>fail&&key===AUTO&&Boolean(JSON.parse(value).inFlight)});
  fail=true;edit(h,'must stay local');await h.tick(3000);
  assert.equal(puts(h),1);assert.equal(JSON.parse(h.values.get(MAIN)).todos[0].title,'must stay local');assert.ok(h.api.auto.record().paused);
});

test('auto record and durable outbox never contain credentials or enter exported state',async()=>{
  let lose=false;const h=await autoReady({fetch:async(url,init,route)=>{if(lose&&init.method==='PUT')throw new Error(DEMO);return route(url,init);}});
  h.node('#githubSyncRemember').checked=true;h.fire('#githubSyncRemember','change');lose=true;edit(h,'queued');await h.tick(3000);
  assert.ok(h.api.auto.record().inFlight);assert.equal(h.values.get(AUTO).includes(DEMO),false);
  assert.equal(JSON.stringify(h.api.exportableState()).includes(DEMO),false);assert.equal(h.values.get(SETTINGS).includes(DEMO),true);
});

test('a browser without Web Locks can use manual save but cannot enable auto writes',async()=>{
  const h=harness({noLocks:true});await h.api.auto.start();assert.equal(await h.api.saveToGitHub(),true);
  assert.equal(await h.api.auto.enable(),false);assert.notEqual(h.api.auto.record().enabled,true);assert.equal(puts(h),1);
});

test('a newer or malformed remote app version prevents automatic overwrite',async()=>{
  for(const app of ['Todo Calendar Board v999','other application']) {
    const h=await autoReady();const payload=JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8'));
    payload.app=app;h.server.file=file(JSON.stringify(payload),'c'.repeat(40));edit(h,'local');await h.tick(3000);
    assert.equal(puts(h),1);assert.ok(h.api.auto.record().paused);
  }
});

test('turning auto sync off cancels the pending timer while preserving the dirty flag',async()=>{
  const h=await autoReady();edit(h,'unsent');h.node('#githubAutoEnabled').checked=false;h.fire('#githubAutoEnabled','change');
  await h.tick(60000);assert.equal(puts(h),1);assert.equal(h.api.auto.record().enabled,false);assert.equal(h.api.auto.record().pending,true);
});

test('auto metadata survives old-version key cleanup',async()=>{
  const h=await autoReady();const raw=h.values.get(AUTO);h.api.removeOldStorageKeys();assert.equal(h.values.get(AUTO),raw);
});

test('a missing main key with retained sync settings cannot upload the newly generated example data',async()=>{
  const source=await autoReady(),values=new Map(source.values);values.delete(MAIN);
  const h=harness({values,server:source.server,skipInitialSave:true});
  assert.equal(h.api.auto.record().enabled,false);assert.equal(h.api.auto.record().paused,'setup');
  h.api.saveState();await h.api.auto.start();await h.tick(60000);
  assert.equal(puts(h),0);assert.equal(remoteState(h).todos[0].title,'original');
});

test('failure to persist the missing-main guard also blocks writing example data',async()=>{
  const source=await autoReady(),values=new Map(source.values);values.delete(MAIN);
  const h=harness({values,server:source.server,skipInitialSave:true,failWrite:key=>key===AUTO});
  assert.equal(h.api.saveState({silent:true}),false);assert.equal(values.has(MAIN),false);
  await h.api.auto.start();assert.equal(await h.api.auto.run(),false);assert.equal(puts(h),0);
});

test('restoring an external backup disables auto sync before image migration can save it',async()=>{
  const h=await autoReady();h.api.getState().todos[0].title='old backup';await h.api.afterStateReplaced();h.api.saveState();
  assert.equal(h.api.auto.record().enabled,false);assert.equal(h.api.auto.record().paused,'setup');
  await h.tick(60000);assert.equal(puts(h),1);assert.equal(remoteState(h).todos[0].title,'original');
});

test('a rate limit honors Retry-After and does not retry at the three-second debounce',async()=>{
  let limited=false;
  const h=await autoReady({fetch:async(url,init,route)=>limited?{...reply(429,{}),headers:{get:name=>name==='retry-after'?'120':null}}:route(url,init)});
  limited=true;edit(h,'limited edit');await h.tick(3000);const count=h.requests.length;
  await h.tick(119999);assert.equal(h.requests.length,count);
  limited=false;await h.tick(1);assert.equal(puts(h),2);assert.equal(remoteState(h).todos[0].title,'limited edit');
});

test('a held origin lock prevents concurrent network requests from another tab',async()=>{
  const h=await autoReady();h.context.navigator.locks.held=true;edit(h,'wait for other tab');await h.tick(3000);
  assert.equal(puts(h),1);assert.equal(h.api.auto.record().paused,'attention');
  h.context.navigator.locks.held=false;h.api.auto.retry();await h.tick(0);assert.equal(puts(h),2);
});

test('continuous changes are sent within sixty seconds instead of postponing forever',async()=>{
  const h=await autoReady();edit(h,'start');
  for(let i=0;i<29;i++){await h.tick(2000);edit(h,'edit '+i);}
  assert.equal(puts(h),1);await h.tick(2000);assert.equal(puts(h),2);
});

test('a successful GitHub restore establishes its baseline and does not upload again on restart',async()=>{
  const h=await autoReady(),payload=JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8'));
  payload.state.todos[0].title='other device';h.server.file=file(JSON.stringify(payload),'d'.repeat(40));
  assert.equal(await h.api.restoreFromGitHub(),true);
  const restarted=harness({values:new Map(h.values),server:h.server});await restarted.api.auto.start();await restarted.tick(0);
  assert.equal(puts(restarted),0);assert.equal(restarted.api.getState().todos[0].title,'other device');
  assert.equal(restarted.api.auto.record().baseSha,'d'.repeat(40));
});

test('a failed restore main-write rolls back its auto baseline as well as manual history',async()=>{
  let fail=false;const h=await autoReady({failWrite:key=>fail&&key===MAIN});
  const raw=h.values.get(AUTO),main=h.values.get(MAIN);fail=true;
  assert.equal(await h.api.restoreFromGitHub(),false);assert.equal(h.values.get(AUTO),raw);assert.equal(h.values.get(MAIN),main);
});

test('checking a conflict reads current remote details without unpausing or changing the baseline',async()=>{
  const h=await autoReady(),base=h.api.auto.record().baseSha;
  const payload=JSON.parse(Buffer.from(h.server.file.content,'base64').toString('utf8'));
  payload.state.todos[0].title='other device';h.server.file=file(JSON.stringify(payload),'d'.repeat(40));
  edit(h,'local conflict');await h.tick(3000);
  assert.equal(await h.api.auto.inspect(),true);assert.equal(h.api.auto.record().paused,'conflict');
  assert.equal(h.api.auto.record().baseSha,base);assert.equal(puts(h),1);assert.match(h.status(),/停止したまま/);
});
