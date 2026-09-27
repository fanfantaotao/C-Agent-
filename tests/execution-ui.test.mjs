import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createExecution,getDemoExecution,reduceExecution} from '../src/executionModel.js';

const require = createRequire(import.meta.url);
const compiled = await build({entryPoints:['src/ExecutionTrace.jsx'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
let code = compiled.outputFiles[0].text;
for (const dependency of ['react','lucide-react']) code=code.replaceAll('"'+dependency+'"',JSON.stringify(pathToFileURL(require.resolve(dependency)).href));
const {default:ExecutionTrace,AgentDetail}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component,props));

test('main thread shows agent summaries, not child commentary or tool titles',()=>{
  const execution=getDemoExecution({id:'test',phase:4});
  const markup=render(ExecutionTrace,{execution});
  assert.match(markup,/论文检索/);
  assert.match(markup,/已整理候选论文与证据缺口/);
  assert.doesNotMatch(markup,/检索稳定性相关论文/);
  assert.doesNotMatch(markup,/我会围绕界面退化/);
});

test('phase 3 groups one active and one ended agent without calling the entire task done',()=>{
  const execution=getDemoExecution({id:'test',phase:3});
  const markup=render(ExecutionTrace,{execution});
  assert.match(markup,/进行中/);
  assert.match(markup,/已结束/);
  assert.match(markup,/执行中/);
});

test('selected child detail contains only its own public flow and assignment',()=>{
  const execution=getDemoExecution({id:'test',phase:4});
  const agent=execution.agents.find(a=>a.id==='papers');
  const markup=render(AgentDetail,{agent,execution,onClose(){}});
  assert.match(markup,/整理稳定性研究的代表性论文/);
  assert.match(markup,/我会围绕界面退化/);
  assert.doesNotMatch(markup,/我会从现有实验条件/);
  assert.match(markup,/详情只读/);
});

test('direct run has one professional owner, no child rows or main-controller attribution',()=>{
  const execution=getDemoExecution({id:'direct',mode:'direct',owner:'材料科学专家',phase:2});
  const markup=render(ExecutionTrace,{execution});
  assert.match(markup,/材料科学专家的执行过程/);
  assert.doesNotMatch(markup,/trace-agent-row|由 MushSCI 委派/);
});

test('SSE done still renders confirmation status',()=>{
  const execution=getDemoExecution({id:'confirm',phase:5});
  const markup=render(ExecutionTrace,{execution});
  assert.match(markup,/确认结果中/);
  assert.match(markup,/等待任务完成确认/);
});

test('only artifact-backed entries with safe downloadable URLs get download links',()=>{
  const execution=getDemoExecution({id:'artifact',phase:2});
  execution.artifacts=[{id:'saved',name:'已保存报告',downloadUrl:'https://example.test/report.md'},{id:'unsaved',name:'沙箱文件'}];
  const markup=render(ExecutionTrace,{execution});
  assert.match(markup,/已保存报告/);
  assert.doesNotMatch(markup,/沙箱文件/);
});

test('safe local errors are visible without forcing the task into a failed state',()=>{
  const execution=reduceExecution(createExecution({id:'warning'}),{type:'error',publicMessage:'部分资料访问受限，其他工作仍在继续'});
  const markup=render(ExecutionTrace,{execution});
  assert.match(markup,/部分资料访问受限/);
  assert.match(markup,/执行中/);
});

test('unknown child ownership explains the synchronization gap without leaking child tools',()=>{
  const execution=reduceExecution(createExecution({id:'unknown'}),{type:'tool_pending',agentRunId:'not-yet-known',toolCallId:'hidden-child',title:'不应出现在主流的工具'});
  const markup=render(ExecutionTrace,{execution});
  assert.match(markup,/等待确认该 Agent 的信息/);
  assert.doesNotMatch(markup,/不应出现在主流的工具/);
});

test('temporary worker has a persistent entry and its creation label appears only in detail',()=>{
  let execution=reduceExecution(createExecution({id:'worker'}),{type:'agent_created',agentRunId:'helper',kind:'temp',name:'文献整理助手',task:'整理已有论文摘要'});
  execution=reduceExecution(execution,{type:'tool_pending',agentRunId:'helper',toolCallId:'read',title:'读取 研究材料.pdf',kind:'file'});
  const main=render(ExecutionTrace,{execution});
  assert.match(main,/文献整理助手/);
  assert.doesNotMatch(main,/临时创建|正在读取 研究材料.pdf/);
  let detail=render(AgentDetail,{execution,agent:execution.agents[0]});
  assert.match(detail,/临时创建/);
  assert.match(detail,/正在读取 研究材料.pdf/);
  execution=reduceExecution(execution,{type:'tool_result',agentRunId:'helper',toolCallId:'read',result:{ok:true}});
  execution=reduceExecution(execution,{type:'agent_status',agentRunId:'helper',status:'success',summary:'摘要整理完成'});
  assert.match(render(ExecutionTrace,{execution}),/文献整理助手/);
  detail=render(AgentDetail,{execution,agent:execution.agents[0]});
  assert.match(detail,/执行记录已保留/);
});

test('current action and its disclosure use the same file wording without book-title brackets',()=>{
  let execution=reduceExecution(createExecution({id:'read'}),{type:'tool_pending',toolCallId:'read',title:'读取 研究材料.pdf',kind:'file'});
  let markup=render(ExecutionTrace,{execution});
  assert.match(markup,/正在读取 研究材料.pdf/);
  assert.doesNotMatch(markup,/《研究材料.pdf》/);
  execution=reduceExecution(execution,{type:'tool_result',toolCallId:'read',result:{ok:true}});
  markup=render(ExecutionTrace,{execution});
  assert.match(markup,/已读取 研究材料.pdf/);
  assert.doesNotMatch(markup,/正在读取 研究材料.pdf/);
  assert.doesNotMatch(markup,/class="spin"/,'a completed current action must stop spinning even while the overall task is processing');
});

test('waiting state shows a frozen elapsed label without a running spinner',()=>{
  const execution={...createExecution({id:'waiting',startedAt:1000}),status:'waiting',current:'等待你补充研究主题',pausedAt:6000};
  const markup=render(ExecutionTrace,{execution});
  assert.match(markup,/等待你补充研究主题/);
  assert.match(markup,/已用时 5秒/);
  assert.doesNotMatch(markup,/class="spin"/);
});

test('whole-task waiting pauses unfinished step animation without falsely completing its record',()=>{
  let execution=reduceExecution(createExecution({id:'waiting-call',startedAt:1000}),{type:'tool_pending',toolCallId:'read',title:'读取 研究材料.pdf',at:2000});
  execution=reduceExecution(execution,{type:'message_status',status:'waiting',current:'等待你补充文件密码',at:6000});
  const markup=render(ExecutionTrace,{execution});
  assert.equal(execution.tools[0].status,'running');
  assert.match(markup,/等待补充后继续 读取 研究材料.pdf/);
  assert.doesNotMatch(markup,/class="spin"|已读取 研究材料.pdf/);
});

test('waiting the whole task also pauses the selected child detail',()=>{
  let execution=reduceExecution(createExecution({id:'waiting-child'}),{type:'agent_created',agentRunId:'child',name:'文献整理助手',kind:'temp'});
  execution=reduceExecution(execution,{type:'tool_pending',agentRunId:'child',toolCallId:'read',title:'读取 研究材料.pdf'});
  execution=reduceExecution(execution,{type:'message_status',status:'waiting'});
  const markup=render(AgentDetail,{execution,agent:execution.agents[0]});
  assert.match(markup,/等待你补充/);
  assert.doesNotMatch(markup,/class="spin"/);
  assert.equal(execution.agents[0].status,'processing');
});

test('robot submission is not rendered as completed physical work',()=>{
  let execution=reduceExecution(createExecution({id:'robot'}),{type:'tool_pending',toolCallId:'robot-submit',title:'提交机器人指令'});
  execution=reduceExecution(execution,{type:'tool_result',toolCallId:'robot-submit',result:{success:true,code:'ROBOT_E3'}});
  execution.warnings=[{id:'attention',message:'机器人动作状态尚未同步'}];
  // The main summary is quiet and remains inspectable; underlying outcome is submitted.
  const markup=render(ExecutionTrace,{execution});
  assert.equal(execution.tools[0].status,'submitted');
  assert.match(markup,/机器人动作状态尚未同步/);
  assert.doesNotMatch(markup,/机器人动作已完成/);
});
