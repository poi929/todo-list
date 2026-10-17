const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
scripts.forEach(script => new vm.Script(script));
const context = vm.createContext({
  console, structuredClone, URL, setTimeout, clearTimeout,
  Date: class extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-17T12:00:00+09:00'])); }
    static now() { return Date.parse('2026-10-17T12:00:00+09:00'); }
  },
  localStorage: { getItem: () => null, length: 0, key: () => null },
  window: {}, navigator: {}, document: { getElementById: () => null }
});
vm.runInContext(scripts[0].replace(/\n    initUi\(\);/, ''), context);
vm.runInContext(`globalThis.api = { nextTodoDueDate, isEventOnDate, eventOccurrenceRangeOnDate,
  eventRepeatLabel, todoRepeatLabel, normalizeParsedState, normalizeRepeatWeekdays, initialState,
  runSelfTests, nextRepeatWeekdayDate, splitWeeklyTodo, isRecurringTodo, isVisibleInMonthGrid,
  compareMonthTodoEntries, monthWeekLayout, mapLegacyView, defaultAddDate,
  viewRenderKey, toggleTodo, renderToday, renderCalendarMonth, showToast, hideToast,
  setTodos: todos => { state.todos = todos; dataVersion += 1; },
  setState: patch => Object.assign(state, patch), getState: () => state };`, context);
const api = context.api;
let passed = 0;
function test(name, fn) { fn(); passed += 1; console.log('PASS ' + name); }
const days = [1, 3, 5];
const todo = { id: 'weekly-test', kind: 'todo', date: '2026-10-19', repeatMode: 'weekly', repeatWeekdays: days };
const event = { ...todo, kind: 'event', endDate: todo.date };

test('Mon, Wed and Fri Todo have independent weekly deadlines', () => {
  const branches = api.splitWeeklyTodo(todo);
  assert.deepEqual(Array.from(branches, item => item.date), ['2026-10-19', '2026-10-21', '2026-10-23']);
  assert.equal(new Set(branches.map(item => item.id)).size, 3);
  assert.equal(branches[0].id, todo.id);
  assert.equal(api.nextTodoDueDate(branches[0], '2026-10-19'), '2026-10-26');
  assert.equal(branches[1].date, '2026-10-21');
  assert.equal(api.nextTodoDueDate(branches[1], '2026-10-21'), '2026-10-28');
  assert.equal(api.nextTodoDueDate(branches[2], '2026-10-23'), '2026-10-30');
});
test('overdue completion skips past weeks for the same weekday', () => assert.equal(api.nextTodoDueDate(todo, '2026-11-03'), '2026-11-09'));
test('early completion advances the same weekday', () => assert.equal(api.nextTodoDueDate(todo, '2026-10-17'), '2026-10-26'));
test('end date is inclusive', () => {
  assert.equal(api.nextTodoDueDate({ ...todo, repeatUntil: '2026-10-26' }, '2026-10-19'), '2026-10-26');
  assert.equal(api.nextTodoDueDate({ ...todo, repeatUntil: '2026-10-25' }, '2026-10-19'), '');
});
test('single Sunday wraps across year', () => assert.equal(api.nextTodoDueDate({ ...todo, date: '2026-12-27', repeatWeekdays: [0] }, '2026-12-27'), '2027-01-03'));
test('all seven weekdays create seven independent Todo', () => assert.equal(api.splitWeeklyTodo({ ...todo, repeatWeekdays: [0, 1, 2, 3, 4, 5, 6] }).length, 7));
test('no branch starts after the repeat end', () => {
  assert.equal(api.splitWeeklyTodo({ ...todo, repeatUntil: '2026-10-20' }).length, 1);
  assert.equal(api.splitWeeklyTodo({ ...todo, done: true }).length, 1);
});
test('events appear on selected weekdays only, after the start', () => {
  for (const [date, expected] of [['2026-10-16', false], ['2026-10-19', true], ['2026-10-20', false], ['2026-10-21', true], ['2026-10-23', true], ['2026-10-25', false], ['2026-10-26', true]]) {
    assert.equal(api.isEventOnDate(event, date), expected, date);
  }
});
test('unselected start is only a lower bound for events', () => {
  const item = { ...event, date: '2026-10-20', endDate: '2026-10-20' };
  assert.equal(api.isEventOnDate(item, '2026-10-20'), false);
  assert.equal(api.isEventOnDate(item, '2026-10-21'), true);
});
test('single-occurrence exclusions preserve other selected days', () => {
  const item = { ...event, exceptionDates: ['2026-10-21'] };
  assert.equal(api.isEventOnDate(item, '2026-10-21'), false);
  assert.equal(api.isEventOnDate(item, '2026-10-23'), true);
  assert.equal(api.isEventOnDate(item, '2026-10-28'), true);
});
test('multi-day events continue through their end date', () => {
  const item = { ...event, endDate: '2026-10-20', repeatUntil: '2026-10-21' };
  assert.equal(api.isEventOnDate(item, '2026-10-22'), true);
  assert.equal(api.isEventOnDate(item, '2026-10-23'), false);
  assert.equal(api.eventOccurrenceRangeOnDate(item, '2026-10-22').startDate, '2026-10-21');
});
test('overlapping occurrences survive exclusion of an earlier span', () => {
  const item = { ...event, endDate: '2026-10-22', exceptionDates: ['2026-10-19'] };
  assert.equal(api.isEventOnDate(item, '2026-10-20'), false);
  assert.equal(api.eventOccurrenceRangeOnDate(item, '2026-10-22').startDate, '2026-10-21');
});
test('legacy weekly data keeps original weekday', () => {
  const { repeatWeekdays, ...legacy } = todo;
  assert.equal(api.nextTodoDueDate(legacy, '2026-10-19'), '2026-10-26');
  assert.equal(api.isEventOnDate({ ...legacy, kind: 'event' }, '2026-10-21'), false);
});
test('loading and JSON round-trip preserve weekdays', () => {
  const saved = JSON.parse(JSON.stringify({ ...api.initialState, todos: [todo, event] }));
  const loaded = api.normalizeParsedState(saved).loaded;
  assert.equal(loaded.todos.length, 4);
  assert.deepEqual(Array.from(loaded.todos[0].repeatWeekdays), [1]);
  assert.deepEqual(Array.from(loaded.todos[1].repeatWeekdays), [3]);
  assert.deepEqual(Array.from(loaded.todos[2].repeatWeekdays), [5]);
  assert.deepEqual(Array.from(loaded.todos[3].repeatWeekdays), days);
  const again = api.normalizeParsedState(JSON.parse(JSON.stringify(loaded))).loaded;
  assert.deepEqual(Array.from(again.todos, item => item.id), Array.from(loaded.todos, item => item.id));
});
test('old and malformed imported data normalize safely', () => {
  const { repeatWeekdays, ...legacy } = todo;
  const loaded = api.normalizeParsedState({ ...api.initialState, todos: [legacy, { ...todo, repeatWeekdays: [5, 3, 3, 0, -1, 7, '1', null] }, { ...todo, repeatMode: 'monthly' }] }).loaded.todos;
  assert.deepEqual(Array.from(loaded[0].repeatWeekdays), [1]);
  assert.deepEqual(Array.from(loaded.slice(1, 4), item => Array.from(item.repeatWeekdays)), [[3], [5], [0]]);
  assert.equal('repeatWeekdays' in loaded[4], false);
});
test('labels include selected weekdays', () => {
  assert.match(api.todoRepeatLabel(todo), /毎週（月・水・金）/);
  assert.match(api.eventRepeatLabel(event), /毎週（月・水・金）/);
});
test('daily, biweekly, monthly and non-repeating Todo still work', () => {
  assert.equal(api.nextTodoDueDate({ ...todo, repeatMode: 'daily' }, '2026-10-19'), '2026-10-20');
  assert.equal(api.nextTodoDueDate({ ...todo, repeatMode: 'biweekly' }, '2026-10-19'), '2026-11-02');
  assert.equal(api.nextTodoDueDate({ ...todo, repeatMode: 'monthly', date: '2026-02-28', repeatAnchor: '2026-01-31' }, '2026-02-28'), '2026-03-31');
  assert.equal(api.nextTodoDueDate({ ...todo, repeatMode: 'none' }, '2026-10-19'), '');
});
test('other event frequencies keep their existing schedules', () => {
  assert.equal(api.isEventOnDate({ ...event, repeatMode: 'daily' }, '2026-10-20'), true);
  assert.equal(api.isEventOnDate({ ...event, repeatMode: 'biweekly' }, '2026-10-26'), false);
  assert.equal(api.isEventOnDate({ ...event, repeatMode: 'biweekly' }, '2026-11-02'), true);
  assert.equal(api.isEventOnDate({ ...event, repeatMode: 'monthly' }, '2026-11-19'), true);
  assert.equal(api.isEventOnDate({ ...event, repeatMode: 'none' }, '2026-10-21'), false);
});
test('completing Monday leaves Wednesday and Friday untouched; undo restores all', () => {
  const tasks = api.splitWeeklyTodo({ ...todo });
  api.setTodos(tasks);
  const renderAll = context.renderAll;
  const showToast = context.showToast;
  context.renderAll = () => {};
  context.showToast = (message, undo) => { context.lastUndo = undo; };
  try {
    api.toggleTodo(tasks[0].id);
    assert.equal(tasks[0].date, '2026-10-26');
    assert.equal(tasks[1].date, '2026-10-21');
    assert.equal(tasks[2].date, '2026-10-23');
    const history = api.getState().todos.find(item => item.done);
    assert.equal(history.date, '2026-10-19');
    assert.equal(history.repeatSourceId, tasks[0].id);
    context.lastUndo();
    assert.equal(tasks[0].date, '2026-10-19');
    assert.equal(api.getState().todos.length, 3);
  } finally { context.renderAll = renderAll; context.showToast = showToast; }
});
test('month sorts by importance, then puts recurring Todo last within that importance', () => {
  const task = (id, importance, repeatMode = 'none', deadlineTime = '', done = false) => ({ ...todo, id, importance, repeatMode, repeatWeekdays: [1], deadlineTime, done });
  const tasks = [task('low-repeat', '低', 'weekly'), task('medium-repeat', '中', 'weekly', '06:00'), task('low-single', '低'), task('high-repeat', '高', 'weekly', '05:00'), task('medium-single', '中', 'none', '23:00'), task('high-single', '高', 'none', '23:59', true)];
  api.setTodos(tasks);
  const dates = ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];
  const layout = api.monthWeekLayout(dates, 20);
  assert.deepEqual(Array.from(layout.placed).sort((a,b) => a.lane - b.lane).map(item => item.todo.id), ['high-single', 'high-repeat', 'medium-single', 'medium-repeat', 'low-single']);
  assert.equal(Array.from(layout.hidden).reduce((a,b) => a+b, 0), 0);
});
test('month grid hides low repeating Todo, while low single Todo and events remain visible', () => {
  assert.equal(api.isVisibleInMonthGrid({ ...todo, importance: '低' }), false);
  assert.equal(api.isVisibleInMonthGrid({ ...todo, importance: '低', repeatMode: 'none', done: true, repeatSourceId: 'original' }), false);
  assert.equal(api.isVisibleInMonthGrid({ ...todo, importance: '低', repeatMode: 'none' }), true);
  assert.equal(api.isVisibleInMonthGrid({ ...event, importance: '低' }), true);
});

test('selected-day list below month grid includes low recurring Todo in priority order', () => {
  const nodes = new Map();
  const makeNode = () => ({ innerHTML:'', childElementCount:1,
    getBoundingClientRect: () => ({top:200, bottom:240, height:40}) });
  const node = selector => { if (!nodes.has(selector)) nodes.set(selector, makeNode()); return nodes.get(selector); };
  const doc = context.document;
  const win = context.window;
  context.document = { ...doc, querySelector:node, getElementById:id => node('#'+id), querySelectorAll:() => [] };
  context.window = { ...win, innerWidth:390, innerHeight:844, scrollY:0 };
  api.setTodos([
    { ...todo, id:'low-repeat', title:'low-recurring-task', importance:'低', repeatWeekdays:[1] },
    { ...todo, id:'low-single', title:'low-single-task', importance:'低', repeatMode:'none' },
    { ...todo, id:'high-single', title:'high-single-task', importance:'高', repeatMode:'none' }
  ]);
  api.setState({selectedDate:'2026-10-19', calendarMode:'month', showClassesInTimeline:false});
  try {
    api.renderCalendarMonth('2026-10-01');
    const [grid, agenda] = node('#calPane-month').innerHTML.split('<div class="month-agenda">');
    assert.doesNotMatch(grid, /low-recurring-task/);
    assert.match(grid, /low-single-task/);
    assert.match(agenda, /low-recurring-task/);
    assert.ok(agenda.indexOf('high-single-task') < agenda.indexOf('low-single-task'));
    assert.ok(agenda.indexOf('low-single-task') < agenda.indexOf('low-recurring-task'));
  } finally { context.document = doc; context.window = win; }
});
test('hidden low recurring Todo do not inflate month overflow counts', () => {
  api.setTodos([{ ...todo, repeatWeekdays:[1], importance: '低' }]);
  const layout = api.monthWeekLayout(['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'], 1);
  assert.equal(layout.placed.length, 0);
  assert.equal(Array.from(layout.hidden).reduce((a,b) => a+b, 0), 0);
});
test('old day navigation migrates to the combined overview', () => {
  const navigation = { view:'calendar', calendarMode:'day', selectedDate:'2026-10-21' };
  api.mapLegacyView(navigation);
  assert.equal(navigation.view, 'today');
  assert.equal(navigation.calendarMode, 'week');
  assert.equal(navigation.selectedDate, '2026-10-21');
});
test('overview date controls add date and changes the render cache key', () => {
  api.setState({view:'today', selectedDate:'2026-10-21'});
  const key = api.viewRenderKey('today');
  assert.equal(api.defaultAddDate(), '2026-10-21');
  api.setState({selectedDate:'2026-10-22'});
  assert.notEqual(api.viewRenderKey('today'), key);
  assert.equal(api.defaultAddDate(), '2026-10-22');
});
test('combined overview shows the selected date without an empty hourly grid', () => {
  const nodes = new Map();
  const makeNode = () => ({textContent:'', value:'', innerHTML:'', classList:{toggle(){}}, setAttribute(){}});
  const doc = context.document;
  context.document = { ...doc, querySelector: selector => { if(!nodes.has(selector)) nodes.set(selector, makeNode()); return nodes.get(selector); } };
  api.setTodos([{ ...todo, repeatMode:'none', date:'2026-10-22', title:'selected-day-task' }, { ...event, repeatMode:'none', date:'2026-10-22', endDate:'2026-10-22', title:'selected-day-event', startTime:'23:00', endTime:'23:30' }]);
  api.setState({view:'today', selectedDate:'2026-10-22', showClassesInTimeline:false});
  try {
    api.renderToday();
    const content = nodes.get('#todayContent').innerHTML;
    assert.match(content, /selected-day-task/);
    assert.match(content, /selected-day-event/);
    assert.match(content, /この日のスケジュール/);
    assert.doesNotMatch(content, /timeline-scroll|height:.*px|now-divider/);
    assert.equal(nodes.get('#overviewDateInput').value, '2026-10-22');
  } finally { context.document = doc; }
});
test('existing app assertions pass', () => {
  // initUi normally migrates the legacy initial view before running these assertions.
  vm.runInContext('state.view = "todos";', context);
  const previous = context.console;
  context.console = { ...console, assert: (value, message) => assert.ok(value, message) };
  try { api.runSelfTests(); } finally { context.console = previous; }
});
console.log(`${passed} tests passed; all inline scripts parsed successfully.`);
