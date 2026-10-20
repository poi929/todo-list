const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1].replace(/\n    initUi\(\);/, '');
const task = {id:'single', kind:'todo', title:'sample-task', date:'2026-10-19', importance:'低', repeatMode:'none', done:false};

function harness(todos = [{...task}]) {
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const document = {getElementById:()=>null, contains:()=>true,
    addEventListener:(name, fn) => { if(!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); }};
  const context = vm.createContext({console, structuredClone, URL, document,
    Date:class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-17T12:00:00+09:00'])); } static now() {return Date.parse('2026-10-17T12:00:00+09:00');} },
    setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;}, clearTimeout:id=>timers.delete(id),
    window:{addEventListener:(name, fn)=>document.addEventListener(name,fn)}, navigator:{}, localStorage:{getItem:()=>null,length:0,key:()=>null}});
  vm.runInContext(script,context);
  vm.runInContext(`globalThis.api = {setTodoResult,toggleTodo,requestTodoFailure,bindTodoLongPress,
    todoRowHtml,monthBarHtml,isOverdueTodo,isVisibleInMonthGrid,normalizeParsedState,initialState,
    setTodos:items=>{state.todos=items;dataVersion+=1;}, getTodos:()=>state.todos};`,context);
  const api=context.api;
  api.setTodos(todos);
  context.renderAll=()=>{};
  context.showToast=(message,undo)=>{context.lastToast={message,undo};};
  const fire=(name, patch={})=>{const event={button:0,pointerId:1,clientX:20,clientY:20,isPrimary:true,...patch};(listeners.get(name)||[]).forEach(fn=>fn(event));return event;};
  const runTimers=()=>{const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());};
  return {context,api,fire,runTimers,timers};
}

test('single failure is closed, distinct from completion, and undo restores timestamps',()=>{
  const item={...task,updatedAt:'before'};
  const {api,context}=harness([item]);
  api.setTodoResult(item.id,'failed');
  assert.equal(item.done,true);
  assert.equal(item.failed,true);
  assert.ok(item.completedAt);
  assert.equal(api.isOverdueTodo(item),false);
  assert.match(api.todoRowHtml(item),/class="todo-failed-label">失敗/);
  assert.match(api.todoRowHtml(item),/done failed/);
  context.lastToast.undo();
  assert.deepEqual(item,{...task,updatedAt:'before'});
});

test('normal tap completes a failed task, and undo restores failure',()=>{
  const item={...task,done:true,failed:true,completedAt:'failure-time',updatedAt:'failure-time'};
  const {api,context}=harness([item]);
  api.toggleTodo(item.id);
  assert.equal(item.done,true);
  assert.equal('failed' in item,false);
  context.lastToast.undo();
  assert.equal(item.failed,true);
  assert.equal(item.completedAt,'failure-time');
});

test('failure and undo are persisted before a delayed save or reload can occur',()=>{
  const {api,context}=harness();
  const saved=[];
  context.localStorage.setItem=(key,value)=>saved.push(JSON.parse(value));
  context.renderAll=()=>vm.runInContext('scheduleSave();',context);
  api.setTodoResult('single','failed');
  assert.equal(saved.at(-1).todos[0].failed,true);
  context.lastToast.undo();
  assert.equal(saved.at(-1).todos[0].done,false);
  assert.equal(saved.at(-1).todos[0].failed,undefined);
});

test('completed Todo can be changed to failed without generating another recurrence',()=>{
  const {api}=harness([{...task,done:true}]);
  api.setTodoResult('single','failed');
  assert.equal(api.getTodos().length,1);
  assert.equal(api.getTodos()[0].failed,true);
});

test('weekly failure advances only its weekday; undo removes history and restores schedule',()=>{
  const monday={...task,id:'monday',repeatMode:'weekly',repeatWeekdays:[1],updatedAt:'before'};
  const wednesday={...monday,id:'wednesday',date:'2026-10-21',repeatWeekdays:[3]};
  const {api,context}=harness([monday,wednesday]);
  api.setTodoResult('monday','failed');
  assert.equal(monday.date,'2026-10-26');
  assert.equal(monday.done,false);
  assert.equal(monday.failed,undefined);
  assert.equal(wednesday.date,'2026-10-21');
  const record=api.getTodos().find(t=>t.failed);
  assert.equal(record.date,'2026-10-19');
  assert.equal(record.repeatSourceId,'monday');
  assert.equal(record.repeatMode,'none');
  assert.equal(record.done,true);
  assert.equal(api.isVisibleInMonthGrid(record),false);
  context.lastToast.undo();
  assert.equal(monday.date,'2026-10-19');
  assert.equal(monday.updatedAt,'before');
  assert.equal(api.getTodos().length,2);
});

test('daily and monthly failure retain their normal next deadlines',()=>{
  for(const [repeatMode,date,next] of [['daily','2026-10-19','2026-10-20'],['monthly','2026-10-31','2026-11-30']]) {
    const item={...task,date,repeatMode};
    const {api}=harness([item]);
    api.setTodoResult(item.id,'failed');
    assert.equal(item.date,next);
    assert.equal(api.getTodos().find(t=>t.failed).date,date);
  }
});

test('final repetition fails in place once, without an extra deadline',()=>{
  const item={...task,repeatMode:'weekly',repeatWeekdays:[1],repeatUntil:'2026-10-19'};
  const {api}=harness([item]);
  api.setTodoResult(item.id,'failed');
  api.setTodoResult(item.id,'failed');
  assert.equal(api.getTodos().length,1);
  assert.equal(item.date,'2026-10-19');
  assert.equal(item.failed,true);
});

test('JSON round-trip preserves valid failures and old data without failure',()=>{
  const {api}=harness();
  const todos=[{...task,done:true,failed:true},{...task,id:'legacy',done:true},{...task,id:'pending',failed:true},{...task,id:'event',kind:'event',done:true,failed:true}];
  const loaded=api.normalizeParsedState(JSON.parse(JSON.stringify({...api.initialState,todos}))).loaded.todos;
  assert.equal(loaded[0].failed,true);
  assert.equal(loaded[0].done,true);
  assert.equal(loaded[1].failed,undefined);
  assert.equal(loaded[2].failed,undefined);
  assert.equal(loaded[3].failed,undefined);
});

test('events and missing tasks cannot be failed',()=>{
  const item={...task,kind:'event'};
  const {api}=harness([item]);
  api.setTodoResult(item.id,'failed');
  api.setTodoResult('missing','failed');
  assert.deepEqual(item,{...task,kind:'event'});
});

test('cancelled confirmation leaves the task untouched',async()=>{
  const item={...task};
  const {api,context}=harness([item]);
  context.confirmDialog=async options=>{assert.match(options.title,/このタスクを失敗にしますか/);return null;};
  await api.requestTodoFailure(item.id);
  assert.deepEqual(item,task);
});

test('confirmed failure changes the task only after selection',async()=>{
  const item={...task};
  const {api,context}=harness([item]);
  let respond;
  context.confirmDialog=()=>new Promise(resolve=>{respond=resolve;});
  const pending=api.requestTodoFailure(item.id);
  assert.equal(item.done,false);
  respond(true);await pending;
  assert.equal(item.failed,true);
});

test('task changed while confirmation is open cannot fail the next occurrence',async()=>{
  const item={...task};
  const {api,context}=harness([item]);
  context.confirmDialog=async()=>{item.date='2026-10-26';return true;};
  await api.requestTodoFailure(item.id);
  assert.equal(item.done,false);
});

function gestureHarness() {
  const h=harness();
  const classes=new Set();
  const button={dataset:{id:'single'},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}};
  button.closest=()=>button;
  const opened=[];
  h.context.requestTodoFailure=id=>opened.push(id);
  h.api.bindTodoLongPress();
  return {...h,button,classes,opened};
}

test('short press does not open confirmation or suppress its normal click',()=>{
  const h=gestureHarness();
  h.fire('pointerdown',{target:h.button});
  h.fire('pointerup',{target:h.button});
  h.runTimers();
  h.fire('click',{target:h.button,preventDefault:()=>assert.fail('short click suppressed')});
  assert.equal(h.opened.length,0);
  assert.equal(h.classes.size,0);
});

test('long press opens once and suppresses completion on release',()=>{
  const h=gestureHarness();
  h.fire('pointerdown',{target:h.button});
  h.runTimers();h.fire('pointerup',{target:h.button});
  let prevented=false,stopped=false;
  h.fire('click',{target:h.button,preventDefault:()=>{prevented=true;},stopImmediatePropagation:()=>{stopped=true;}});
  assert.deepEqual(h.opened,['single']);
  assert.ok(prevented&&stopped);
  assert.equal(h.classes.size,0);
});

test('drag, pointer cancellation, scroll and window blur cancel long press',()=>{
  for(const event of ['pointermove','pointercancel','scroll','blur']) {
    const h=gestureHarness();
    h.fire('pointerdown',{target:h.button});
    h.fire(event,{target:h.button,clientY:50});
    h.runTimers();
    assert.equal(h.opened.length,0,event);
    assert.equal(h.classes.size,0);
  }
});

test('multiple fingers cancel the first press',()=>{
  const h=gestureHarness();
  h.fire('pointerdown',{target:h.button});
  h.fire('pointerdown',{target:h.button,pointerId:2,isPrimary:false});
  h.runTimers();
  assert.equal(h.opened.length,0);
});

test('keyboard alternative opens confirmation without completing the task',()=>{
  const h=gestureHarness();
  let prevented=false;
  h.fire('keydown',{target:h.button,key:'Enter',shiftKey:true,preventDefault:()=>{prevented=true;}});
  assert.ok(prevented);
  assert.deepEqual(h.opened,['single']);
  assert.equal(h.api.getTodos()[0].done,false);
});
