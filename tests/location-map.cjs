const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {test}=require('node:test');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1].replace(/\n    initUi\(\);/,'');
const MAP='https://maps.app.goo.gl/example?g_st=ac';
function harness(){
  const nodes=new Map(),values=new Map();
  const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'',textContent:'',innerHTML:'',hidden:false,open:false,dataset:{},attrs:{},style:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},focus(){this.focused=true;}});return nodes.get(selector);};
  const context=vm.createContext({console,structuredClone,URL,setTimeout,clearTimeout,window:{innerWidth:390},navigator:{},
    document:{getElementById:()=>null,querySelector:node,querySelectorAll:()=>[]},localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),get length(){return values.size;},key:i=>[...values.keys()][i]}});
  vm.runInContext(script,context);
  vm.runInContext(`globalThis.api={safeMapUrl,mapLinkHtml,todoRowHtml,agendaRowHtml,normalizeParsedState,exportableState,githubAutoComparable,
    setItemKind,openItemSheet,updateItemMapLink,saveItemSheetInner,saveCopiedEvent,saveState,
    state:()=>state,form:()=>itemSheet};state.todos=[];`,context);
  for(const name of ['renderQuickDates','setItemImportance','setItemCertainty','setItemImage','renderItemCategoryOptions','setItemRepeatWeekdays','updateRepeatUntilVisibility','updateSeriesNote','updateRepeatWeekdaysHint','openSheet','closeSheet','showToast','writeUiPrefs'])context[name]=()=>{};
  context.readUiPrefs=()=>({});context.readItemCategory=()=>({parentId:'class',childId:'english'});
  context.readItemRepeatWeekdays=()=>[1,3];
  context.renderAll=()=>context.api.saveState({silent:true});
  node('#itemTitle').value='地図付きのタスク';node('#itemDate').value='2026-10-30';node('#itemRepeatMode').value='none';
  return{api:context.api,context,node,values};
}

test('short and ordinary map URLs retain their path and query',()=>{
  const h=harness();assert.equal(h.api.safeMapUrl(' '+MAP+' '),MAP);
  const long='https://www.google.com/maps/search/?api=1&query=Tokyo+Station';assert.equal(h.api.safeMapUrl(long),long);
  assert.ok(h.api.safeMapUrl('https://www.google.co.jp/maps/place/東京駅'));
});

test('non-web schemes, malformed URLs and credential-bearing URLs are not executable',()=>{
  const h=harness();for(const url of ['javascript:alert(1)','data:text/html,test','file:///tmp/test','//google.com/maps','not a url','https://name:password@example.com/maps']){
    assert.equal(h.api.safeMapUrl(url),'');assert.equal(h.api.mapLinkHtml({title:'title',mapUrl:url}),'');
  }
});

test('both Todo and event expose a location and a map field',()=>{
  const h=harness();for(const kind of ['todo','event']){h.api.setItemKind(kind);assert.equal(h.node('#itemLocationField').hidden,false);assert.equal(h.node('#itemMapUrlField').hidden,false);}
});

test('adding and reopening a Todo persists its location and map URL',async()=>{
  const h=harness();h.node('#itemLocation').value=' 東京駅 ';h.node('#itemMapUrl').value=' '+MAP+' ';
  await h.api.saveItemSheetInner();const todo=h.api.state().todos[0];
  assert.equal(todo.location,'東京駅');assert.equal(todo.mapUrl,MAP);
  assert.equal(JSON.parse(h.values.get('todo-calendar-board-v96')).todos[0].mapUrl,MAP);
  h.api.openItemSheet({id:todo.id});assert.equal(h.node('#itemLocation').value,'東京駅');assert.equal(h.node('#itemMapUrl').value,MAP);
  assert.equal(h.node('#itemMore').open,true);assert.equal(h.node('#itemMapOpen').attrs.href,MAP);
});

test('adding an event and switching its kind retains location and map values',async()=>{
  const h=harness();h.api.setItemKind('event');h.node('#itemLocation').value='図書館';h.node('#itemMapUrl').value=MAP;
  h.api.setItemKind('todo');h.api.setItemKind('event');await h.api.saveItemSheetInner();
  const event=h.api.state().todos[0];assert.equal(event.kind,'event');assert.equal(event.location,'図書館');assert.equal(event.mapUrl,MAP);
});

test('invalid pasted URLs block saving with an inline error, without changing the existing task',async()=>{
  const h=harness();h.api.state().todos=[{id:'existing',kind:'todo',title:'original',date:'2026-10-30'}];
  h.api.form().mode='edit';h.api.form().id='existing';h.node('#itemMapUrl').value='javascript:alert(1)';
  await h.api.saveItemSheetInner();assert.equal(h.api.state().todos[0].title,'original');
  assert.equal(h.node('#itemMapUrlError').hidden,false);assert.equal(h.node('#itemMapUrl').focused,true);assert.equal(h.node('#itemMore').open,true);
});

test('clearing a map field removes its active link and may be saved while retaining location',async()=>{
  const h=harness();h.node('#itemLocation').value='東京駅';h.node('#itemMapUrl').value=MAP;await h.api.saveItemSheetInner();
  const todo=h.api.state().todos[0];h.api.openItemSheet({id:todo.id});h.node('#itemMapUrl').value='';h.api.updateItemMapLink();
  assert.equal(h.node('#itemMapOpen').hidden,true);assert.equal(h.node('#itemMapOpen').attrs.href,undefined);
  await h.api.saveItemSheetInner();assert.equal(todo.mapUrl,'');assert.equal(todo.location,'東京駅');
});

test('legacy imports keep Todo locations and sanitize unsafe map URLs',()=>{
  const h=harness(),loaded=h.api.normalizeParsedState({parents:[],todos:[{id:'old',title:'old',location:'old room',mapUrl:'javascript:alert(1)'}]}).loaded;
  assert.equal(loaded.todos[0].location,'old room');assert.equal(loaded.todos[0].mapUrl,'');
});

test('Todo and event rows render escaped locations with a separate map link outside the editor control',()=>{
  const h=harness(),todo={id:'row',kind:'todo',date:'2026-10-30',title:'<title>',location:'<room>',mapUrl:MAP};
  for(const row of [h.api.todoRowHtml(todo),h.api.agendaRowHtml({item:{...todo,kind:'event'},type:'event',allDay:true},'2026-10-30')]){
    assert.match(row,/&lt;room&gt;/);assert.match(row,/<\/div><a class="map-link" href=/);
    assert.match(row,/target="_blank" rel="noopener noreferrer"/);assert.doesNotMatch(row,/<room>|<title>/);
  }
});

test('weekly Todo branches and copied events preserve location and map URL',async()=>{
  const h=harness();h.node('#itemRepeatMode').value='weekly';h.node('#itemLocation').value='駅前';h.node('#itemMapUrl').value=MAP;
  await h.api.saveItemSheetInner();assert.equal(h.api.state().todos.length,2);
  assert.ok(h.api.state().todos.every(todo=>todo.location==='駅前'&&todo.mapUrl===MAP));
  const source={...h.api.state().todos[0],kind:'event',repeatMode:'none'};h.api.state().todos=[source];
  h.node('#copyEventSourceId').value=source.id;h.node('#copyEventStartDate').value='2026-11-10';h.node('#copyEventEndDate').value='2026-11-10';
  h.api.saveCopiedEvent();assert.equal(h.api.state().todos[1].location,'駅前');assert.equal(h.api.state().todos[1].mapUrl,MAP);
});

test('export and sync retain a map link; adding an empty field does not change the sync comparison',()=>{
  const h=harness();h.api.state().todos=[{id:'sync',kind:'todo',title:'task',date:'2026-10-30'}];
  const before=h.api.githubAutoComparable(h.api.exportableState());h.api.state().todos[0].mapUrl='';
  assert.equal(h.api.githubAutoComparable(h.api.exportableState()),before);
  h.api.state().todos[0].mapUrl=MAP;assert.notEqual(h.api.githubAutoComparable(h.api.exportableState()),before);
  assert.equal(h.api.exportableState().todos[0].mapUrl,MAP);
});
