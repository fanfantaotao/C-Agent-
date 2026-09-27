import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createPanelState,panelReducer,agentPanelId,filePanelId} from '../src/panelModel.js';
import {createExecution} from '../src/executionModel.js';

// SSR verifies the rendered DOM contract only. Browser focus, preserved scroll
// and actual component lifetime require the separate in-app interaction QA.
const require=createRequire(import.meta.url);
const compiled=await build({entryPoints:['src/WorkbenchPanel.jsx'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
let code=compiled.outputFiles[0].text;
for (const dependency of ['react','lucide-react']) code=code.replaceAll('"'+dependency+'"',JSON.stringify(pathToFileURL(require.resolve(dependency)).href));
const {default:WorkbenchPanel}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));

const agentTab={id:agentPanelId('run','papers'),type:'agent',title:'论文检索',runId:'run',agentId:'papers'};
const fileTab={id:filePanelId('report.md'),type:'file',title:'研究报告',fileId:'report.md',fileName:'report.md',html:'<p>file-visible-content</p>'};
const open=(state,tab)=>panelReducer(state,{type:'OPEN',tab});
const both=()=>open(open(createPanelState(),agentTab),fileTab);
const snapshot=(status='running',summary='正在核对证据')=>{
  const agent={id:'papers',name:'论文检索',kind:'profile',task:'child-assignment',status,summary,entries:[{id:'child-note',type:'commentary',text:summary}]};
  return {...createExecution({id:'run'}),agents:[agent]};
};
const initialExecution=snapshot();
const resolve=tab=>({execution:initialExecution,agent:initialExecution.agents.find(agent=>agent.id===tab.agentId)});
const render=(state,extra={})=>renderToStaticMarkup(React.createElement(WorkbenchPanel,{state,onDispatch(){},resolveAgent:resolve,onDownloadFile(){},onQuoteFile(){},...extra}));
const panelHeaders=markup=>[...markup.matchAll(/<div class="workbench-tabpanel"([^>]*)>/g)].map(match=>match[1]);

test('empty workspace renders no panel or rail',()=>{
  assert.equal(render(createPanelState()),'');
});

test('agent and file use one non-modal tablist with matching tabpanel relationships',()=>{
  const markup=render(both());
  assert.equal([...markup.matchAll(/role="tablist"/g)].length,1);
  assert.equal([...markup.matchAll(/role="tab"/g)].length,2);
  assert.equal([...markup.matchAll(/role="tabpanel"/g)].length,2);
  assert.doesNotMatch(markup,/aria-modal=|role="dialog"|trace-detail-overlay/);
  assert.match(markup,/<aside[^>]*aria-label="右侧工作区"/);
  const tabAttributes=[...markup.matchAll(/<button[^>]*role="tab"([^>]*)>/g)].map(match=>match[1]);
  const headers=panelHeaders(markup);
  tabAttributes.forEach((attributes,index)=>{
    const id=attributes.match(/\bid="([^"]+)"/)[1];
    const controlledId=attributes.match(/\baria-controls="([^"]+)"/)[1];
    assert.ok(headers[index].includes('id="'+controlledId+'"'));
    assert.ok(headers[index].includes('aria-labelledby="'+id+'"'));
  });
});

test('inactive tab retains its detail content inside a hidden tabpanel',()=>{
  const markup=render(both());
  const headers=panelHeaders(markup);
  assert.equal(headers.length,2);
  assert.match(headers[0],/hidden=""/);
  assert.doesNotMatch(headers[1],/hidden=/);
  assert.match(markup,/child-assignment/);
  assert.match(markup,/file-visible-content/);
  const activeAgent=panelReducer(both(),{type:'ACTIVATE',id:agentTab.id});
  const switched=render(activeAgent);
  assert.doesNotMatch(panelHeaders(switched)[0],/hidden=/);
  assert.match(panelHeaders(switched)[1],/hidden=""/);
  assert.match(switched,/file-visible-content/);
});

test('collapsed panel keeps content in a hidden expanded subtree and exposes its rail',()=>{
  const collapsed=panelReducer(both(),{type:'TOGGLE_COLLAPSE'});
  const markup=render(collapsed);
  assert.match(markup,/data-workbench-state="collapsed"/);
  assert.match(markup,/<div class="workbench-expanded" hidden="">/);
  assert.match(markup,/<div class="workbench-collapsed-rail">/);
  assert.match(markup,/aria-label="展开右侧工作区"/);
  assert.match(markup,/aria-label="2 个已打开标签页"/);
  assert.match(markup,/child-assignment/);
  assert.match(markup,/file-visible-content/);
});

test('agent detail renders the newly resolved execution instead of a tab-open snapshot',()=>{
  const state=open(createPanelState(),agentTab);
  let execution=snapshot('running','first-live-summary');
  const liveResolver=tab=>{
    assert.equal(tab.runId,'run');
    assert.equal(tab.agentId,'papers');
    return {execution,agent:execution.agents[0]};
  };
  const first=render(state,{resolveAgent:liveResolver});
  assert.match(first,/first-live-summary/);
  assert.doesNotMatch(first,/返回给主责的结果/);
  execution=snapshot('success','new-completed-summary');
  const second=render(state,{resolveAgent:liveResolver});
  assert.match(second,/new-completed-summary/);
  assert.match(second,/返回给主责的结果/);
  assert.doesNotMatch(second,/first-live-summary/);
  assert.deepEqual(state.tabs[0],agentTab);
});

test('unresolved agent shows an unavailable-record state without borrowing another agent',()=>{
  const markup=render(open(createPanelState(),agentTab),{resolveAgent:()=>({execution:initialExecution,agent:null})});
  assert.match(markup,/这条子任务记录暂不可用/);
  assert.doesNotMatch(markup,/child-assignment|trace-detail-identity/);
});
