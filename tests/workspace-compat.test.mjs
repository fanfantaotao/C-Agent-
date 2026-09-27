import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';

const require = createRequire(import.meta.url);
const compiled = await build({entryPoints:['src/AgentRoster.jsx'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
let code = compiled.outputFiles[0].text;
for (const dependency of ['react','lucide-react']) code=code.replaceAll('"'+dependency+'"',JSON.stringify(pathToFileURL(require.resolve(dependency)).href));
const {default:AgentRoster}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const roster = [
  {id:'mushsci',name:'mushsci',kind:'main',desc:'主控协调'},
  {id:'papers',name:'论文检索',kind:'profile',desc:'学术检索',direction:'材料科学',tags:['稳定性']},
  {id:'official',name:'配置的官方应用',kind:'official',desc:'产品配置的应用'},
  {id:'temporary',name:'后台临时助手',kind:'temp',desc:'不应公开列入协作成员'},
];
const AvatarComponent = ({name})=>React.createElement('span',{'data-avatar':name});
const render = (extra={})=>renderToStaticMarkup(React.createElement(AgentRoster,{
  agents:roster,sessionScope:roster.filter(agent=>agent.kind!=='temp').map(agent=>agent.id),
  onMention(){},onDone(){},AvatarComponent,...extra,
}));

test('selected profile and official agents share the sub-agent section',()=>{
  const markup=render();
  assert.match(markup,/主控智能体/);
  assert.match(markup,/子智能体/);
  assert.match(markup,/论文检索/);
  assert.match(markup,/配置的官方应用/);
  assert.match(markup,/官方/);
});

test('agent roster does not reintroduce human members, temporary workers or management controls',()=>{
  const markup=render();
  assert.doesNotMatch(markup,/项目成员|项目所有者|后台临时助手|临时智能体/);
  assert.doesNotMatch(markup,/管理画像|创建画像|改方向|更改方向/);
});

test('out-of-session agents cannot be mentioned',()=>{
  const markup=render({sessionScope:['mushsci']});
  const mentionButtons=[...markup.matchAll(/<button\b([^>]*)>提及<\/button>/g)];
  assert.equal(mentionButtons.length,3);
  assert.equal(mentionButtons.filter(match=>/\bdisabled(?:=|\s|$)/.test(match[1])).length,2);
});

test('empty child selection is represented without inventing official applications',()=>{
  const markup=render({agents:[roster[0]],sessionScope:['mushsci']});
  assert.match(markup,/子智能体/);
  assert.doesNotMatch(markup,/配置的官方应用|论文检索|后台临时助手/);
  assert.match(markup,/完成/);
});

test('roster descriptions remain escaped content',()=>{
  const markup=render({agents:[{...roster[1],desc:'<script>unsafe</script>'}]});
  assert.match(markup,/&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(markup,/<script>/);
});

test('workspace restores full messages and uses the shared non-modal workbench',async()=>{
  const source=await readFile(new URL('../src/Workspace.jsx',import.meta.url),'utf8');
  assert.ok(/upgradeSavedSample\(saved\.current\.messages\)/.test(source),'saved sample migration is wired');
  assert.ok(/setMessages\(FULL_SAMPLE_MESSAGES\)/.test(source),'sample reset restores the full conversation');
  assert.ok(!/setMessages\(EXECUTION_SAMPLE\)/.test(source),'sample reset must not use the shortened sample');
  assert.ok(/<WorkbenchPanel\b/.test(source),'shared panel is rendered');
  assert.ok(/<AgentRoster\b/.test(source),'read-only agent roster is rendered');
  assert.ok(/onOpenAgent=/.test(source),'agent detail callback is passed through');
});

test('cloud attachment upload survives removal of the environment switch and agent management',async()=>{
  const source=await readFile(new URL('../src/Workspace.jsx',import.meta.url),'utf8');
  assert.ok(/从云盘上传/.test(source),'cloud attachment uploader is retained');
  assert.ok(!/className=['"]environment-btn['"]|menu\s*===\s*['"]environment['"]/.test(source),'cloud environment switch is removed');
  assert.ok(!/modal\.type\s*===\s*['"]profileAgents['"]|openModal\(['"]profileAgents['"]/.test(source),'management screen and entries are removed');
  assert.ok(!/>项目成员|>管理画像智能体|>改方向</.test(source),'annotated member and management controls are removed');
});
