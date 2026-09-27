import test from 'node:test';
import assert from 'node:assert/strict';
import sourceMessages from '../src/messages.json' with {type: 'json'};
import {FULL_SAMPLE_MESSAGES, upgradeSavedSample} from '../src/sampleMessages.js';
import {normalizeLegacyExecution} from '../src/executionModel.js';

test('the original 13 messages and full rich HTML are preserved exactly', () => {
  assert.equal(FULL_SAMPLE_MESSAGES.length, 13);
  sourceMessages.forEach((source, index) => {
    const sample = FULL_SAMPLE_MESSAGES[index];
    for (const field of ['id', 'html', 'sender', 'mode', 'quote', 'time', 'task', 'text']) {
      assert.equal(sample[field], source[field], `${source.id}: ${field}`);
    }
  });
});

test('each assistant has an explicit demo execution with the original reply owner', () => {
  FULL_SAMPLE_MESSAGES.forEach(message => {
    if (message.sender === 'LI') {
      assert.equal(message.execution, undefined);
      return;
    }
    assert.equal(message.execution.demo, true);
    assert.equal(message.execution.owner, message.sender);
    assert.equal(message.execution.mode, message.id === 'sample-coord-main' ? 'coord' : 'direct');
    if (message.execution.mode === 'direct') assert.equal(message.execution.agents.length, 0);
  });
});

test('the background task acknowledgment is a successful handoff, not completed research', () => {
  const message = FULL_SAMPLE_MESSAGES[1];
  assert.equal(message.task, true);
  assert.equal(message.execution.status, 'success');
  assert.match(message.execution.current, /后台调研任务已提交.*等待/);
  assert.match(message.execution.tools[0].detail, /不表示论文调研已完成/);
  assert.equal(message.execution.artifacts.length, 0);
});

test('the PPT attempt preserves successful planning but fails generation and the overall task', () => {
  const execution = FULL_SAMPLE_MESSAGES[10].execution;
  assert.equal(execution.owner, 'mushsci');
  assert.equal(execution.status, 'error');
  assert.equal(execution.tools.find(tool => tool.id === 'ppt-plan').status, 'success');
  assert.equal(execution.tools.find(tool => tool.id === 'ppt-images').status, 'error');
  assert.match(execution.current, /未完成.*规划已保留/);
  assert.equal(execution.artifacts.length, 0);
});

test('the final rich checklist uses two levels and keeps child tools out of the main entries', () => {
  const message = FULL_SAMPLE_MESSAGES[12];
  const execution = message.execution;
  assert.equal(execution.status, 'success');
  assert.equal(execution.owner, 'mushsci');
  assert.equal(execution.agents.length, 3);
  const worker = execution.agents.find(agent => agent.kind === 'temp');
  assert.equal(worker.name, '文献整理助手');
  assert.equal(worker.temporary, true);
  assert.equal(worker.status, 'success');
  assert.match(message.html, /光热耦合界面钝化/);
  assert.match(message.html, /宽湿度窗口制备/);
  assert.match(message.html, /组件封装可靠性/);
  const rootToolIds = execution.entries.filter(entry => entry.type === 'tools').flatMap(entry => entry.toolIds);
  execution.agents.forEach(agent => {
    assert.equal(agent.status, 'success');
    assert.ok(agent.entries.some(entry => entry.type === 'tools'));
    const childTools = execution.tools.filter(tool => tool.agentRunId === agent.id);
    assert.ok(childTools.length > 0);
    childTools.forEach(tool => assert.ok(!rootToolIds.includes(tool.id)));
  });
});

test('new traces contain only authored public content, not raw legacy thinking or command text', () => {
  FULL_SAMPLE_MESSAGES.filter(message => message.execution).forEach(message => {
    const execution = normalizeLegacyExecution(message);
    assert.equal(execution, message.execution);
    assert.equal(execution.legacy, undefined);
    const publicDisplay = JSON.stringify({entries: execution.entries, agents: execution.agents, tools: execution.tools});
    assert.doesNotMatch(publicDisplay, /Get-ChildItem|C:\\\\Users|projectRoot|dirs\[0\]|让我先看一下|现在我知道|搜索结果很丰富/);
    assert.ok(execution._events.filter(event => event.type === 'commentary').every(event => event.public));
    assert.equal(execution.artifacts.length, 0, 'original preview anchors are not fake download artifacts');
  });
});

test('the two-message shortened sample upgrades to all 13 original messages', () => {
  const result = upgradeSavedSample([{id: 'execution-demo-user'}, {id: 'execution-demo-main'}]);
  assert.deepEqual(result.map(message => message.id), sourceMessages.map(message => message.id));
});

test('restoring the shortened sample preserves later user messages and replies in order', () => {
  const localMessages = [{id: 'local-question', sender: 'LI', local: true, html: '<p>用户新问题</p>'}, {id: 'local-response', sender: '论文检索', local: true, html: '<p>新回复</p>'}];
  const saved = [{id: 'execution-demo-user'}, {id: 'execution-demo-main'}, ...localMessages];
  const result = upgradeSavedSample(saved);
  assert.equal(result.length, 15);
  assert.deepEqual(result.slice(13), localMessages);
  assert.equal(result[13], localMessages[0]);
  assert.equal(result[14], localMessages[1]);
});

test('existing sample HTML, quotes and metadata edits win; only execution is upgraded', () => {
  const edited = {...sourceMessages[4], html: '<p>用户改过的正文</p>', quote: '用户改过的引用', time: '20:00', execution: {status: 'unknown'}};
  const saved = [sourceMessages[0], edited, {id: 'local-user', sender: 'LI', html: '<p>保留</p>'}];
  const result = upgradeSavedSample(saved);
  assert.equal(result.length, saved.length);
  assert.deepEqual(result.map(message => message.id), saved.map(message => message.id));
  assert.equal(result[1].html, edited.html);
  assert.equal(result[1].quote, edited.quote);
  assert.equal(result[1].time, edited.time);
  assert.equal(result[1].execution.demo, true);
  assert.equal(result[2], saved[2]);
});

test('a saved edit survives even when restoring missing messages from the shortened sample', () => {
  const edited = {...sourceMessages[12], html: '<p>用户编辑的清单</p>', quote: '保留引用'};
  const result = upgradeSavedSample([{id: 'execution-demo-user'}, edited, {id: 'execution-demo-main'}]);
  assert.equal(result.length, 13);
  assert.equal(result[12].html, edited.html);
  assert.equal(result[12].quote, edited.quote);
  assert.equal(result[12].execution.demo, true);
});

test('a deliberately empty saved chat and unrelated user chats are never populated', () => {
  const deleted = [];
  assert.equal(upgradeSavedSample(deleted), deleted);
  const unrelated = [{id: 'real-chat', sender: 'LI', html: '<p>另外一个任务</p>'}];
  assert.equal(upgradeSavedSample(unrelated), unrelated);
});

test('PPT credit errors use a proposed billing code and offer a new attempt', () => {
  const execution = FULL_SAMPLE_MESSAGES[10].execution;
  const generation = execution._events.find(event => event.type === 'tool_result' && event.toolCallId === 'ppt-images');
  assert.equal(generation.outcome.status, 'error');
  assert.match(generation.outcome.detail, /积分不足/);
  assert.ok(execution.warnings.some(warning => /重新尝试/.test(warning.message)));
  assert.ok(execution.warnings.every(warning => !/补充积分后继续/.test(warning.message)));
});

test('saved examples disclose concrete calls separately even when they share a step', () => {
  FULL_SAMPLE_MESSAGES.filter(message => message.execution).forEach(message => {
    const execution = message.execution;
    const groups = [...execution.entries, ...execution.agents.flatMap(agent => agent.entries)]
      .filter(entry => entry.type === 'tools');
    assert.ok(groups.every(group => group.toolIds.length === 1));
    assert.equal(groups.length, execution.tools.length);
  });
});
