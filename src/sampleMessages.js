import sourceMessages from './messages.json' with {type: 'json'};
import {createExecution, reduceExecution} from './executionModel.js';

/**
 * The full original conversation with explicitly authored, public demo traces.
 * These fixtures are not reconstructed Runtime facts: legacy `process` prose
 * is never parsed for Agent ownership, success, tool events or commentary.
 * Original HTML / quotations / task cards remain owned by messages.json.
 */
const note = (text, current) => ({type: 'commentary', public: true, text, ...(current ? {current} : {})});
const pending = (toolCallId, title, kind, stepId, groupTitle, agentRunId) => ({
  type: 'tool_pending', toolCallId, title, kind, stepId, groupTitle,
  ...(agentRunId ? {agentRunId} : {}),
});
const returned = (toolCallId, publicSummary, agentRunId, result = {ok: true}) => ({
  type: 'tool_result', toolCallId, publicSummary, result,
  ...(agentRunId ? {agentRunId} : {}),
});

function replay({id, owner, mode = 'direct', duration, status = 'success', current, events}) {
  let execution = createExecution({id, owner, mode});
  events.forEach((event, index) => {
    execution = reduceExecution(execution, {...event, taskRunId: id, eventId: `${id}:sample:${index}`, seq: index + 1});
  });
  execution = reduceExecution(execution, {
    type: 'done', taskRunId: id, eventId: `${id}:sample:stream-end`, seq: events.length + 1,
  });
  execution = reduceExecution(execution, {
    type: 'message_status', taskRunId: id, eventId: `${id}:sample:terminal`, seq: events.length + 2,
    status, current, duration,
  });
  execution.demo = true;
  return execution;
}

const executions = {
  '7687925651361235246': () => replay({
    id: '7687925651361235246', owner: '论文检索', duration: '34秒',
    current: '后台调研任务已提交，等待后续报告',
    events: [
      note('我会按钙钛矿太阳能电池稳定性这一范围提交后台调研；这条回复先确认交接，完整报告稍后返回。'),
      pending('research-handoff', '提交后台深度调研任务', 'tool', 'handoff', '提交后台任务'),
      returned('research-handoff', '后台任务已建立。本条记录仅表示任务交接成功，不表示论文调研已完成。'),
      note('后台任务已提交。研究背景、代表性工作、技术瓶颈和候选课题将由后续报告承接。'),
    ],
  }),
  '7687926107072643338': () => replay({
    id: '7687926107072643338', owner: '材料科学专家', duration: '未记录',
    current: '已确认分析范围，等待论文检索报告',
    events: [
      note('我已确认后续分析只使用论文检索助手的已有结果，不重复检索。'),
      note('本次先确认三维度分析的范围；报告返回后再开展科学价值、创新空间与实验难度的评估。'),
    ],
  }),
  '7687927367855194377': () => replay({
    id: '7687927367855194377', owner: '论文检索', duration: '16秒',
    current: '研究简报已整理，报告正文保留如下',
    events: [
      note('后台调研报告已返回。我会读取既有成果，整理适合组会讨论的研究简报，不把本条回复当作重新调研。'),
      pending('research-report-read', '读取钙钛矿电池稳定性研究报告', 'file', 'report', '读取与整理研究报告'),
      returned('research-report-read', '已有报告读取完成；研究背景、代表性工作和技术瓶颈已纳入正文。'),
      pending('research-evidence-read', '读取报告中的候选方向与证据摘要', 'file', 'report', '读取与整理研究报告'),
      returned('research-evidence-read', '报告中的候选方向与证据摘要已读取；原报告入口仍为原型预览。'),
      note('简报包含近期代表性研究、尚未解决的问题和三个候选方向，供后续专业评估继续引用。'),
    ],
  }),
  '7687927901802660142': () => replay({
    id: '7687927901802660142', owner: '材料科学专家', duration: '51秒',
    current: '三维评估已完成，沿用已有文献证据',
    events: [
      note('论文检索报告已经返回。我会直接基于报告的结论评估三个方向，不重新发起论文检索。'),
      pending('assessment-report-read', '读取论文检索报告', 'file', 'assessment-input', '读取已有研究成果'),
      returned('assessment-report-read', '既有报告已读取，代表性论文、技术瓶颈与研究热点作为判断依据。'),
      pending('assessment-context-read', '读取当前课题需求与候选方向', 'file', 'assessment-input', '读取已有研究成果'),
      returned('assessment-context-read', '已确认硕士阶段的研究范围，以及报告中的三个候选方向。'),
      note('我会逐项说明科学价值、创新空间和实验难度，并注明每个判断引用的报告结论。'),
      note('三维评估已整理完成；实验条件仍需结合课题组实际设备和周期进一步确认。'),
    ],
  }),
  '7687928601840451891': () => replay({
    id: '7687928601840451891', owner: '论文检索', duration: '1分56秒',
    current: '方向一的五篇补充论文已整理',
    events: [
      note('我只补充方向一“光热耦合应力下的多功能界面钝化策略”，并先对照已有报告，避免重做整个任务。'),
      pending('supplement-report-read', '读取已有报告与方向一的范围', 'file', 'supplement-context', '读取已有成果'),
      returned('supplement-report-read', '已有覆盖范围已核对，本次补充限定在方向一。'),
      note('我会将补充论文与已有文献区分开，整理核心策略、稳定性条件和与该方向的关联。'),
      pending('supplement-search', '检索方向一的补充论文', 'search', 'supplement-evidence', '检索与核对补充论文'),
      returned('supplement-search', '补充候选论文已返回，后续核对限定在同一研究方向。'),
      pending('supplement-pages', '读取候选论文的公开研究信息', 'search', 'supplement-evidence', '检索与核对补充论文'),
      returned('supplement-pages', '候选论文的公开题名、研究策略与测试条件已读取。'),
      note('五篇补充论文和对照表已整理如下。这里展示的是原型历史示例，不是本次新增的实时检索结果。'),
    ],
  }),
  '7687930438286950665': () => replay({
    id: '7687930438286950665', owner: 'mushsci', duration: '6分46秒', status: 'error',
    current: 'PPT 图片生成未完成，六页规划已保留',
    events: [
      note('我只组织前面已经完成的研究结果，先读取报告与三维评估，再规划六页组会 PPT，不重复检索或分析。'),
      pending('ppt-report-read', '读取研究报告与三维评估结果', 'file', 'ppt-input', '读取已有研究成果'),
      returned('ppt-report-read', '两位专业智能体的既有成果已读取。'),
      pending('ppt-skill', '读取 PPT 技能与所选模板说明', 'skill', 'ppt-planning', '准备六页 PPT 规划'),
      returned('ppt-skill', '已按所选学术技术模板准备六页规划，使用图片技术栈。'),
      pending('ppt-plan', '初始化页面与六页内容规划', 'command', 'ppt-planning', '准备六页 PPT 规划'),
      returned('ppt-plan', '六页内容与页面规划已建立；这不表示幻灯片图片或 PPT 文件已经生成。'),
      note('页面规划已准备。我会尝试生成六页图片；只有生成并保存成功后，才会出现可下载产出。'),
      pending('ppt-images', '生成六页 PPT 图片', 'tool', 'ppt-generation', '生成 PPT 图片'),
      // Prototype business code: BALANCE_FAILED in HiMAT means chemical
      // equation balancing failed, not an account credit balance error.
      returned('ppt-images', '图片生成因积分不足未成功，未生成可下载 PPT。原示例记录说明未消耗积分。', null, {success: false, code: 'INSUFFICIENT_CREDITS'}),
      {type: 'error', publicMessage: '图片生成未完成，六页规划已保留。补充积分后可重新尝试；当前不自动重试。'},
      note('当前图片生成未完成，已有规划保留。补充积分后可以重新尝试，或另行选择 SVG 生成方案。'),
    ],
  }),
  'sample-coord-main': () => replay({
    id: 'sample-coord-main', owner: 'mushsci', mode: 'coord', duration: '12秒',
    current: '推进清单已统一整理',
    events: [
      note('我会沿用前面的研究简报、三维评估和补充论文，把三个候选方向整理成可执行的推进清单。'),
      pending('checklist-context', '读取当前会话中的既有成果', 'file', 'checklist-context', '读取清单依据'),
      returned('checklist-context', '既有研究结果已读取，本次不重复开展整轮研究。'),
      note('我将证据与测试缺口交给论文检索复核，将实验依赖交给材料科学专家整理，并临时创建文献整理助手核对资料出处。三项结果由我统一汇总。'),
      {type: 'agent_created', agentRunId: 'checklist-papers', name: '论文检索', kind: 'profile', task: '基于已有报告核对三个方向的文献证据、测试标准差异与待补缺口，不重新检索整个任务。', summary: '任务已分配，等待开始'},
      {type: 'agent_created', agentRunId: 'checklist-materials', name: '材料科学专家', kind: 'profile', task: '基于已有三维评估，列出三个方向的实验动作、先后依赖与待确认条件。', summary: '任务已分配，等待开始'},
      {type: 'agent_created', agentRunId: 'checklist-worker', name: '文献整理助手', kind: 'temp', task: '核对已有研究简报与补充论文的资料出处，供主控引用；不开展新一轮检索。', summary: '任务已分配，等待开始'},
      {...note('我会复核已有研究简报，整理推进时仍需注明的证据与测试条件。'), agentRunId: 'checklist-papers'},
      pending('checklist-paper-read', '读取研究简报与补充论文摘要', 'file', 'checklist-evidence', '核对证据与测试缺口', 'checklist-papers'),
      returned('checklist-paper-read', '研究简报与补充论文摘要已读取。', 'checklist-papers'),
      {...note('已核对光热老化对照、湿度窗口复现与户外证据缺口；不同测试条件下的稳定性指标不能直接等同。'), agentRunId: 'checklist-papers'},
      {type: 'agent_status', agentRunId: 'checklist-papers', status: 'success', summary: '已标注三个方向的证据与测试缺口，待主责合并'},
      {...note('我会把已有评估转成具体实验动作，保留设备、表征排期与长期测试依赖。'), agentRunId: 'checklist-materials'},
      pending('checklist-assessment-read', '读取三维评估与实验限制', 'file', 'checklist-feasibility', '整理实验依赖与推进顺序', 'checklist-materials'),
      returned('checklist-assessment-read', '已有三维评估与实验限制已读取。', 'checklist-materials'),
      {...note('已整理原位 PL 表征排期、20%–93% 湿度窗口复现及封装老化验证的待确认条件。'), agentRunId: 'checklist-materials'},
      {type: 'agent_status', agentRunId: 'checklist-materials', status: 'success', summary: '已整理三个方向的实验动作与条件依赖，待主责合并'},
      pending('checklist-worker-read', '读取 研究简报与补充论文的资料出处', 'file', 'checklist-sources', '读取资料出处', 'checklist-worker'),
      returned('checklist-worker-read', '研究简报与补充论文的资料出处已读取。', 'checklist-worker'),
      {type: 'agent_status', agentRunId: 'checklist-worker', status: 'success', summary: '资料出处已核对，结果已交回主控'},
      note('三项子任务结果已返回。我正在合并为一页推进清单，保留证据缺口、实验依赖与资料出处，避免把建议描述为已完成的实验。'),
      pending('checklist-merge', '合并证据缺口与实验推进动作', 'file', 'checklist-merge', '整理统一推进清单'),
      returned('checklist-merge', '推进清单已整理到最终回复。没有把实验建议冒称为已经完成的实验。'),
    ],
  }),
};

export const FULL_SAMPLE_MESSAGES = sourceMessages.map(message => executions[message.id]
  ? {...message, execution: executions[message.id]()}
  : {...message});

const fullById = new Map(FULL_SAMPLE_MESSAGES.map(message => [message.id, message]));
const shortenedIds = new Set(['execution-demo-user', 'execution-demo-main']);

/**
 * Upgrade only identified prototype samples, never an arbitrary user chat.
 * An empty saved chat is an intentional deletion. Saved sample edits win over
 * source HTML/quotes; only their authored demo execution is upgraded.
 */
export function upgradeSavedSample(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const upgrade = message => {
    const sample = fullById.get(message?.id);
    return sample?.execution ? {...message, execution: sample.execution} : message;
  };
  if (messages.some(message => shortenedIds.has(message?.id))) {
    const savedById = new Map(messages.filter(message => fullById.has(message?.id)).map(message => [message.id, message]));
    const restored = FULL_SAMPLE_MESSAGES.map(sample => {
      const saved = savedById.get(sample.id);
      return saved ? upgrade({...sample, ...saved}) : {...sample};
    });
    const laterMessages = messages.filter(message => !shortenedIds.has(message?.id) && !fullById.has(message?.id));
    return [...restored, ...laterMessages];
  }
  if (messages.some(message => fullById.has(message?.id))) return messages.map(upgrade);
  return messages;
}
