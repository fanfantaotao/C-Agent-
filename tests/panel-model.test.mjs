import test from 'node:test';
import assert from 'node:assert/strict';
import {agentPanelId,filePanelId,createPanelState,panelReducer} from '../src/panelModel.js';

const agent = (id='agent:run:papers') => ({id,type:'agent',title:'论文检索',runId:'run',agentId:'papers'});
const file = (id='file:report') => ({id,type:'file',title:'研究报告',fileId:'report',html:'<p>报告</p>'});
const open = (state,tab) => panelReducer(state,{type:'OPEN',tab});

test('empty workspace has no active tab or collapsed rail',()=>{
  assert.deepEqual(createPanelState(),{tabs:[],activeId:null,collapsed:false});
});

test('clearing a conversation removes every tab and resets panel visibility',()=>{
  const state=panelReducer(open(open(createPanelState(),agent()),file()),{type:'TOGGLE_COLLAPSE'});
  assert.deepEqual(panelReducer(state,{type:'CLEAR'}),createPanelState());
});

test('agent and file tabs share one workspace and stable identity includes both run and agent',()=>{
  assert.notEqual(agentPanelId('first','papers'),agentPanelId('second','papers'));
  assert.notEqual(agentPanelId('a:b','c'),agentPanelId('a','b:c'));
  assert.equal(filePanelId('research report.md'),'file:research%20report.md');
  const state=open(open(createPanelState(),agent()),file());
  assert.equal(state.tabs.length,2);
  assert.equal(state.activeId,'file:report');
});

test('opening an existing tab refreshes and activates it without duplicating it',()=>{
  const initial=open(open(createPanelState(),file()),agent());
  const next=open(initial,{...file(),html:'<p>更新结果</p>'});
  assert.equal(next.tabs.length,2);
  assert.equal(next.activeId,'file:report');
  assert.equal(next.tabs[0].html,'<p>更新结果</p>');
  assert.equal(initial.tabs[0].html,'<p>报告</p>');
});

test('collapse preserves tabs and current tab; activating or reopening expands',()=>{
  const initial=open(open(createPanelState(),agent()),file());
  const folded=panelReducer(initial,{type:'TOGGLE_COLLAPSE'});
  assert.equal(folded.collapsed,true);
  assert.equal(folded.tabs,initial.tabs);
  assert.equal(folded.activeId,initial.activeId);
  assert.equal(panelReducer(folded,{type:'ACTIVATE',id:'agent:run:papers'}).collapsed,false);
  assert.equal(open(folded,file()).collapsed,false);
});

test('closing active tab selects its right neighbor and falls back to the left',()=>{
  let state=open(open(open(createPanelState(),agent('a')),file('b')),agent('c'));
  state=panelReducer(state,{type:'ACTIVATE',id:'b'});
  state=panelReducer(state,{type:'CLOSE',id:'b'});
  assert.equal(state.activeId,'c');
  state=panelReducer(state,{type:'CLOSE',id:'c'});
  assert.equal(state.activeId,'a');
});

test('closing inactive tab preserves selection, and final close removes the workspace',()=>{
  let state=open(open(createPanelState(),agent()),file());
  state=panelReducer(state,{type:'CLOSE',id:'agent:run:papers'});
  assert.equal(state.activeId,'file:report');
  state=panelReducer(state,{type:'TOGGLE_COLLAPSE'});
  state=panelReducer(state,{type:'CLOSE',id:'file:report'});
  assert.deepEqual(state,createPanelState());
});

test('unknown selection, close, event, and invalid tab never corrupt state',()=>{
  const initial=open(createPanelState(),agent());
  for (const action of [{type:'ACTIVATE',id:'missing'},{type:'CLOSE',id:'missing'},{type:'UNKNOWN'},{type:'OPEN',tab:{type:'agent'}},{type:'OPEN',tab:{id:'wrong',type:'log'}}]) {
    assert.equal(panelReducer(initial,action),initial);
  }
  const empty=createPanelState();
  assert.equal(panelReducer(empty,{type:'TOGGLE_COLLAPSE'}),empty);
});
