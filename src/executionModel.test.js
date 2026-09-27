import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecution, reduceExecution, getDemoExecution, normalizeLegacyExecution, toolActivity, elapsedSeconds } from './executionModel.js';

const start = options => createExecution({ id: 'run', ...options });
const reduce = (events, initial = start()) => events.reduce(reduceExecution, initial);

test('same toolCallId patches one row; eventId is idempotent', () => {
  const pending = { type: 'tool_pending', eventId: 'p', seq: 1, toolCallId: 'call', title: '检索论文' };
  const state = reduce([pending, { type: 'tool_result', eventId: 'r', seq: 2, toolCallId: 'call', result: { ok: true } }]);
  assert.equal(state.tools.length, 1);
  assert.equal(state.entries.length, 1);
  assert.equal(state.tools[0].status, 'success');
  assert.equal(reduceExecution(state, pending), state);
});

test('out-of-order seq replay preserves chronology and returned state', () => {
  const events = [
    { type: 'tool_pending', eventId: 'p', seq: 2, toolCallId: 'call', title: '检索' },
    { type: 'tool_result', eventId: 'r', seq: 3, toolCallId: 'call', result: { success: true } },
    { type: 'commentary', eventId: 'c', seq: 1, public: true, text: '准备检索' },
  ];
  assert.deepEqual(reduce([events[1], events[2], events[0]]).entries, reduce(events).entries);
  assert.equal(reduce([events[1], events[0]]).tools[0].status, 'success');
});

test('ownership is explicit, not inferred from tool or skill names', () => {
  const state = reduce([
    { type: 'agent_created', seq: 1, agentRunId: 'paper', name: '论文检索', kind: 'profile' },
    { type: 'tool_pending', seq: 2, toolCallId: 'unowned', toolName: '论文检索-MCP' },
    { type: 'tool_pending', seq: 3, toolCallId: 'owned', agentRunId: 'paper', title: '查询证据' },
  ]);
  assert.equal(state.tools[0].agentRunId, null);
  assert.equal(state.tools[1].agentRunId, 'paper');
  assert.deepEqual(state.entries.filter(e => e.type === 'tools').flatMap(e => e.toolIds), ['unowned']);
  assert.deepEqual(state.agents[0].entries.flatMap(e => e.toolIds || []), ['owned']);
});

test('done means confirming; only Message.status success means task success', () => {
  const state = reduce([{ type: 'done', seq: 1 }]);
  assert.equal(state.status, 'confirming');
  const complete = reduceExecution(state, { type: 'message_status', status: 'success', seq: 2 });
  assert.equal(complete.status, 'success');
  assert.equal(reduceExecution(complete, { type: 'message_status', status: 'processing', seq: 3 }).status, 'success');
  assert.equal(reduce([{ type: 'message_status', status: 'done', seq: 1 }]).status, 'processing');
});

test('business false/error becomes local tool error, not task failure', () => {
  for (const result of [{ ok: false }, { success: false }, { data: { success: false } }, { code: 'VALIDATION_FAIL' }, { error: 'invalid' }]) {
    const state = reduce([{ type: 'tool_result', toolCallId: 'bad', result, seq: 1 }]);
    assert.equal(state.tools[0].status, 'error');
    assert.equal(state.status, 'processing');
  }
  const transport = reduce([{ type: 'tool_error', toolCallId: 'bad', seq: 1 }]);
  assert.equal(transport.tools[0].status, 'error');
  assert.equal(transport.status, 'processing');
  assert.equal(reduce([{ type: 'error', message: '局部问题', seq: 1 }]).status, 'processing');
});

test('empty result is a successful empty outcome, not system failure', () => {
  for (const result of [[], { items: [] }, { code: 'NO_RESULT' }, { code: 'EMPTY_RESULT' }]) {
    const state = reduce([{ type: 'tool_result', toolCallId: 'empty', result, seq: 1 }]);
    assert.equal(state.tools[0].status, 'empty');
    assert.equal(state.status, 'processing');
  }
});

test('only artifact with download information becomes downloadable', () => {
  const state = reduce([
    { type: 'tool_result', toolCallId: 'file', seq: 1, result: { code: 'FILE_CREATED', path: '/sandbox/report.md' } },
    { type: 'artifact', eventId: 'a', seq: 2, fileId: 'f1', name: 'report.md' },
    { type: 'artifact', eventId: 'b', seq: 3, fileId: 'f1', name: 'report.md', downloadUrl: 'https://example.test/report.md' },
    { type: 'artifact', eventId: 'unsafe', seq: 4, fileId: 'unsafe', downloadUrl: 'javascript:alert(1)' },
  ]);
  assert.equal(state.artifacts.length, 1);
  assert.equal(state.artifacts[0].downloadable, true);
});

test('temporary workers retain their own visible record and tool scope', () => {
  const state = reduce([
    { type: 'agent_created', seq: 1, agentRunId: 'temp', kind: 'temp', name: '任意临时名称' },
    { type: 'commentary', seq: 2, public: true, agentRunId: 'temp', text: '整理资料' },
    { type: 'tool_pending', seq: 3, agentRunId: 'temp', toolCallId: 'background', title: '内部工作' },
  ]);
  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0].temporary, true);
  assert.equal(state.agents[0].kind, 'temp');
  assert.equal(state.entries[0].type, 'agents');
  assert.deepEqual(state.agents[0].entries.map(entry => entry.type), ['commentary', 'tools']);
  assert.equal(state.tools[0].title, '内部工作');
  assert.equal(state.tools[0].agentRunId, 'temp');
  const finished = reduceExecution(state, {type: 'agent_status', seq: 4, agentRunId: 'temp', status: 'success'});
  assert.equal(finished.agents.length, 1);
  assert.equal(finished.status, 'processing');
});

test('two-phase cancellation preserves successes and artifacts, does not regress', () => {
  let state = reduce([
    { type: 'tool_result', toolCallId: 'done', seq: 1, result: { ok: true } },
    { type: 'tool_pending', toolCallId: 'active', seq: 2 },
    { type: 'artifact', seq: 3, fileId: 'file', downloadUrl: 'https://example.test/file' },
    { type: 'stop_requested', seq: 4 },
  ]);
  assert.equal(state.status, 'stopping');
  state = reduceExecution(state, { type: 'tool_pending', toolCallId: 'not-confirmed', seq: 4.5 });
  assert.equal(state.tools.find(t => t.id === 'not-confirmed').status, 'running');
  state = reduceExecution(state, { type: 'message_status', status: 'cancelled', seq: 5 });
  assert.equal(state.tools.find(t => t.id === 'done').status, 'success');
  assert.equal(state.tools.find(t => t.id === 'active').status, 'cancelled');
  assert.equal(state.artifacts.length, 1);
  state = reduceExecution(state, { type: 'done', seq: 6 });
  state = reduceExecution(state, { type: 'message_status', status: 'processing', seq: 7 });
  assert.equal(state.status, 'cancelled');
});

test('retry/fallback attempts belong to one explicitly named semantic action', () => {
  const state = reduce([
    { type: 'tool_pending', seq: 1, toolCallId: 'first', actionId: 'fetch', title: '获取文献正文' },
    { type: 'tool_error', seq: 2, toolCallId: 'first', actionId: 'fetch' },
    { type: 'tool_pending', seq: 3, toolCallId: 'fallback', actionId: 'fetch', title: '备用方式获取正文' },
    { type: 'tool_result', seq: 4, toolCallId: 'fallback', actionId: 'fetch', result: { ok: true } },
  ]);
  assert.equal(state.tools.length, 1);
  assert.equal(state.tools[0].attempts.length, 2);
  assert.equal(state.tools[0].status, 'success');
});

test('robot submission does not claim physical completion', () => {
  const state = reduce([{ type: 'tool_result', seq: 1, toolCallId: 'robot', result: { code: 'ROBOT_E3', success: true } }]);
  assert.equal(state.tools[0].status, 'submitted');
  assert.equal(state.tools[0].physicalCompletionConfirmed, false);
  assert.match(state.tools[0].detail, /尚未收到/);
});

test('raw thinking, block text, parameters, and usage are not progress text', () => {
  const state = reduce([
    { type: 'commentary', seq: 1, text: 'private thinking' },
    { type: 'block_content', seq: 2, text: 'raw chain of thought', contentType: 'thinking' },
    { type: 'usage', seq: 3, tokens: 300 },
    { type: 'commentary', seq: 4, public: true, text: '正在核对证据' },
  ]);
  assert.deepEqual(state.entries.map(e => e.text), ['正在核对证据']);
  assert.equal(JSON.stringify(state).includes('raw chain of thought'), false);
  assert.equal(JSON.stringify(state).includes('private thinking'), false);
});

test('demo phases reveal only happened work; direct owner has no child agent', () => {
  assert.equal(getDemoExecution({ phase: 0 }).agents.length, 0);
  assert.equal(getDemoExecution({ phase: 1 }).tools.length, 1);
  const phase3 = getDemoExecution({ phase: 3 });
  assert.equal(phase3.agents.find(a => a.id === 'papers').status, 'success');
  assert.equal(phase3.agents.find(a => a.id === 'materials').status, 'processing');
  assert.equal(getDemoExecution({ phase: 5 }).status, 'confirming');
  assert.equal(getDemoExecution({ phase: 6 }).status, 'success');
  assert.equal(getDemoExecution({ phase: 4, mode: 'direct', owner: '论文检索' }).agents.length, 0);
  const stopped = getDemoExecution({ phase: 2, status: 'cancelled' });
  assert.equal(stopped.status, 'cancelled');
  assert.equal(stopped.tools.some(t => t.id === 'synthesis'), false);
});

test('legacy prose cannot manufacture a role, tool, result or completed status', () => {
  const state = normalizeLegacyExecution({ id: 'history', sender: '论文检索', process: '子 Agent 材料科学专家已完成，已执行搜索并核验成功', duration: '已处理 34秒' });
  assert.equal(state.legacy, true);
  assert.equal(state.status, 'unknown');
  assert.equal(state.agents.length, 0);
  assert.equal(state.tools.length, 0);
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].text.includes('核验成功'), false);
  const explicitlyPublic = normalizeLegacyExecution({ process: '提供的公开进展', processPublic: true });
  assert.equal(explicitlyPublic.entries[0].text, '提供的公开进展');
  assert.equal(normalizeLegacyExecution({ messageStatus: 'cancelled' }).status, 'cancelled');
  assert.equal(normalizeLegacyExecution({ messageStatus: 'done' }).status, 'unknown');
  assert.equal(normalizeLegacyExecution({ status: 'complete' }).status, 'unknown');
});

test('explicit final business success recovers historical fallback errors', () => {
  const history = [{ code: 'MP_API_ERROR' }, { code: 'BACKEND_FALLBACK' }];
  for (const final of [{ success: true }, { ok: true }]) {
    const state = reduce([{ type: 'tool_result', seq: 1, toolCallId: 'recovered',
      publicSummary: '材料查询已返回。', result: { ...final, events: history } }]);
    assert.equal(state.tools[0].status, 'degraded');
    assert.equal(state.tools[0].recovery.recovered, true);
    assert.match(state.tools[0].detail, /备用方式恢复/);
  }
  const failed = reduce([{ type: 'tool_result', seq: 1, toolCallId: 'failed',
    result: { success: false, events: history } }]);
  assert.equal(failed.tools[0].status, 'error');
});

test('explicit unknown child ownership waits for authoritative identity, never leaks to root', () => {
  let state = reduce([
    { type: 'commentary', seq: 1, agentRunId: 'unknown', public: true, text: '子任务公开进展' },
    { type: 'tool_pending', seq: 2, agentRunId: 'unknown', toolCallId: 'unknown-call', title: '查询资料' },
  ]);
  assert.equal(state.entries.length, 0);
  assert.equal(state.tools[0].agentRunId, 'unknown');
  assert.equal(state.warnings.some(w => w.code === 'UNKNOWN_AGENT_OWNER'), true);
  state = reduceExecution(state, { type: 'agent_created', seq: 3, agentRunId: 'unknown', name: '论文检索', kind: 'profile' });
  assert.deepEqual(state.agents[0].entries.map(e => e.type), ['commentary', 'tools']);
  assert.equal(state.entries.some(e => e.type === 'tools' || e.type === 'commentary'), false);
  assert.equal(state.warnings.some(w => w.code === 'UNKNOWN_AGENT_OWNER'), false);
});

test('commentary does not manufacture a tool action in either scope', () => {
  const state = reduce([
    { type: 'commentary', seq: 1, public: true, text: '主责任务', current: '主责正在协调' },
    { type: 'commentary', seq: 2, public: true, agentRunId: 'paper', text: '子任务进展', current: '正在查论文' },
    { type: 'agent_created', seq: 3, agentRunId: 'paper', name: '论文检索' },
  ]);
  assert.equal(state.current, '任务已分配，等待开始');
  assert.equal(state.agents[0].current, '任务已分配，等待开始');
});

test('actionId and repeated call IDs are isolated by task, Agent and semantic step', () => {
  const state = reduce([
    { type: 'agent_created', seq: 1, agentRunId: 'a', name: '论文检索' },
    { type: 'agent_created', seq: 2, agentRunId: 'b', name: '材料科学专家' },
    { type: 'tool_pending', seq: 3, agentRunId: 'a', stepId: 'one', actionId: 'same', toolCallId: 'a-1' },
    { type: 'tool_pending', seq: 4, agentRunId: 'b', stepId: 'one', actionId: 'same', toolCallId: 'b-1' },
    { type: 'tool_pending', seq: 5, agentRunId: 'a', stepId: 'two', actionId: 'same', toolCallId: 'a-2' },
    { type: 'tool_result', seq: 6, agentRunId: 'b', stepId: 'one', actionId: 'same', toolCallId: 'b-1', result: { ok: true } },
  ]);
  assert.equal(state.tools.length, 3);
  assert.equal(new Set(state.tools.map(t => t.id)).size, 3);
  assert.equal(state.tools.filter(t => t.status === 'success').length, 1);
  const duplicateCall = reduce([
    { type: 'tool_pending', seq: 1, toolCallId: 'same-call', stepId: 'one' },
    { type: 'tool_pending', seq: 2, toolCallId: 'same-call', stepId: 'two' },
    { type: 'tool_result', seq: 3, toolCallId: 'same-call', stepId: 'two', result: { ok: true } },
  ]);
  assert.equal(duplicateCall.tools.length, 2);
  assert.equal(duplicateCall.tools.find(t => t.stepId === 'one').status, 'running');
  assert.equal(duplicateCall.tools.find(t => t.stepId === 'two').status, 'success');
});

test('unrecognized tool payload is unknown rather than invented business success', () => {
  const state = reduce([{ type: 'tool_result', seq: 1, toolCallId: 'unrecognized', result: { foo: 1 } }]);
  assert.equal(state.tools[0].status, 'unknown');
  assert.equal(state.status, 'processing');
});

test('tool groups separate explicit actions within the same step', () => {
  const state = reduce([
    { type: 'tool_pending', seq: 1, stepId: 'step', actionId: 'action-a', toolCallId: 'a' },
    { type: 'tool_pending', seq: 2, stepId: 'step', actionId: 'action-b', toolCallId: 'b' },
  ]);
  assert.equal(state.entries.filter(e => e.type === 'tools').length, 2);
  assert.notEqual(state.tools[0].groupId, state.tools[1].groupId);
});

test('different concrete calls are never semantically grouped by stepId', () => {
  const state = reduce([
    { type: 'tool_pending', seq: 1, stepId: 'evidence', toolCallId: 'one' },
    { type: 'tool_pending', seq: 2, stepId: 'evidence', toolCallId: 'two' },
    { type: 'commentary', seq: 3, public: true, text: '当前查询已返回，继续补充证据。' },
    { type: 'tool_pending', seq: 4, stepId: 'evidence', toolCallId: 'three' },
  ]);
  assert.deepEqual(state.entries.map(e => e.type), ['tools', 'tools', 'commentary', 'tools']);
  assert.deepEqual(state.entries[0].toolIds, ['one']);
  assert.deepEqual(state.entries[1].toolIds, ['two']);
  assert.deepEqual(state.entries[3].toolIds, ['three']);
  assert.equal(state.entries[0].id, 'group:one');
  assert.equal(state.entries[3].id, 'group:three');
});

test('late step metadata patches the tool without moving or renaming its disclosure', () => {
  let state = reduce([
    { type: 'tool_pending', seq: 1, toolCallId: 'late' },
    { type: 'commentary', seq: 2, public: true, text: '等待当前调用结果。' },
  ]);
  const groupId = state.tools[0].groupId;
  const entryIds = state.entries.map(e => e.id);
  state = reduceExecution(state, { type: 'tool_result', seq: 3, toolCallId: 'late', stepId: 'identified-later', result: { ok: true } });
  assert.equal(state.tools.length, 1);
  assert.equal(state.tools[0].groupId, groupId);
  assert.equal(state.tools[0].stepId, 'identified-later');
  assert.deepEqual(state.entries.map(e => e.id), entryIds);
  assert.equal(state.entries[0].id, 'group:late');
});

test('unknown-owner binding preserves the first established tool group ID', () => {
  let state = reduce([{ type: 'tool_pending', seq: 1, agentRunId: 'pending-owner', toolCallId: 'owned-late', stepId: 'read' }]);
  const groupId = state.tools[0].groupId;
  state = reduceExecution(state, { type: 'agent_created', seq: 2, agentRunId: 'pending-owner', name: '论文检索' });
  assert.equal(state.tools[0].groupId, groupId);
  assert.equal(state.agents[0].entries[0].id, groupId);
});

test('artifact ownership preserves temp and child scope, normalizes the direct owner', () => {
  const state = reduce([
    { type: 'agent_created', seq: 1, agentRunId: 'temp', kind: 'temp' },
    { type: 'agent_created', seq: 2, agentRunId: 'child', name: '论文检索' },
    { type: 'artifact', seq: 3, fileId: 'temp-file', agentRunId: 'temp', downloadUrl: '/download/temp' },
    { type: 'artifact', seq: 4, fileId: 'child-file', agentRunId: 'child', downloadUrl: '/download/child' },
    { type: 'artifact', seq: 5, fileId: 'unknown-file', agentRunId: 'unknown', downloadUrl: '/download/unknown' },
    { type: 'artifact', seq: 6, fileId: 'root-file', agentRunId: 'root', downloadUrl: '/download/root' },
  ]);
  assert.equal(state.artifacts.find(a => a.id === 'temp-file').agentRunId, 'temp');
  assert.equal(state.artifacts.find(a => a.id === 'child-file').agentRunId, 'child');
  assert.equal(state.artifacts.find(a => a.id === 'unknown-file').agentRunId, 'unknown');
  assert.equal(state.artifacts.find(a => a.id === 'root-file').agentRunId, null);
  const direct = reduce([{ type: 'artifact', seq: 1, fileId: 'owner-file', agentRunId: 'owner-run', downloadUrl: '/download/direct' }], start({ mode: 'direct', owner: '论文检索', ownerAgentRunId: 'owner-run' }));
  assert.equal(direct.artifacts[0].agentRunId, null);
});

test('root ownership uses authoritative Agent run ID, never its display name', () => {
  const state = reduce([
    { type: 'artifact', seq: 1, fileId: 'true-owner', agentRunId: 'owner-run', downloadUrl: '/download/owner' },
    { type: 'artifact', seq: 2, fileId: 'name-only', agentRunId: '论文检索', downloadUrl: '/download/name' },
    { type: 'commentary', seq: 3, public: true, agentRunId: 'owner-run', text: '主责正在整理结果', current: '主责整理中' },
  ], start({ mode: 'direct', owner: '论文检索', ownerAgentRunId: 'owner-run' }));
  assert.equal(state.ownerAgentRunId, 'owner-run');
  assert.equal(state.artifacts.find(a => a.id === 'true-owner').agentRunId, null);
  assert.equal(state.artifacts.find(a => a.id === 'name-only').agentRunId, '论文检索');
  assert.equal(state.current, '正在思考');
  assert.equal(state.entries[0].text, '主责正在整理结果');
});

test('local errors preserve explicit child scope without failing the task', () => {
  const state = reduce([{ type: 'error', seq: 1, agentRunId: 'child', publicMessage: '查询暂时不可用' }]);
  assert.equal(state.warnings.find(w => w.message === '查询暂时不可用').agentRunId, 'child');
  assert.equal(state.status, 'processing');
});

test('events for another task run are ignored', () => {
  const state = start();
  assert.equal(reduceExecution(state, { type: 'done', taskRunId: 'another' }), state);
});

test('current action follows the concrete call and completion changes it in place', () => {
  let state = reduce([
    {type: 'commentary', seq: 1, public: true, text: '我先读文件。', current: '理解页面框架'},
    {type: 'tool_pending', seq: 2, toolCallId: 'read', title: '读取 研究材料.pdf'},
  ]);
  const entryId = state.entries.at(-1).id;
  assert.equal(state.current, '正在读取 研究材料.pdf');
  assert.equal(state.currentStatus, 'running');
  state = reduceExecution(state, {type: 'tool_result', seq: 3, toolCallId: 'read', result: {ok: true}});
  assert.equal(state.current, '已读取 研究材料.pdf');
  assert.equal(state.currentStatus, 'success');
  assert.equal(state.entries.at(-1).id, entryId);
  assert.equal(state.tools.length, 1);
  assert.equal(toolActivity({...state.tools[0], status: 'empty'}), '读取完成 研究材料.pdf，未找到相关结果');
  assert.equal(toolActivity({...state.tools[0], status: 'error'}), '读取未完成 研究材料.pdf');
});

test('creation is assigned, actual child calls begin the collaborative group', () => {
  let state = reduce([
    {type: 'agent_created', seq: 1, agentRunId: 'a', name: '论文检索'},
    {type: 'agent_created', seq: 2, agentRunId: 'b', name: '文献整理助手', kind: 'temp'},
  ]);
  assert.ok(state.agents.every(agent => agent.status === 'assigned'));
  assert.equal(state.current, '任务已分配，等待开始');
  assert.equal(state.currentStatus, 'assigned');
  state = reduceExecution(state, {type: 'tool_pending', seq: 3, agentRunId: 'a', toolCallId: 'search', title: '检索 相关论文'});
  state = reduceExecution(state, {type: 'tool_pending', seq: 4, agentRunId: 'b', toolCallId: 'read', title: '读取 资料出处'});
  assert.equal(state.current, '2 项任务正在进行');
  assert.equal(state.currentStatus, 'processing');
  assert.equal(state.agents.find(agent => agent.id === 'a').current, '正在检索 相关论文');
  assert.equal(state.agents.find(agent => agent.id === 'b').current, '正在读取 资料出处');
});

test('waiting pauses whole-run time, resumes cumulatively and terminal time freezes', () => {
  let state = reduce([{type: 'message_status', status: 'waiting', seq: 1, at: 10000}], start({startedAt: 0}));
  assert.equal(state.current, '等待你补充');
  assert.equal(state.currentStatus, 'waiting');
  assert.equal(elapsedSeconds(state, 50000), 10);
  state = reduceExecution(state, {type: 'message_status', status: 'processing', seq: 2, at: 40000});
  assert.equal(state.pausedSeconds, 30);
  assert.equal(elapsedSeconds(state, 45000), 15);
  state = reduceExecution(state, {type: 'message_status', status: 'waiting', seq: 3, at: 50000});
  state = reduceExecution(state, {type: 'message_status', status: 'success', seq: 4, at: 90000});
  assert.equal(elapsedSeconds(state, 999999), 20);
  assert.equal(state.pausedSeconds, 70);
});

test('a waiting child exposes a main-area request without declaring the whole task failed', () => {
  const state = reduce([
    {type: 'agent_created', seq: 1, agentRunId: 'worker', name: '文献整理助手', kind: 'temp'},
    {type: 'agent_status', seq: 2, agentRunId: 'worker', status: 'waiting'},
  ]);
  assert.equal(state.status, 'processing');
  assert.equal(state.agents[0].status, 'waiting');
  assert.equal(state.current, '等待你补充');
  const request = state.warnings.find(warning => warning.code === 'USER_INPUT_REQUIRED');
  assert.equal(request.agentRunId, null);
  assert.equal(request.relatedAgentRunId, 'worker');
  assert.match(request.message, /主对话/);
});

test('parallel time is the overall duration and historical Chinese duration remains readable', () => {
  const state = getDemoExecution({phase: 2, startedAt: 1000});
  assert.equal(elapsedSeconds(state, 11000), 10);
  assert.equal(elapsedSeconds({status: 'success', duration: '1分56秒'}), 116);
});
