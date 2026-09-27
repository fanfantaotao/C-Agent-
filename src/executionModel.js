/**
 * Runtime → public execution view model (MVP, no semantic aggregation).
 *
 * The journal is private reducer bookkeeping, not a technical-log UI. Only
 * explicitly public commentary and safe semantic tool summaries reach entries.
 * Agent lifecycle, waiting status and timing fields below are an integration target, NOT current HiMAT V1
 * events. DEMO_EVENTS is kept separate from the runtime adapter deliberately.
 */
const TERMINAL = new Set(['success', 'error', 'cancelled']);
const EMPTY_CODES = new Set(['NO_RESULT', 'NO_RESULTS', 'EMPTY_RESULT', 'PAPER_NOT_FOUND', 'ROBOT_E2']);
const ERROR_CODES = new Set([
  'VALIDATION_FAIL', 'INVALID_CIF', 'INVALID_FORMULA', 'EXECUTION_ERROR',
  'MODEL_LOAD_ERROR', 'MP_API_ERROR', 'TIMEOUT', 'BALANCE_FAILED', 'DOI_INVALID',
  'RATE_LIMITED', 'BLOCKED', 'PAGE_NOT_FOUND', 'EXTRACTION_FAILED', 'NETWORK_ERROR',
  'TIMEOUT_ERROR', 'SKILL_LOAD_FAILED', 'FAILURE', 'FILE_FAILED', 'INSUFFICIENT_CREDITS',
  'ROBOT_E4', 'ROBOT_E5', 'ROBOT_E6', 'ROBOT_E7',
]);
const SUCCESS_CODES = new Set(['QUERY_SUCCESS', 'FUZZY_QUERY_SUCCESS', 'SEARCH_SUCCESS',
  'PAPER_FOUND', 'FETCH_SUCCESS', 'EXTRACTION_SUCCESS', 'SUCCESS', 'EXECUTION_COMPLETE', 'ROBOT_E3']);
const STATUS_ALIAS = { complete: 'success', done: 'success', failed: 'error', stopped: 'cancelled', running: 'processing', waiting_input: 'waiting' };
const PROGRESS_EVENTS = new Set(['commentary', 'tool_pending', 'tool_result', 'tool_error', 'artifact',
  'agent_created', 'agent_status', 'message_status', 'Message.status', 'error', 'stop_requested', 'done']);
const statusOf = value => STATUS_ALIAS[value] || value;
const textOf = value => typeof value === 'string' ? value : '';
const safeDownload = value => typeof value === 'string' && /^(https?:\/\/|blob:|\/(?!\/))/i.test(value);

export function createExecution({ id, owner = 'mushsci', ownerAgentRunId = null, mode = 'coord', startedAt = null } = {}) {
  return {
    id: id || 'execution', owner, ownerAgentRunId, mode, status: 'processing', startedAt, duration: 0,
    pausedAt: null, pausedSeconds: 0, endedAt: null,
    current: '正在思考', currentStatus: 'processing', entries: [], agents: [], tools: [], artifacts: [], warnings: [],
    _events: [], _seen: [], _pendingAgentEntries: {}, _pendingAgentCurrent: {},
  };
}

/** One concrete action's label; state changes update this same record. */
export function toolActivity(tool = {}) {
  const title = textOf(tool.title).replace(/[《》]/g, '').trim() || '处理任务';
  const match = title.match(/^(?:正在)?(读取|检索|查询|生成|汇总|合并|整理|比较|分析|初始化|提交|核对|执行|获取|搜索|处理)\s*(.*)$/);
  const action = match?.[1] || '执行';
  const object = match ? match[2].trim() : title;
  const suffix = object ? ` ${object}` : '';
  if (tool.status === 'running' || tool.status === 'processing') return `正在${action}${suffix}`;
  if (tool.status === 'error') return `${action}未完成${suffix}`;
  if (tool.status === 'empty') return `${action}完成${suffix}，未找到相关结果`;
  if (tool.status === 'cancelled') return `${action}已停止${suffix}`;
  if (tool.status === 'submitted') return `已提交${suffix}`;
  if (tool.status === 'unknown') return `${action}已返回${suffix}，结果待确认`;
  if (['success', 'degraded'].includes(tool.status)) {
    const completed = ['读取', '生成', '提交', '获取'].includes(action) ? `已${action}` : `${action}完成`;
    return `${completed}${suffix}`;
  }
  return `等待${action}${suffix}`;
}

function durationSeconds(value) {
  if (Number.isFinite(value)) return Math.max(0, value);
  if (typeof value !== 'string') return 0;
  const minutes = Number(value.match(/(\d+)分/)?.[1] || 0);
  const seconds = Number(value.match(/(\d+)秒/)?.[1] || 0);
  return minutes * 60 + seconds;
}

/** Effective whole-run time; parallel Agent durations are never added together. */
export function elapsedSeconds(execution = {}, now = Date.now()) {
  const saved = durationSeconds(execution.duration);
  if (!Number.isFinite(execution.startedAt)) return saved;
  if (TERMINAL.has(execution.status) && saved > 0) return saved;
  const end = execution.endedAt ?? execution.pausedAt ?? now;
  return Math.max(0, Math.floor((end - execution.startedAt) / 1000 - (execution.pausedSeconds || 0)));
}

function resultObject(result) {
  if (typeof result !== 'string') return result;
  try { return JSON.parse(result); } catch { return undefined; }
}

/** Transport success is distinct from business success and from task success. */
function classifyResult(event) {
  const result = resultObject(event.result ?? event.data);
  const codes = new Set([event.code, event.businessEvent].filter(Boolean));
  const history = new Set();
  const historyTimeline = [];
  const finalFlags = [];
  let currentError = false;
  let empty = Array.isArray(result) && result.length === 0;
  const collectCodes = (value, target) => {
    if (!value || typeof value !== 'object') return;
    for (const key of ['code', 'event', 'eventId', 'status']) {
      if (typeof value[key] === 'string') target.add(value[key]);
    }
  };
  const inspect = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 3) return;
    for (const key of ['ok', 'success']) if (typeof value[key] === 'boolean') finalFlags.push(value[key]);
    if (value.error && value.error !== false) currentError = true;
    collectCodes(value, codes);
    for (const key of ['items', 'results', 'papers', 'data']) {
      if (Array.isArray(value[key]) && value[key].length === 0) empty = true;
    }
    for (const key of ['result', 'data', 'payload']) inspect(value[key], depth + 1);
    // Returned MCP event history is diagnostic evidence, not the final outcome.
    if (Array.isArray(value.events)) value.events.forEach(item => {
      const itemCodes = new Set();
      if (typeof item === 'string') itemCodes.add(item);
      else collectCodes(item, itemCodes);
      for (const code of itemCodes) { history.add(code); historyTimeline.push(code); }
    });
  };
  inspect(result);
  if (!finalFlags.length) {
    for (const key of ['ok', 'success']) if (typeof event[key] === 'boolean') finalFlags.push(event[key]);
  }
  const explicitFailure = finalFlags.includes(false);
  const explicitSuccess = finalFlags.includes(true) && !explicitFailure;
  const historyFailed = [...history].some(code => ERROR_CODES.has(code));
  const finalCodeSuccess = [...codes].some(code => SUCCESS_CODES.has(code));
  const lastHistoryOutcome = historyTimeline.filter(code => SUCCESS_CODES.has(code) || ERROR_CODES.has(code) || EMPTY_CODES.has(code)).at(-1);
  const historySuccess = SUCCESS_CODES.has(lastHistoryOutcome);
  const failed = explicitFailure || (!explicitSuccess && !finalCodeSuccess
    && (currentError || [...codes].some(code => ERROR_CODES.has(code)) || (historyFailed && !historySuccess)));
  if ([...codes].some(code => EMPTY_CODES.has(code))) empty = true;
  if (!codes.size && [...history].some(code => EMPTY_CODES.has(code)) && !historySuccess) empty = true;
  const submitted = codes.has('ROBOT_E3');
  const knownSuccess = explicitSuccess || finalCodeSuccess || historySuccess;
  const recovered = !failed && knownSuccess && (historyFailed || history.has('BACKEND_FALLBACK') || history.has('RETRYING'));
  const recovery = recovered ? {
    recovered: true, events: [...history],
    summary: history.has('BACKEND_FALLBACK') ? '主方式曾失败，已切换备用方式恢复。' : '此前出现的问题已恢复，最终结果成功返回。',
  } : null;
  const detail = textOf(event.publicSummary || event.detail) || (submitted
    ? '指令已提交；尚未收到机器人实际动作完成的确认。'
    : failed ? '工具已返回，但业务结果未成功。'
      : empty ? '查询已完成，没有匹配结果。' : knownSuccess ? '工具已返回。' : '工具已返回，业务结果尚未确认。');
  return {
    status: failed ? 'error' : submitted ? 'submitted' : empty ? 'empty' : recovered ? 'degraded' : knownSuccess ? 'success' : 'unknown',
    detail: recovery ? `${detail} ${recovery.summary}` : detail,
    submitted, recovery,
  };
}

/** Store safe normalized events, never raw tool output, arguments or thinking. */
function normalizeEvent(event, seq, key, arrival) {
  const type = event.type || event.event;
  const common = { type, seq, eventId: key, _arrival: arrival, scope: event.scope, root: event.root === true,
    at: Number.isFinite(event.at) ? event.at : Date.now() };
  if (type === 'commentary') return {
    ...common, public: event.public === true, text: event.public === true ? textOf(event.text) : '',
    id: event.entryId, agentRunId: event.agentRunId, current: event.current,
  };
  if (['tool_pending', 'tool_result', 'tool_error'].includes(type)) return {
    ...common, toolCallId: event.toolCallId, actionId: event.actionId,
    agentRunId: event.agentRunId, stepId: event.stepId,
    title: textOf(event.title || event.displayName || event.toolName) || '工具调用',
    kind: event.kind || 'tool', groupTitle: event.groupTitle,
    detail: textOf(event.publicSummary || event.detail),
    outcome: type === 'tool_result' ? classifyResult(event) : null,
  };
  if (type === 'artifact') {
    const download = event.downloadUrl || event.url || event.downloadInfo?.url || event.download?.url;
    return { ...common, id: event.fileId || event.artifactId || event.id,
      name: event.name || event.fileName || '产出文件', mimeType: event.mimeType || event.fileType,
      downloadUrl: safeDownload(download) ? download : null, agentRunId: event.agentRunId };
  }
  if (type === 'agent_created' || type === 'agent_status') return {
    ...common, agentRunId: event.agentRunId, name: event.name, kind: event.kind,
    task: event.task, status: statusOf(event.status), summary: textOf(event.summary),
  };
  if (type === 'message_status' || type === 'Message.status') return {
    // Runtime Message.status is exact. A UI shorthand such as "done" must
    // never be upgraded to the authoritative terminal status "success".
    ...common, status: event.status === 'waiting_input' ? 'waiting' : event.status, duration: event.duration, current: event.current,
  };
  if (type === 'error') return { ...common, agentRunId: event.agentRunId,
    message: textOf(event.publicMessage || event.message) || '执行中出现局部问题。' };
  // block_* / usage / internal MCP phases do not become progress paragraphs.
  return common;
}

function entryTarget(state, agentRunId, seq = 0) {
  if (!agentRunId) return state.entries;
  const agent = state.agents.find(item => item.id === agentRunId);
  if (agent) return agent.entries;
  if (!state._pendingAgentEntries[agentRunId]) state._pendingAgentEntries[agentRunId] = [];
  if (!state.warnings.some(item => item.id === `ownership:${agentRunId}`)) state.warnings.push({
    id: `ownership:${agentRunId}`, code: 'UNKNOWN_AGENT_OWNER', agentRunId,
    message: '已收到带 Agent 归属的执行内容，等待确认该 Agent 的信息。', seq,
  });
  return state._pendingAgentEntries[agentRunId];
}

function isRootSource(state, event) {
  return !event.agentRunId || event.scope === 'root' || event.root === true || event.agentRunId === 'root'
    || (!!state.ownerAgentRunId && event.agentRunId === state.ownerAgentRunId);
}

function resolveOwner(state, event, temporaryIds) {
  return isRootSource(state, event) ? null : event.agentRunId;
}

const scopedToolId = (state, owner, stepId, actionId, category = 'action') =>
  `${state.id}:${category}:${encodeURIComponent(owner || 'root')}:${encodeURIComponent(stepId || '_')}:${encodeURIComponent(actionId)}`;

function addToolGroup(state, tool, event) {
  const entries = entryTarget(state, tool.agentRunId, event.seq);
  // Only an explicit action ID groups retry attempts of one action. A step ID
  // does not justify merging distinct calls into a semantic phase in this MVP.
  const boundary = tool.actionId ? ['action', tool.stepId || null, tool.actionId]
    : ['call', tool.id];
  const groupKey = JSON.stringify([tool.agentRunId || null, ...boundary]);
  if (tool.groupId) {
    const existing = entries.find(item => item.id === tool.groupId);
    if (existing && !existing.toolIds.includes(tool.id)) existing.toolIds.push(tool.id);
    return;
  }
  // Each concrete call keeps its position when its completion arrives.
  const last = entries.at(-1);
  let group = last?.type === 'tools' && last.groupKey === groupKey ? last : null;
  if (!group) {
    group = { id: `group:${tool.id}`, type: 'tools', toolIds: [], title: tool.title,
      seq: tool.seq, groupKey, stepId: tool.stepId, actionId: tool.actionId };
    entries.push(group);
  }
  tool.groupId = group.id;
  if (!group.toolIds.includes(tool.id)) group.toolIds.push(tool.id);
}

function clearPendingOwnership(state, agentRunId) {
  delete state._pendingAgentEntries[agentRunId];
  delete state._pendingAgentCurrent[agentRunId];
  state.warnings = state.warnings.filter(item => item.id !== `ownership:${agentRunId}`);
}

function applyEvent(state, event, temporaryIds) {
  const terminal = TERMINAL.has(state.status);
  if (event.type === 'commentary') {
    if (!event.public || !event.text) return;
    const agentRunId = resolveOwner(state, event, temporaryIds);
    entryTarget(state, agentRunId, event.seq).push({
      id: event.id || `note:${event.eventId}`, type: 'commentary', text: event.text,
      seq: event.seq,
    });
    if (event.current && !terminal) {
      if (isRootSource(state, event)) state.current = event.current;
      else {
        const agent = state.agents.find(item => item.id === event.agentRunId);
        if (agent) agent.current = event.current;
        else state._pendingAgentCurrent[event.agentRunId] = event.current;
      }
    }
    return;
  }
  if (event.type === 'agent_created') {
    if (!event.agentRunId) return;
    // Direct runs have only the named owner; never manufacture a child role.
    if (state.mode === 'direct' || state.agents.some(item => item.id === event.agentRunId)) return;
    const temporary = event.kind === 'temp' || event.kind === 'temporary';
    const hasRunningCall = state.tools.some(tool => tool.agentRunId === event.agentRunId && tool.status === 'running');
    state.agents.push({ id: event.agentRunId, name: event.name || (temporary ? '临时工作助手' : '子任务'),
      kind: temporary ? 'temp' : 'profile', temporary,
      task: event.task || '', status: event.status || (hasRunningCall ? 'processing' : 'assigned'),
      summary: event.summary || '任务已分配，等待开始',
      entries: state._pendingAgentEntries[event.agentRunId] || [],
      ...(state._pendingAgentCurrent[event.agentRunId] ? { current: state._pendingAgentCurrent[event.agentRunId] } : {}) });
    clearPendingOwnership(state, event.agentRunId);
    let group = state.entries.find(item => item.type === 'agents');
    if (!group) {
      group = { id: `${state.id}:agents`, type: 'agents', agentIds: [], seq: event.seq };
      state.entries.push(group);
    }
    group.agentIds.push(event.agentRunId);
    return;
  }
  if (event.type === 'agent_status') {
    const agent = state.agents.find(item => item.id === event.agentRunId);
    if (!agent) return;
    if (!TERMINAL.has(agent.status) && event.status) agent.status = event.status;
    if (event.summary) agent.summary = event.summary;
    if (agent.status === 'waiting' && !state.warnings.some(item => item.id === `input:${agent.id}`)) {
      state.warnings.push({ id: `input:${agent.id}`, code: 'USER_INPUT_REQUIRED', agentRunId: null,
        relatedAgentRunId: agent.id, seq: event.seq,
        message: `${agent.name}需要你补充信息，请在主对话中回复主控提出的问题。` });
    } else if (agent.status !== 'waiting') state.warnings = state.warnings.filter(item => item.id !== `input:${agent.id}`);
    return;
  }
  if (['tool_pending', 'tool_result', 'tool_error'].includes(event.type)) {
    if (!event.toolCallId) return;
    const owner = resolveOwner(state, event, temporaryIds);
    const explicitOwner = !!event.agentRunId || event.scope === 'root' || event.root === true;
    const compatible = item => (!explicitOwner || item.agentRunId === owner)
      && (!event.stepId || !item.stepId || item.stepId === event.stepId)
      && (!event.actionId || !item.actionId || item.actionId === event.actionId);
    const requestedId = event.actionId ? scopedToolId(state, owner, event.stepId, event.actionId) : event.toolCallId;
    let tool = state.tools.find(item => item.id === requestedId && compatible(item));
    if (!tool) {
      const candidates = state.tools.filter(item => compatible(item) && item.attempts.some(attempt => attempt.id === event.toolCallId));
      if (candidates.length > 1) {
        state.warnings.push({ id: event.eventId, code: 'AMBIGUOUS_TOOL_SCOPE', agentRunId: owner,
          message: '工具返回缺少足够的步骤或 Agent 归属信息，暂未合并到执行动作。', seq: event.seq });
        return;
      }
      tool = candidates[0];
    }
    if (!tool) {
      // Explicit unknown ownership is quarantined, not silently placed in the
      // main thread. Only no owner (or an explicit temp worker) belongs there.
      const id = state.tools.some(item => item.id === requestedId)
        ? scopedToolId(state, owner, event.stepId, event.toolCallId, 'call') : requestedId;
      tool = { id, agentRunId: owner || null, actionId: event.actionId || null,
        title: event.title,
        detail: '', status: 'running', kind: event.kind, stepId: event.stepId || null,
        seq: event.seq, attempts: [] };
      state.tools.push(tool);
      addToolGroup(state, tool, event);
    } else {
      // Metadata may arrive with the result, but disclosure identity and
      // position were already established by pending. Do not regroup it.
      if (event.stepId && !tool.stepId) tool.stepId = event.stepId;
      if (event.actionId && !tool.actionId) tool.actionId = event.actionId;
      const group = entryTarget(state, tool.agentRunId, event.seq).find(item => item.id === tool.groupId);
      if (group) {
        if (!group.stepId && tool.stepId) group.stepId = tool.stepId;
        if (!group.actionId && tool.actionId) group.actionId = tool.actionId;
      }
    }
    let attempt = tool.attempts.find(item => item.id === event.toolCallId);
    if (!attempt) {
      attempt = { id: event.toolCallId, title: event.title, status: 'running', detail: '', seq: event.seq };
      tool.attempts.push(attempt);
    }
    if (event.type === 'tool_pending') {
      // A stale pending event must not overwrite a returned attempt.
      if (attempt.status !== 'running') return;
      attempt.status = state.status === 'cancelled' ? 'cancelled' : 'running';
      attempt.detail = event.detail || (attempt.status === 'cancelled' ? '任务已停止，此调用未确认完成。' : '正在等待工具返回。');
    } else {
      attempt.status = event.type === 'tool_error' ? 'error' : event.outcome.status;
      attempt.detail = event.type === 'tool_error' ? event.detail || '工具调用异常，其他步骤可以继续。' : event.outcome.detail;
      if (event.outcome?.submitted) tool.physicalCompletionConfirmed = false;
      if (event.outcome?.recovery) attempt.recovery = event.outcome.recovery;
    }
    // A result for an older retry does not replace the latest attempt state.
    const latest = tool.attempts.reduce((a, b) => b.seq >= a.seq ? b : a);
    tool.status = latest.status;
    tool.detail = latest.detail;
    if (latest.recovery) tool.recovery = latest.recovery;
    const agent = state.agents.find(item => item.id === tool.agentRunId);
    if (agent && ['assigned', 'waiting'].includes(agent.status) && tool.status === 'running') {
      agent.status = 'processing';
      state.warnings = state.warnings.filter(item => item.id !== `input:${agent.id}`);
    }
    return;
  }
  if (event.type === 'artifact') {
    if (!event.id || !event.downloadUrl || state.artifacts.some(item => item.id === event.id)) return;
    const owner = resolveOwner(state, event, temporaryIds);
    if (owner && !state.agents.some(item => item.id === owner)) entryTarget(state, owner, event.seq);
    state.artifacts.push({ id: event.id, name: event.name, mimeType: event.mimeType,
      downloadUrl: event.downloadUrl, downloadable: true, agentRunId: owner || null, seq: event.seq });
    return;
  }
  if (event.type === 'error') {
    const owner = resolveOwner(state, event, temporaryIds);
    if (owner && !state.agents.some(item => item.id === owner)) entryTarget(state, owner, event.seq);
    state.warnings.push({ id: event.eventId, agentRunId: owner || null, message: event.message, seq: event.seq });
    return;
  }
  if (event.type === 'stop_requested') {
    if (!terminal) { state.status = 'stopping'; state.current = '正在停止，已完成的结果会保留'; }
    return;
  }
  if (event.type === 'done') {
    if (state.status === 'processing') { state.status = 'confirming'; state.current = '输出已结束，等待任务完成确认'; }
    return;
  }
  if (event.type === 'message_status' || event.type === 'Message.status') {
    if (event.duration !== undefined) state.duration = event.duration;
    if (terminal || !['processing', 'waiting', 'confirming', 'stopping', ...TERMINAL].includes(event.status)) return;
    if (event.status === 'waiting' && state.pausedAt === null) state.pausedAt = event.at;
    if (event.status !== 'waiting' && state.pausedAt !== null) {
      state.pausedSeconds += Math.max(0, (event.at - state.pausedAt) / 1000);
      state.pausedAt = null;
    }
    if (TERMINAL.has(event.status)) state.endedAt = event.at;
    state.status = event.status;
    state.current = event.current || ({ success: '任务已完成', error: '任务未完成，已有结果已保留',
      cancelled: '任务已停止，已有结果已保留', processing: '正在思考', waiting: '等待你补充',
      confirming: '等待任务完成确认', stopping: '正在停止' }[event.status]);
    if (event.status === 'cancelled') {
      for (const tool of state.tools) {
        for (const attempt of tool.attempts) {
          if (attempt.status === 'running') { attempt.status = 'cancelled'; attempt.detail = '任务已停止，此调用未确认完成。'; }
        }
        if (tool.status === 'running') { tool.status = 'cancelled'; tool.detail = '任务已停止，此调用未确认完成。'; }
      }
      for (const agent of state.agents) if (!TERMINAL.has(agent.status)) agent.status = 'cancelled';
    }
  }
}

function deriveCurrent(state) {
  for (const agent of state.agents) {
    const owned = state.tools.filter(tool => tool.agentRunId === agent.id);
    const running = owned.filter(tool => tool.status === 'running').at(-1);
    agent.current = agent.status === 'waiting' ? '等待你补充'
      : agent.status === 'assigned' ? '任务已分配，等待开始'
        : running ? toolActivity(running)
          : owned.length ? toolActivity(owned.at(-1))
            : TERMINAL.has(agent.status) ? (agent.status === 'success' ? '子任务已完成' : '子任务未完成') : '正在思考';
    agent.currentStatus = ['waiting', 'assigned', ...TERMINAL].includes(agent.status) ? agent.status
      : running ? running.status : owned.at(-1)?.status || 'processing';
  }
  if (TERMINAL.has(state.status) || ['waiting', 'stopping', 'confirming'].includes(state.status)) {
    state.currentStatus = state.status;
    return;
  }
  const rootTools = state.tools.filter(tool => !tool.agentRunId);
  const running = rootTools.filter(tool => tool.status === 'running').at(-1);
  const activeAgents = state.agents.filter(agent => agent.status === 'processing');
  if (running) { state.current = toolActivity(running); state.currentStatus = running.status; }
  else if (activeAgents.length) { state.current = `${activeAgents.length} 项任务正在进行`; state.currentStatus = 'processing'; }
  else if (state.agents.some(agent => agent.status === 'waiting')) { state.current = '等待你补充'; state.currentStatus = 'waiting'; }
  else if (state.agents.some(agent => agent.status === 'assigned')) { state.current = '任务已分配，等待开始'; state.currentStatus = 'assigned'; }
  else if (state.agents.length) { state.current = '子任务已返回，等待主控汇总'; state.currentStatus = 'processing'; }
  else if (rootTools.length) { state.current = toolActivity(rootTools.at(-1)); state.currentStatus = rootTools.at(-1).status; }
  else { state.current = '正在思考'; state.currentStatus = 'processing'; }
}

/**
 * Rebuild by authoritative seq. Receiving result(seq 3) before pending(seq 2)
 * therefore produces the same view as normal delivery. eventId is idempotent.
 */
export function reduceExecution(state, event) {
  if (!state) state = createExecution();
  if (!event || typeof event !== 'object') return state;
  if (!PROGRESS_EVENTS.has(event.type || event.event)) return state;
  if ((event.type || event.event) === 'commentary' && event.public !== true) return state;
  if (event.taskRunId && event.taskRunId !== state.id) return state;
  const existing = state._events || [];
  const seq = Number.isFinite(event.seq) ? event.seq : Math.max(0, ...existing.map(item => item.seq)) + 1;
  const key = event.eventId || `${event.type || event.event}:${event.toolCallId || event.agentRunId || event.id || ''}:${seq}:${event.status || ''}`;
  if ((state._seen || []).includes(key)) return state;
  const normalized = normalizeEvent(event, seq, key, existing.length);
  const journal = [...existing, normalized].sort((a, b) => a.seq - b.seq || a._arrival - b._arrival);
  const next = createExecution({ id: state.id, owner: state.owner, ownerAgentRunId: state.ownerAgentRunId,
    mode: state.mode, startedAt: state.startedAt });
  next.duration = state.duration;
  const temporaryIds = new Set();
  for (const item of journal) applyEvent(next, item, temporaryIds);
  deriveCurrent(next);
  next.entries.sort((a, b) => a.seq - b.seq);
  next.agents.forEach(agent => agent.entries.sort((a, b) => a.seq - b.seq));
  next._events = journal;
  next._seen = [...(state._seen || []), key];
  return next;
}

/** Historical text stays historical text; never synthesize Runtime facts. */
export function normalizeLegacyExecution(message = {}) {
  if (message.execution?.entries && message.execution?.tools) return message.execution;
  // Legacy UI aliases ("done", "complete") are not Message.status=success.
  const known = message.messageStatus || message.status;
  const state = createExecution({ id: message.id || 'legacy', owner: message.sender || 'mushsci', mode: message.mode || 'direct' });
  state.legacy = true;
  state.status = ['processing', 'waiting', 'confirming', 'stopping', ...TERMINAL].includes(known) ? known : 'unknown';
  state.duration = message.duration || '';
  state.current = '历史执行描述（未提供结构化过程）';
  if (message.process) state.entries.push({ id: `${state.id}:legacy`, type: 'commentary',
    text: message.processPublic === true ? String(message.process) : '此历史记录未保存可公开展示的结构化执行过程。', seq: 0, legacy: true });
  return state;
}

// -------------------------------------------------------------------------
// Prototype-only fixtures. These lifecycle events require additional backend
// support and are never generated by interpreting current V1 tool names.
// -------------------------------------------------------------------------
export const DEMO_EVENTS = [
  { phase: 0, type: 'commentary', public: true, text: '我会先确认研究范围，再分别梳理文献证据与课题可行性，最后合并成适合组会讨论的建议。', current: '确认研究范围与已有资料' },
  { phase: 0, type: 'tool_pending', toolCallId: 'context', title: '读取研究要求与已有资料', kind: 'file', stepId: 'context', groupTitle: '读取研究资料' },
  { phase: 1, type: 'tool_result', toolCallId: 'context', title: '读取研究要求与已有资料', publicSummary: '研究范围：钙钛矿太阳能电池稳定性；结合已有成果，避免重复检索。', result: { ok: true } },
  { phase: 1, type: 'commentary', public: true, text: '我已分配文献检索、课题比较和资料核对三项任务；资料核对由临时创建的文献整理助手处理。各项结果返回后，由我统一汇总。' },
  { phase: 1, type: 'agent_created', agentRunId: 'papers', name: '论文检索', kind: 'profile', task: '整理稳定性研究的代表性论文、研究热点与证据缺口。', summary: '任务已分配，等待开始' },
  { phase: 1, type: 'agent_created', agentRunId: 'materials', name: '材料科学专家', kind: 'profile', task: '结合已有资料，比较课题的科学价值、实验难度与可行性。', summary: '任务已分配，等待开始' },
  { phase: 1, type: 'agent_created', agentRunId: 'literature-worker', name: '文献整理助手', kind: 'temp', task: '核对已上传资料的名称与出处，供主控引用；不另行检索论文。', summary: '任务已分配，等待开始' },
  { phase: 1, type: 'commentary', agentRunId: 'papers', public: true, text: '我会围绕界面退化、离子迁移和测试条件整理证据，并区分共识与尚待验证的结论。' },
  { phase: 1, type: 'commentary', agentRunId: 'materials', public: true, text: '我会从现有实验条件出发比较候选方向，不重复发起文献检索。' },
  { phase: 2, type: 'tool_pending', agentRunId: 'papers', toolCallId: 'paper-search', title: '检索稳定性相关论文', kind: 'search', stepId: 'evidence', groupTitle: '检索与整理文献证据' },
  { phase: 2, type: 'agent_status', agentRunId: 'papers', status: 'processing', summary: '正在检索与整理文献证据' },
  { phase: 2, type: 'tool_pending', agentRunId: 'materials', toolCallId: 'material-read', title: '读取已有研究成果', kind: 'file', stepId: 'feasibility', groupTitle: '读取与比较候选方向' },
  { phase: 2, type: 'agent_status', agentRunId: 'materials', status: 'processing', summary: '正在读取研究成果' },
  { phase: 2, type: 'tool_pending', agentRunId: 'literature-worker', toolCallId: 'literature-read', title: '读取 已上传资料的名称与出处', kind: 'file', stepId: 'literature-source' },
  { phase: 3, type: 'tool_result', agentRunId: 'literature-worker', toolCallId: 'literature-read', publicSummary: '已上传资料的名称与出处已读取。', result: { ok: true } },
  { phase: 3, type: 'agent_status', agentRunId: 'literature-worker', status: 'success', summary: '资料名称与出处已核对，结果已交回主控' },
  { phase: 3, type: 'tool_result', agentRunId: 'papers', toolCallId: 'paper-search', title: '检索稳定性相关论文', publicSummary: '相关论文检索结果已返回。', result: { success: true } },
  { phase: 3, type: 'commentary', agentRunId: 'papers', public: true, text: '文献部分已整理完成。我已保留研究条件与证据缺口，交由主责 Agent 统一核对。' },
  { phase: 3, type: 'agent_status', agentRunId: 'papers', status: 'success', summary: '已整理候选论文与证据缺口，待主责核对' },
  { phase: 3, type: 'tool_result', agentRunId: 'materials', toolCallId: 'material-read', title: '读取已有研究成果', publicSummary: '已有成果读取完成，后续比较基于这些资料。', result: { ok: true } },
  { phase: 3, type: 'tool_pending', agentRunId: 'materials', toolCallId: 'material-compare', title: '比较课题价值与实验可行性', kind: 'skill', stepId: 'feasibility', groupTitle: '读取与比较候选方向' },
  { phase: 3, type: 'agent_status', agentRunId: 'materials', status: 'processing', summary: '正在比较候选课题的实验可行性' },
  { phase: 4, type: 'tool_result', agentRunId: 'materials', toolCallId: 'material-compare', title: '比较课题价值与实验可行性', publicSummary: '候选方向已按价值、难度与实验条件比较，风险与依赖条件已注明。', result: { ok: true } },
  { phase: 4, type: 'commentary', agentRunId: 'materials', public: true, text: '候选课题的比较已完成。建议同时查看预期价值与实验条件，再选择优先投入的方向。' },
  { phase: 4, type: 'agent_status', agentRunId: 'materials', status: 'success', summary: '已完成三个候选方向的比较，待主责核对' },
  { phase: 4, type: 'commentary', public: true, text: '三项子任务都已返回。我正在合并文献证据、可行性判断与资料出处，保留结论差异，并把依赖条件写进最终建议。' },
  { phase: 4, type: 'tool_pending', toolCallId: 'synthesis', title: '合并证据与候选课题建议', kind: 'file', stepId: 'synthesis', groupTitle: '整理两路执行结果' },
  { phase: 5, type: 'tool_result', toolCallId: 'synthesis', title: '合并证据与候选课题建议', publicSummary: '文献证据、候选课题建议与资料出处已合并到最终回复。', result: { success: true } },
  { phase: 5, type: 'done' },
  { phase: 6, type: 'message_status', status: 'success' },
];

const DIRECT_DEMO_EVENTS = [
  { phase: 0, type: 'commentary', public: true, text: '我会先读取当前研究要求与已有成果，再整理本次任务的结果。', current: '读取需求与已有资料' },
  { phase: 0, type: 'tool_pending', toolCallId: 'direct-context', title: '读取研究要求与已有资料', kind: 'file', stepId: 'context', groupTitle: '读取研究资料' },
  { phase: 1, type: 'tool_result', toolCallId: 'direct-context', title: '读取研究要求与已有资料', publicSummary: '当前需求与已有资料读取完成。', result: { ok: true } },
  { phase: 1, type: 'commentary', public: true, text: '本次由我直接处理，不额外创建子 Agent。', current: '执行专业分析' },
  { phase: 2, type: 'tool_pending', toolCallId: 'direct-work', title: '分析研究资料并整理建议', kind: 'skill', stepId: 'work', groupTitle: '分析资料并整理建议' },
  { phase: 3, type: 'commentary', public: true, text: '资料处理中。我会把依据不足的判断单独说明。', current: '整理研究判断与依据' },
  { phase: 4, type: 'tool_result', toolCallId: 'direct-work', title: '分析研究资料并整理建议', publicSummary: '分析工具已返回，正在整理最终回复。', result: { ok: true } },
  { phase: 4, type: 'commentary', public: true, text: '资料已处理，我正在把结论、依据和限制一起整理到回复中。', current: '整理最终回复' },
  { phase: 5, type: 'done' },
  { phase: 6, type: 'message_status', status: 'success' },
];

export function getDemoExecution({ id = 'demo', owner = 'mushsci', mode = 'coord', phase = 0,
  status = 'processing', startedAt = null, duration = 0 } = {}) {
  const safePhase = Math.max(0, Math.min(6, Number.isFinite(phase) ? Math.floor(phase) : 0));
  let state = createExecution({ id, owner, mode, startedAt });
  const events = mode === 'direct' ? DIRECT_DEMO_EVENTS : DEMO_EVENTS;
  events.forEach((event, index) => {
    if (event.phase <= safePhase) state = reduceExecution(state, { ...event, eventId: `${id}:demo:${index}`, seq: index + 1 });
  });
  const requested = statusOf(status);
  if (requested === 'stopping') state = reduceExecution(state, { type: 'stop_requested', eventId: `${id}:stop` });
  if (requested === 'waiting') state = reduceExecution(state, { type: 'message_status', status: 'waiting', eventId: `${id}:waiting` });
  if (TERMINAL.has(requested) && state.status !== requested) state = reduceExecution(state, {
    type: 'message_status', status: requested, eventId: `${id}:terminal:${requested}`,
  });
  state.duration = duration;
  state.demo = true;
  state.phase = safePhase;
  return state;
}
