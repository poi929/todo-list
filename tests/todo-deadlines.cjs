const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1]
  .replace(/\n    initUi\(\);/, '');
const task = { id:'timed', kind:'todo', title:'timed-task', date:'2026-10-25',
  deadlineTime:'18:00', importance:'中', repeatMode:'none', done:false };

function harness(todos = [{...task}], time = '2026-10-25T17:59:00') {
  let now = Date.parse(time);
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {textContent:'', innerHTML:'', value:'',
      classList:{toggle(){}}, setAttribute(){}});
    return nodes.get(selector);
  };
  const context = vm.createContext({ console, structuredClone, URL, setTimeout, clearTimeout,
    Date:class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    document:{getElementById:()=>null, querySelector:node, querySelectorAll:()=>[]},
    window:{innerWidth:390, innerHeight:844}, navigator:{},
    localStorage:{getItem:()=>null, length:0, key:()=>null} });
  vm.runInContext(script, context);
  vm.runInContext(`globalThis.api = {isOverdueTodo, itemIndex, effectiveTodosForDate,
    todoRowHtml, monthBarHtml, renderToday, renderTodoList, viewRenderKey, calendarPaneKey,
    setTodos:todos=>{state.todos=todos;dataVersion+=1;},
    setState:patch=>Object.assign(state,patch)};`, context);
  const api = context.api;
  api.setTodos(todos);
  api.setState({selectedDate:'2026-10-25', showClassesInTimeline:false,
    filterParentId:'all', filterChildId:'all', filterKind:'todo', categorySearchQuery:''});
  return {api, node, setTime:value=>{now=Date.parse(value);}};
}

test('an unfinished task becomes overdue at its local deadline time', () => {
  const {api,setTime} = harness();
  assert.equal(api.isOverdueTodo(task), false);
  setTime('2026-10-25T18:00:00');
  assert.equal(api.isOverdueTodo(task), true);
  setTime('2026-10-25T18:01:00');
  assert.equal(api.isOverdueTodo(task), true);
});

test('date-only tasks remain due throughout the day and expire at midnight', () => {
  const item = {...task,deadlineTime:''};
  const {api,setTime} = harness([item], '2026-10-25T23:59:59');
  assert.equal(api.isOverdueTodo(item), false);
  setTime('2026-10-26T00:00:00');
  assert.equal(api.isOverdueTodo(item), true);
});

test('past dates expire regardless of time while future dates remain due', () => {
  const {api} = harness();
  assert.equal(api.isOverdueTodo({...task,date:'2026-10-24',deadlineTime:'23:59'}), true);
  assert.equal(api.isOverdueTodo({...task,date:'2026-10-26',deadlineTime:'00:00'}), false);
});

test('completed tasks, failed tasks and events are excluded; legacy Todo still works', () => {
  const {api} = harness([], '2026-10-25T19:00:00');
  for (const patch of [{done:true},{done:true,failed:true},{kind:'event'}]) {
    assert.equal(api.isOverdueTodo({...task,...patch}), false);
  }
  assert.equal(api.isOverdueTodo({...task,kind:undefined}), true);
});

test('malformed times do not turn a same-day task into an overdue task', () => {
  const {api} = harness([], '2026-10-25T23:59:59');
  for (const deadlineTime of [undefined,'','invalid','25:00','12:99','1:30']) {
    assert.equal(api.isOverdueTodo({...task,deadlineTime}), false, String(deadlineTime));
  }
});

test('the overdue index updates as time passes without editing data', () => {
  const {api,setTime} = harness();
  assert.equal(api.itemIndex().overdue.length, 0);
  setTime('2026-10-25T18:01:00');
  assert.deepEqual(Array.from(api.itemIndex().overdue, todo=>todo.id), ['timed']);
  setTime('2026-10-25T17:59:00');
  assert.equal(api.itemIndex().overdue.length, 0);
});

test('same-day overdue tasks appear once in calendars and boards alongside past carryovers', () => {
  const past = {...task,id:'past',date:'2026-10-24'};
  const {api} = harness([{...task},past], '2026-10-25T18:01:00');
  const entries = api.effectiveTodosForDate('2026-10-25');
  assert.equal(entries.length, 2);
  assert.equal(entries.filter(entry=>entry.todo.id === 'timed').length, 1);
  assert.equal(entries.find(entry=>entry.todo.id === 'timed').isCarryOver, false);
  assert.equal(entries.find(entry=>entry.todo.id === 'past').isCarryOver, true);
});

test('today overview moves an expired task out of today and into overdue', () => {
  const todos = [{...task}, {...task,id:'untimed',title:'untimed-task',deadlineTime:''},
    {...task,id:'done',title:'finished-task',done:true}];
  const {api,node,setTime} = harness(todos);
  api.renderToday();
  assert.doesNotMatch(node('#todayContent').innerHTML, /<h2[^>]*>期限切れ/);
  setTime('2026-10-25T18:01:00');
  api.renderToday();
  const content = node('#todayContent').innerHTML;
  const sections = content.split('<div class="section">');
  const today = sections.find(section=>section.includes('今日のTodo'));
  const overdue = sections.find(section=>section.includes('>期限切れ<span'));
  assert.doesNotMatch(today, />timed-task<\/div>/);
  assert.match(today, /untimed-task/);
  assert.match(today, /finished-task/);
  assert.match(overdue, /timed-task/);
  assert.doesNotMatch(overdue, /untimed-task|finished-task/);
  assert.match(overdue, /期限超過/);
});

test('Todo list moves a same-day expired task into the overdue section', () => {
  const {api,node,setTime} = harness();
  api.renderTodoList();
  assert.doesNotMatch(node('#todosBody').innerHTML, /期限切れ/);
  setTime('2026-10-25T18:01:00');
  api.renderTodoList();
  const content = node('#todosBody').innerHTML;
  assert.match(content, /期限切れ/);
  assert.match(content, /timed-task/);
  assert.doesNotMatch(content, /<h2[^>]*>今日/);
});

test('browsing a different date keeps its tasks visible without a current-overdue section', () => {
  const {api,node} = harness([{...task}], '2026-10-26T19:00:00');
  api.renderToday();
  const content = node('#todayContent').innerHTML;
  assert.match(content, /timed-task/);
  assert.doesNotMatch(content, /<h2[^>]*>期限切れ/);
});

test('same-day overdue styling agrees between rows and month calendar bars', () => {
  const {api,setTime} = harness();
  assert.doesNotMatch(api.todoRowHtml(task), /overdue-text/);
  setTime('2026-10-25T18:01:00');
  assert.match(api.todoRowHtml(task), /overdue-text/);
  assert.match(api.monthBarHtml({todo:task,startCol:0,endCol:0,lane:0}), /class="m-bar todo overdue"/);
});

test('all relevant display caches refresh within a five-minute bucket as time passes', () => {
  const {api,setTime} = harness([], '2026-10-25T18:01:00');
  const views = ['today','todos','calendar'];
  const modes = ['week','month'];
  const before = views.map(view=>api.viewRenderKey(view));
  const panes = modes.map(mode=>api.calendarPaneKey(mode));
  setTime('2026-10-25T18:02:00');
  views.forEach((view,index)=>assert.notEqual(api.viewRenderKey(view),before[index],view));
  modes.forEach((mode,index)=>assert.notEqual(api.calendarPaneKey(mode),panes[index],mode));
});

test('repeating Todo becomes overdue in place until the user records its result', () => {
  const recurring = {...task,repeatMode:'weekly',repeatWeekdays:[0]};
  const {api} = harness([recurring], '2026-10-25T18:01:00');
  assert.equal(api.itemIndex().overdue[0].id, recurring.id);
  assert.equal(recurring.date, '2026-10-25');
  assert.equal(recurring.done, false);
});
