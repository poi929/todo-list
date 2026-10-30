const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1].replace(/\n    initUi\(\);/,'');
const MAIN='todo-calendar-board-v96', SETTINGS='todo-calendar-board-github-sync';
const BACKUP='todo-calendar-board-pre-github-restore', REPO='poi929/todoboard-data';
// Deliberately not a GitHub token. All API calls below are in-memory fakes.
const DEMO='test-only-credential';
const sha='a'.repeat(40), nextSha='b'.repeat(40);
const reply=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
const file=(text,hash=sha)=>({type:'file',path:'data.json',encoding:'base64',sha:hash,
  size:Buffer.byteLength(text),content:Buffer.from(text).toString('base64')});

function harness(options={}) {
  const values=options.values || new Map();
  const nodes=new Map(), timers=new Map(), requests=[], confirmations=[], downloads=[], backups=[];
  let timerId=0,reloads=0;
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
    server.file=file(Buffer.from(body.content,'base64').toString('utf8'),nextSha);
    return reply(201,{content:{sha:nextSha}});
  }
  const context=vm.createContext({console,structuredClone,URL,TextEncoder,TextDecoder,AbortController,btoa,atob,
    Date:class extends Date {constructor(...args){super(...(args.length?args:['2026-10-30T12:00:00+09:00']));}static now(){return Date.parse('2026-10-30T12:00:00+09:00');}},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    localStorage,document:{getElementById:()=>null,querySelector:node},window:{innerWidth:390,innerHeight:844},navigator:{},
    location:{reload:()=>{reloads++;options.onReload?.(context);}},
    fetch:async(url,init)=>{requests.push({url,init});return options.fetch ? options.fetch(url,init,route) : route(url,init);}});
  vm.runInContext(script,context);
  vm.runInContext(`globalThis.api={initGitHubSync,saveToGitHub,restoreFromGitHub,exportGitHubRestoreBackup,
    githubSyncEncode,githubSyncDecodeFile,exportableState,saveState,flushSave,scheduleSave,removeOldStorageKeys,
    collectUnusedImages,getState:()=>state,setTodos:todos=>{state.todos=todos;dataVersion+=1;},
    setBlocked:value=>saveBlocked=value,setImage:(id,src)=>{imageCache.set(id,src);imageStoreAvailable=true;},
    flags:()=>({saveBlocked,savePending}),getStorageKey:()=>STORAGE_KEY};`,context);
  context.renderSystemBanner=()=>{};
  context.loadImageCache=async()=>{};
  context.backupRawToIdb=async(raw,reason)=>{backups.push({raw,reason});if(options.noIdb)throw new Error('unavailable');};
  context.confirmDialog=async config=>{confirmations.push(config);return typeof options.confirm==='function' ? options.confirm(config,context) : options.confirm===undefined?true:options.confirm;};
  context.downloadText=(text,name)=>downloads.push({text,name});
  const api=context.api;
  if(!values.has(MAIN))assert.equal(api.saveState({silent:true}),true);
  api.initGitHubSync();
  node('#githubSyncToken').value=DEMO;
  const fire=(selector,name)=>{for(const fn of node(selector).listeners.get(name)||[])fn({target:node(selector)});};
  return {api,context,node,values,localStorage,requests,confirmations,downloads,backups,server,timers,fire,
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
