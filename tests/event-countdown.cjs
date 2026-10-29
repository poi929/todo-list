const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1]
  .replace(/\n    initUi\(\);/,'');
const event = {id:'event',kind:'event',title:'meeting',date:'2026-10-29',endDate:'2026-10-29',
  startTime:'12:30',endTime:'13:00',repeatMode:'none',certaintyId:'confirmed',location:'room'};

function harness(todos=[{...event}]) {
  let now = Date.parse('2026-10-29T12:00:00');
  const nodes = new Map();
  const node = selector => {
    if(!nodes.has(selector)) nodes.set(selector,{textContent:'',innerHTML:'',value:'',
      classList:{toggle(){}},setAttribute(){}});
    return nodes.get(selector);
  };
  const context = vm.createContext({console,structuredClone,URL,setTimeout,clearTimeout,
    Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));} static now(){return now;}},
    document:{getElementById:()=>null,querySelector:node},window:{innerWidth:390,innerHeight:844},
    navigator:{},localStorage:{getItem:()=>null,length:0,key:()=>null}});
  vm.runInContext(script,context);
  vm.runInContext(`globalThis.api={nextAgendaCardHtml,agendaItemsForDate,renderToday,viewRenderKey,
    setTodos:todos=>{state.todos=todos;dataVersion+=1;},setState:patch=>Object.assign(state,patch)};`,context);
  const api = context.api;
  api.setTodos(todos);
  api.setState({view:'today',selectedDate:'2026-10-29',showClassesInTimeline:false});
  const card = (date='2026-10-29',type='event') => api.nextAgendaCardHtml(api.agendaItemsForDate(date),date,type);
  return {api,context,node,card,setTime:value=>{now=Date.parse(value);}};
}

test('an upcoming ordinary event shows minutes remaining and opens its editor',()=>{
  const h=harness();const card=h.card();
  assert.match(card,/次の予定/);assert.match(card,/あと30分/);
  assert.match(card,/12:30〜13:00・room/);
  assert.match(card,/data-action="edit" data-id="event" data-date="2026-10-29"/);
});

test('remaining minutes update without editing the event',()=>{
  const h=harness();const key=h.api.viewRenderKey('today');
  assert.match(h.card(),/あと30分/);
  h.setTime('2026-10-29T12:01:00');
  assert.match(h.card(),/あと29分/);assert.notEqual(h.api.viewRenderKey('today'),key);
});

test('at the start time the countdown switches to an in-progress event',()=>{
  const h=harness();h.setTime('2026-10-29T12:30:00');
  assert.match(h.card(),/いまの予定/);assert.match(h.card(),/予定中・13:00まで/);
  assert.doesNotMatch(h.card(),/あと0分/);
});

test('a current event takes priority over a later event and expires at its end',()=>{
  const h=harness([{...event},{...event,id:'later',title:'later-event',startTime:'14:00',endTime:'15:00'}]);
  h.setTime('2026-10-29T12:45:00');
  assert.match(h.card(),/meeting/);assert.doesNotMatch(h.card(),/later-event/);
  h.setTime('2026-10-29T13:00:00');
  assert.match(h.card(),/later-event/);assert.match(h.card(),/あと60分/);
  h.setTime('2026-10-29T15:00:00');assert.equal(h.card(),'');
});

test('all-day and ended events do not hide the next timed event',()=>{
  const h=harness([{...event,id:'all',startTime:'',endTime:''},
    {...event,id:'ended',startTime:'10:00',endTime:'12:00'},{...event}]);
  assert.match(h.card(),/data-id="event"/);
  h.api.setTodos([{...event,startTime:'',endTime:''}]);assert.equal(h.card(),'');
});

test('events more than three hours away show their start time just like classes',()=>{
  const h=harness([{...event,startTime:'16:00',endTime:'17:00'}]);
  assert.match(h.card(),/16:00から/);assert.doesNotMatch(h.card(),/あと/);
  h.api.setTodos([{...event,startTime:'15:00',endTime:'16:00'}]);
  assert.match(h.card(),/あと180分/);
});

test('no current-time card is shown when browsing another day',()=>{
  const h=harness([{...event,date:'2026-10-30',endDate:'2026-10-30'}]);
  assert.equal(h.card('2026-10-30'),'');
  h.api.setState({selectedDate:'2026-10-30'});h.api.renderToday();
  const content=h.node('#todayContent').innerHTML;
  assert.match(content,/meeting/);assert.doesNotMatch(content,/next-event|あと\d+分|予定中/);
});

test('a repeating event uses the time and date of today’s occurrence',()=>{
  const h=harness([{...event,date:'2026-10-22',endDate:'2026-10-22',repeatMode:'weekly',repeatWeekdays:[4]}]);
  assert.match(h.card(),/あと30分/);assert.match(h.card(),/data-date="2026-10-29"/);
});

test('an event without an end time uses the existing agenda end-time fallback',()=>{
  const h=harness([{...event,endTime:''}]);h.setTime('2026-10-29T12:45:00');
  assert.match(h.card(),/予定中・13:30まで/);
});

test('event title and location are escaped in the focus card',()=>{
  const h=harness([{...event,title:'<img src=x>',location:'<script>bad</script>'}]);
  assert.match(h.card(),/&lt;img src=x&gt;/);
  assert.match(h.card(),/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(h.card(),/<img|<script>/);
});

test('class and event cards coexist and hiding classes keeps the event card',()=>{
  const h=harness();
  const cls={id:'lesson',title:'lesson-title',startTime:'12:15',endTime:'13:45',room:'classroom',colorKey:''};
  h.context.classesForDate=()=>[cls];
  h.api.setState({showClassesInTimeline:true});h.api.renderToday();
  const content=h.node('#todayContent').innerHTML;
  assert.match(content,/次の授業/);assert.match(content,/あと15分/);
  assert.match(content,/次の予定/);assert.match(content,/あと30分/);
  h.api.setState({showClassesInTimeline:false});h.api.renderToday();
  assert.doesNotMatch(h.node('#todayContent').innerHTML,/次の授業/);
  assert.match(h.node('#todayContent').innerHTML,/次の予定/);
});

test('ongoing classes and makeup classes keep their labels and edit actions',()=>{
  const h=harness();
  const cls={id:'lesson',title:'lesson',startTime:'11:00',endTime:'12:30',room:'classroom'};
  h.context.classesForDate=()=>[cls];h.api.setState({showClassesInTimeline:true});
  assert.match(h.card('2026-10-29','class'),/授業中・12:30まで/);
  assert.match(h.card('2026-10-29','class'),/data-action="class"/);
  cls.isMakeupClass=true;
  assert.match(h.card('2026-10-29','class'),/data-action="makeup"/);
});
