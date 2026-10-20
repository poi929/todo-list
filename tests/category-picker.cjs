const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)][0][1].replace(/\n    initUi\(\);/,'');
const parents = [
  {id:'club',name:'サークル',children:[{id:'archery',name:'弓道部'},{id:'club-other',name:'その他'}]},
  {id:'class',name:'授業',children:[{id:'english',name:'英語'},{id:'math',name:'数学ＡＢＣ'},{id:'class-other',name:'その他'}]}
];
function harness(data=parents) {
  const select={options:[],_value:''};
  Object.defineProperties(select,{
    value:{get(){return this._value;},set(value){this._value=this.options.some(option=>option.value===value)?value:'';}},
    selectedOptions:{get(){return this.options.filter(option=>option.value===this._value);}}
  });
  const button={innerHTML:''};
  const nodes={'#itemCategory':select,'#itemCategoryButton':button};
  const context=vm.createContext({console,structuredClone,URL,setTimeout,clearTimeout,window:{},navigator:{},localStorage:{getItem:()=>null,length:0,key:()=>null},document:{getElementById:()=>null,querySelector:selector=>nodes[selector]}});
  vm.runInContext(script,context);
  vm.runInContext(`globalThis.api={itemCategoryChoices,filterCategoryChoices,chooseItemCategory,readItemCategory,
    setParents:parents=>state.parents=parents,getParents:()=>state.parents};`,context);
  context.api.setParents(structuredClone(data));
  context.closeSheet=id=>{context.closedSheet=id;};
  return {api:context.api,context,select,button};
}

test('choices retain parent and child IDs, including children with identical names',()=>{
  const {api}=harness();
  const choices=api.itemCategoryChoices();
  assert.deepEqual(Array.from(choices.filter(choice=>choice.childName==='その他'),choice=>[choice.parentId,choice.childId]),[['club','club-other'],['class','class-other']]);
  assert.equal(api.getParents().length,2);
});

test('missing category references remain available without changing their parent',()=>{
  const {api}=harness();
  const choice=api.itemCategoryChoices('deleted-child','deleted-parent')[0];
  assert.equal(choice.childId,'deleted-child');
  assert.equal(choice.parentId,'deleted-parent');
  assert.equal(choice.orphan,true);
});

test('empty categories offer unclassified without creating data until save',()=>{
  const {api}=harness([]);
  const choices=api.itemCategoryChoices('__uncategorized__');
  assert.equal(choices.length,1);
  assert.equal(choices[0].childId,'__uncategorized__');
  assert.equal(api.getParents().length,0);
});

test('existing unclassified category appears once, while an empty parent still has a choice',()=>{
  const {api}=harness([{id:'uncategorized',name:'未分類',children:[{id:'uncategorized-general',name:'未分類'}]}]);
  assert.equal(api.itemCategoryChoices().length,1);
  api.setParents([{id:'uncategorized',name:'未分類',children:[]}]);
  assert.equal(api.itemCategoryChoices()[0].childId,'__uncategorized__');
});

test('parent filtering narrows the choices by ID',()=>{
  const {api}=harness();
  const matches=api.filterCategoryChoices(api.itemCategoryChoices(),'','club');
  assert.deepEqual(Array.from(matches,choice=>choice.childId),['archery','club-other']);
});

test('search matches full-width text and multiple terms across parent and child names',()=>{
  const {api}=harness();
  assert.deepEqual(Array.from(api.filterCategoryChoices(api.itemCategoryChoices(),'授業 abc'),choice=>choice.childId),['math']);
  assert.equal(api.filterCategoryChoices(api.itemCategoryChoices(),'存在しない').length,0);
});

test('search covers all parents even after a parent has been selected',()=>{
  const {api}=harness();
  assert.deepEqual(Array.from(api.filterCategoryChoices(api.itemCategoryChoices(),'英語','club'),choice=>choice.childId),['english']);
});

test('choosing a category updates the button and preserves the correct save destination',()=>{
  const {api,context,select,button}=harness();
  select.options=[{value:'english',dataset:{parentName:'授業',childName:'英語'}}];
  api.chooseItemCategory('english');
  assert.equal(select.value,'english');
  assert.match(button.innerHTML,/授業/);
  assert.match(button.innerHTML,/英語/);
  const result=api.readItemCategory();
  assert.equal(result.parentId,'class');
  assert.equal(result.childId,'english');
  assert.equal(context.closedSheet,'categoryPickerSheet');
});

test('deleted and unknown choices cannot silently switch to another category',()=>{
  const {api,context,select}=harness();
  select.options=[{value:'deleted-child',dataset:{parentName:'現在の選択',childName:'（削除されたカテゴリ）',orphanParent:'deleted-parent'}}];
  api.chooseItemCategory('deleted-child');
  assert.equal(api.readItemCategory().parentId,'deleted-parent');
  context.closedSheet=null;
  api.chooseItemCategory('not-an-option');
  assert.equal(select.value,'deleted-child');
  assert.equal(context.closedSheet,null);
});
