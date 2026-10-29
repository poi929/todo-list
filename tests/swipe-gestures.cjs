const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1]
  .replace(/\n    initUi\(\);/, '');

function harness() {
  let now = Date.parse('2026-10-29T12:00:00');
  const timers = new Map();
  let nextTimer = 0;
  function node(parent = null, excluded = false) {
    const listeners = new Map();
    return {parent, hidden:false, textContent:'', classList:{toggle(){}}, setAttribute(){},
      closest:()=>excluded ? {} : null,
      addEventListener(name,fn,options) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push({fn,capture:options === true || Boolean(options?.capture)});
      }, listeners};
  }
  const document = node();
  document.getElementById = () => null;
  const window = node();
  const nodes = Object.fromEntries(['#todayView','#toast','#calendarBody','#fabMenu','#toastMessage','#toastAction']
    .map(selector=>[selector,node()]));
  nodes['#fabMenu'].hidden = true;
  nodes['#toast'].hidden = true;
  nodes['#toastAction'].parent = nodes['#toast'];
  nodes['#toastMessage'].parent = nodes['#toast'];
  document.querySelector = selector => nodes[selector];
  const context = vm.createContext({console,structuredClone,URL,document,window,navigator:{},
    Date:class extends Date {constructor(...args){super(...(args.length ? args : [now]));} static now(){return now;}},
    localStorage:{getItem:()=>null,length:0,key:()=>null},
    setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},
    clearTimeout:id=>timers.delete(id)});
  vm.runInContext(script,context);
  vm.runInContext(`globalThis.api = {bindSwipeGestures,showToast,hideToast,
    setState:patch=>Object.assign(state,patch),getState:()=>state,
    setSheetOpen:open=>{sheetStack.length=0;if(open)sheetStack.push('itemSheet');},
    callbacks:()=>({undo:toastUndo,tap:toastTap})};`,context);
  const api = context.api;
  api.setState({view:'today',selectedDate:'2026-10-29'});
  const dates = [], calendar = [];
  context.openDailyOverview = date => {dates.push(date);api.setState({selectedDate:date});};
  context.shiftCalendar = direction => calendar.push(direction);
  api.bindSwipeGestures();
  function fire(name,target=nodes['#todayView'],patch={}) {
    const event={target,button:0,isPrimary:true,pointerId:1,pointerType:'touch',
      clientX:200,clientY:200,cancelable:true,detail:1,...patch,
      preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    const path=[];
    for(let current=target;current && current!==document;current=current.parent)path.push(current);
    for(const current of [document,...path.slice().reverse()]) {
      for(const listener of current.listeners.get(name)||[])if(listener.capture && !event.stopped)listener.fn(event);
    }
    for(const current of [...path,document]) {
      for(const listener of current.listeners.get(name)||[])if(!listener.capture && !event.stopped)listener.fn(event);
    }
    return event;
  }
  function swipe(target=nodes['#todayView'],dx=-120,dy=0) {
    fire('pointerdown',target);
    fire('pointermove',target,{clientX:200+dx,clientY:200+dy});
    return fire('pointerup',target,{clientX:200+dx,clientY:200+dy});
  }
  return {api,nodes,node,document,window,fire,swipe,dates,calendar,timers,
    tick:ms=>{now+=ms;}};
}

test('day view swipes left to the next day and right to the previous day',()=>{
  const h=harness();
  h.swipe();h.swipe(h.nodes['#todayView'],120);
  assert.deepEqual(h.dates,['2026-10-30','2026-10-29']);
});

test('day navigation crosses month and year boundaries',()=>{
  const h=harness();
  h.api.setState({selectedDate:'2026-12-31'});h.swipe();
  h.api.setState({selectedDate:'2026-11-01'});h.swipe(h.nodes['#todayView'],120);
  assert.deepEqual(h.dates,['2027-01-01','2026-10-31']);
});

test('vertical scrolling and a short tap do not change the day or suppress a tap',()=>{
  const h=harness();h.swipe(h.nodes['#todayView'],0,120);
  h.fire('pointerdown');h.fire('pointerup');
  assert.equal(h.fire('click').prevented,undefined);
  assert.equal(h.dates.length,0);
});

test('a gesture that begins vertically stays a scroll even if it later moves sideways',()=>{
  const h=harness();h.fire('pointerdown');
  h.fire('pointermove',undefined,{clientY:230});
  h.fire('pointerup',undefined,{clientX:60,clientY:200});
  assert.equal(h.dates.length,0);
});

test('inputs, checkboxes and horizontally scrollable content do not start day navigation',()=>{
  const h=harness();const input=h.node(h.nodes['#todayView'],true);
  h.swipe(input);assert.equal(h.dates.length,0);
});

test('day navigation is disabled while a sheet or add menu is open or another view is selected',()=>{
  for(const reason of ['sheet','menu','view']) {
    const h=harness();
    if(reason==='sheet')h.api.setSheetOpen(true);
    if(reason==='menu')h.nodes['#fabMenu'].hidden=false;
    if(reason==='view')h.api.setState({view:'todos'});
    h.swipe();assert.equal(h.dates.length,0,reason);
  }
});

test('cancellation, scrolling, loss of focus and multiple fingers cancel a gesture',()=>{
  for(const reason of ['pointercancel','scroll','blur','multiple']) {
    const h=harness();h.fire('pointerdown');
    if(reason==='multiple')h.fire('pointerdown',undefined,{pointerId:2,isPrimary:false});
    else if(reason==='blur')(h.window.listeners.get('blur')||[]).forEach(item=>item.fn({}));
    else h.fire(reason);
    h.fire('pointerup',undefined,{clientX:50});
    assert.equal(h.dates.length,0,reason);
  }
});

test('slow deliberate horizontal swipes also navigate',()=>{
  const h=harness();h.fire('pointerdown');h.tick(1500);
  h.fire('pointerup',undefined,{clientX:50});
  assert.deepEqual(h.dates,['2026-10-30']);
});

test('a changed date cannot navigate a stale day',()=>{
  const h=harness();h.fire('pointerdown');h.api.setState({selectedDate:'2026-11-01'});
  h.fire('pointerup',undefined,{clientX:50});
  assert.equal(h.dates.length,0);
});

test('the release click after a swipe cannot open or complete a task; the next tap works',()=>{
  const h=harness();h.swipe();
  const release=h.fire('click');assert.ok(release.prevented && release.stopped);
  h.fire('pointerdown');h.fire('pointerup');
  assert.equal(h.fire('click').prevented,undefined);
});

test('a short horizontal drag does not navigate or accidentally activate a row',()=>{
  const h=harness();h.swipe(h.nodes['#todayView'],-35);
  assert.equal(h.dates.length,0);assert.equal(h.fire('click').prevented,true);
});

test('keyboard activation remains available after a swipe',()=>{
  const h=harness();h.swipe();
  assert.equal(h.fire('click',undefined,{detail:0}).prevented,undefined);
});

test('swiping a toast either way dismisses it and clears edit/undo without executing them',()=>{
  for(const dx of [-80,80]) {
    const h=harness();let calls=0;
    h.api.showToast('added',()=>calls++,3000,()=>calls++);
    h.swipe(h.nodes['#toastAction'],dx);
    assert.equal(h.nodes['#toast'].hidden,true);
    assert.equal(h.api.callbacks().undo,null);assert.equal(h.api.callbacks().tap,null);
    assert.equal(h.timers.size,0);assert.equal(calls,0);
    assert.equal(h.fire('click',h.nodes['#toastAction']).stopped,true);
    assert.equal(h.dates.length,0);
  }
});

test('a normal toast tap still reaches its edit/undo controls and keeps the three-second timer',()=>{
  const h=harness();h.api.showToast('added',()=>{},3000,()=>{});
  assert.equal([...h.timers.values()][0].ms,3000);
  h.fire('pointerdown',h.nodes['#toastMessage']);h.fire('pointerup',h.nodes['#toastMessage']);
  assert.equal(h.fire('click',h.nodes['#toastMessage']).prevented,undefined);
  assert.equal(h.nodes['#toast'].hidden,false);
});

test('vertical scrolling over a toast does not dismiss it',()=>{
  const h=harness();h.api.showToast('added',()=>{},3000);
  h.swipe(h.nodes['#toast'],0,100);assert.equal(h.nodes['#toast'].hidden,false);
});

test('an old toast gesture cannot dismiss a replacement notification',()=>{
  const h=harness();h.api.showToast('first',()=>{},3000);
  h.fire('pointerdown',h.nodes['#toast']);h.api.showToast('second',()=>{},3000);
  h.fire('pointerup',h.nodes['#toast'],{clientX:50});
  assert.equal(h.nodes['#toast'].hidden,false);
  assert.equal(h.nodes['#toastMessage'].textContent,'second');
});

test('calendar swipes continue to use the current calendar navigation',()=>{
  const h=harness();h.api.setState({view:'calendar'});
  h.swipe(h.nodes['#calendarBody']);h.swipe(h.nodes['#calendarBody'],120);
  assert.deepEqual(h.calendar,[1,-1]);assert.equal(h.dates.length,0);
});
