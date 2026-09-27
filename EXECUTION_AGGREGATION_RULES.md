# MushSCI 执行流｜事件 → 语义 → 两级 UI 规则

> 历史接入草案。当前 MVP **不做语义聚合**，当前需求见 [MVP_EXECUTION_RULES.md](./MVP_EXECUTION_RULES.md)。临时 Worker 在主流可见头像和任务摘要，点击进入右侧详情；停止后重新尝试为新执行。本文冲突规则已被本轮用户决定覆盖。

版本：V1.0 草案｜开发联调用。更新：2026-09-27。范围：单条任务执行流，不替代完整个人智能体 PRD。

## 1. 目标、事实与决策

用户在主对话中应能回答：谁负责、谁在做什么、哪些子任务已结束、结果是否可用、是否需要介入。需要了解具体过程时，打开对应子任务详情。

### 事实依据

| 材料 | 已知事实 | 不代表什么 |
| --- | --- | --- |
| 《HiMAT 智能体执行事件盘点》 | 平台 Message/block/tool/artifact/error/done；MCP 业务事件通常返回后判断 | 不证明已有 Agent 生命周期、调用关联 ID 或内部实时阶段 |
| 《个人智能体助手 V0.2 MVP》 | 默认主责、单个 @、长期角色范围、临时 Worker 隐藏、排队、停止、恢复 | 不授权即时 steer 或执行中任意变更角色范围 |
| 共享对话最终方向 | 主线程看摘要，子任务线程看过程，主责统一收口 | 不证明 Codex 私有聚合算法能照搬 |

Codex 官方文档支持子 Agent 独立上下文与主 Agent 接收汇总的组织方式，见 [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)。本规则是 HiMAT 产品/技术契约，不声称官方公开了 Codex 内部聚合算法。

### 本轮设计决策

- 两级执行流：一级主对话，二级子任务详情侧栏；连续浅色叙事，不做仪表盘。
- 真实事件先经过独立语义适配层，原始技术日志不直接作为 UI。
- 工具不是 Agent；主责按消息路由，不按工具名决定。
- 当前原型演示目标态，未接通真实多 Agent Runtime。

### 待确认

子任务独立停止仍待用户选择。确认前本轮详情仅查看，不开放独立停止；即使用户选择开放，也需先确定取消作用域、依赖影响与接口。

PRD 使用 MuchSci，原型使用 MushSCI；本文沿用原型命名，指同一默认主责，不新增角色。

## 2. 范围与优先级

| 优先级 | 交付 | 前提 |
| --- | --- | --- |
| P0 / V1 | 主责公开过程、同调用更新、工具业务结果、正式产物、done 确认态、任务停止/失败 | 现有事件 + 补齐调用关联与消息终态读取 |
| P0 / V2 | 主流子任务摘要、当前活动、详情过程、主责收口 | 权威 Agent run/父子关系/生命周期与摘要 |
| P1 | 重连回补、恢复快照、顺序去重、失败队列衔接 | 持久化与回补契约签字 |
| 非目标 | 原始 Trace 浏览器、思维链、即时 steer、子任务独立停止、临时 Worker 独立成员、多人协作 | 另立需求；本轮不模拟为已具备 |

P0 不允许为了上线虚构 Agent 或完成状态。契约缺失时退回消息主责下的单层真实流；目标态 UI 可以隐藏，事实不能猜。

## 3. 三层职责

```text
Runtime 原始事实/持久化快照
  → 语义适配层：关联 → 去重 → 业务解析 → 状态归一化 → 展示摘要
    → UI：主流 / 子任务详情 / 折叠 / 滚动 / 操作入口
```

| 层 | 必须提供/执行 | 禁止 |
| --- | --- | --- |
| Runtime | 权威归属、生命周期、业务结果、可恢复快照、操作确认 | 仅旁白承诺，没有执行对象 |
| 语义适配层 | 按 ID 归并、业务 outcome、来源、工具组、当前活动、终态协调 | 推断身份、补出未收到的内部阶段 |
| UI | 两级结构、稳定 item ID、可访问操作、保留阅读状态 | 解析 success:false、猜阶段、凭文字完成 |

产品负责规则/文案边界；Runtime/适配层负责人实现并回放验证；前端消费归一化快照。适配层暂放前端也必须是独立纯函数/reducer，不散落组件分支。

## 4. 数据契约：原生与待补充分开

### 4.1 盘点已确认的原生数据

- `Message.status`：processing、success、error、cancelled。
- block：`blockId`、内容类型、文本/结构化数据、结束事件。
- tool：pending 的工具名/参数，result 的结果，error 的错误。
- artifact：文件 ID、类型和下载信息。
- usage/error/done，以及工具返回结果中的 MCP 业务标记。

盘点**没有确认**可靠 toolCallId/eventId/seq/taskRunId/agentRunId 或父子关系。下述是待开发契约，不是现有接口承诺。

### 4.2 最小补充契约

| 待补字段/能力 | 用途 | 缺失时退化 |
| --- | --- | --- |
| messageId、taskRunId | 消息与本次执行关联；重试不是原 run | 不做跨 run 拼接 |
| eventId、单 run 单调 seq、时间戳 | 去重、排序、耗时 | 不承诺可靠回放/恢复，明确状态未同步 |
| toolCallId、attempt、stepId | 同调用原位更新；重试区分；分组边界 | 不按同名工具或最后一次 pending 强配对 |
| agentRunId、parentAgentRunId、roleKind、显示名 | 子任务归属，长期/临时区分 | 不展示独立子 Agent；工具留在消息主责下 |
| 委派目标、公开活动、结果摘要、来源 | 子任务摘要 | 无活动时显示执行中，不生成假精确动作 |
| Agent lifecycle 或等价快照 | queued/running/waiting/success/error/cancelled | 不以工具成功推定子任务完成 |
| 取消请求 ID、作用域、确认状态 | 两阶段停止与竞态 | 不显示未经确认的已停止 |
| snapshot version/lastSeq、补发/查询 | 断线/重入恢复 | 正在同步/连接中断，不转已停止 |

建议统一信封；字段名可改，语义不能省：

```ts
type EventEnvelope = {
  eventId: string;
  seq: number; // 同一 taskRun 内单调、可回补
  taskRunId: string;
  messageId: string;
  emittedAt: string;
  type: string;
  agentRunId?: string;
  parentAgentRunId?: string;
  stepId?: string;
  toolCallId?: string;
  attempt?: number;
  payload: unknown;
};
```

工具 payload 的 ok/success、空列表、业务事件结构需逐工具登记，不靠 UI 搜关键字。冲突或无法识别时为 unknown，不默认成功。

### 4.3 归一化快照

```ts
type ExecutionSnapshot = {
  taskRunId: string;
  messageId: string;
  owner: { agentRunId: string; name: string; route: 'default' | 'direct' };
  taskState: 'queued' | 'running' | 'confirming' | 'waiting-input'
    | 'stopping' | 'success' | 'error' | 'cancelled';
  transportState: 'open' | 'ended' | 'disconnected';
  lastSeq: number;
  items: PublicItem[]; // 主责公开段落/工具组/通知/产物，稳定 ID
  children: AgentView[]; // 权威归属的长期子任务
};
type ToolOutcome = 'running' | 'success' | 'empty' | 'degraded'
  | 'failed' | 'submitted' | 'unknown';
```

摘要保留来源 ID，可追溯原始事实；敏感参数/输出仅用于安全后台诊断，不默认发页面。

主责的显示名与运行 ID 必须分离。原型适配器使用 `ownerAgentRunId`，或显式 `scope:'root'` 标识主责事件；`owner` 只用于显示。真实主责可能名为“论文检索”而 run ID 为 `owner-run-42`，不能靠二者相等关联工具或产物。

### 4.4 Reducer 最小执行顺序

1. 校验信封与归属；不能关联的事件放待关联缓存/诊断，不绑到“最近运行的 Agent”。
2. 按 eventId 去重；按 seq 回放。收到同一 ID 不同 payload 时记录数据冲突，等待快照纠正，不生成第二条 UI 行。
3. 依据消息/run/Agent/call/attempt 找到原记录；没有 pending 而先收到 result 时建立同 ID 的待补记录，随后 pending 补信息不能让结果退回 running。
4. 使用该工具已登记的 schema 归一化业务 outcome；再更新调用和业务组，不直接改变整任务终态。
5. 根据明确公开阶段/活动/摘要更新对应 AgentView；再生成主流摘要。不得扫工具名反推角色。
6. 最后协调 Message 终态、取消确认和快照版本；输出新快照，稳定 item/group ID 不变。组件的折叠/选择/滚动状态不属于 reducer，不被每次快照重置。

业务判定采用工具专属解析器：显式传输异常为 failed；已登记“正常无结果”模式为 empty；显式业务失败为 failed；Robot 提交成功为 submitted；明确可用结果为 success；无法确认或字段互相冲突为 unknown。降级恢复只有在原失败、备用方式及备用可用结果可关联到同一 action 时成立，不能仅出现 BACKEND_FALLBACK 就判成功。

本文类型与事件名称是接入语义示意，不是本次原型源码 API 声明；生产接口与实现字段需在 A1–A8 联调签字时落实。

## 5. 核心规则表

一级=主对话，二级=子任务详情。事件属于主责时，必要工具组可在一级；属于子 Agent 时，工具细节只进二级。

| 规则 | 输入事实 | 语义聚合/状态 | 一级展示 | 二级展示 |
| --- | --- | --- | --- | --- |
| R01 | Message processing + 路由 | 建 run，主责固定 | 主责、耗时、已有公开活动 | 权威子 run 后才有详情 |
| R02 | block_created/content/done | 按 blockId patch；明确公开内容 | 公开进展与最终正文各归其位 | 子公开内容顺序更新 |
| R03 | thinking/内部 prompt/调试内容 | 不进 PublicItem | 不显示思考 | 同样不显示 |
| R04 | tool_pending + call ID | 建调用，running | 更新 Agent 当前活动；主责可有工具组 | 创建运行行，默认展开 |
| R05 | 同 call/attempt 的 result/error | 原位置 patch，不添第二动作 | 更新活动/结果摘要 | 同行转 outcome |
| R06 | 新 call ID/attempt | 新调用，与原尝试关联 | 必要时提示重试/恢复 | 保留原异常与新尝试 |
| R07 | 同 run/step/action 且连续 | 同业务组，保留子调用先后 | 一句业务摘要 | 可展开组内调用 |
| R08 | 不同 Agent/step/action，或新公开阶段 | 不因同工具名跨阶段合并 | 保留任务/阶段边界 | 新组，旧组不搬动 |
| R09 | result + 已登记成功标记 | success | 可用结果摘要 | 成功结果/引用，不泄露原输出 |
| R10 | result + ok/success=false 或业务失败 | failed，非传输成功 | 子异常/恢复中，不判整任务失败 | 失败原因、保留成果与恢复 |
| R11 | NO_RESULT/EMPTY_RESULT/空列表 | empty，正常结束 | 未找到匹配结果 | 非故障样式；条件摘要 |
| R12 | tool_error → fallback → 可用结果 | 同 action，degraded | 备用方式获得结果 | 原异常与备用成功，不抹错/双算 |
| R13 | MCP 内部阶段随 result 返回 | 已发生过程，不当实时活动 | 汇总结果 | 可展开已知过程，不倒插实时阶段 |
| R14 | FILE_CREATED/path，无 artifact | 待保存，不可下载 | 可提示文件待保存 | 无下载按钮 |
| R15 | artifact | 正式产物，按 fileId 去重 | 正式产物入口 | 所属任务可打开/下载 |
| R16 | ROBOT_E3/success:true | submitted，执行未知 | 指令已提交，动作状态未知 | 不称动作已完成 |
| R17 | done，无 Message 终态 | transport ended，confirming | 正在确认结果 | 无权威子终态不得完成 |
| R18 | Message success/error/cancelled | 权威整任务终态，保留局部事实 | 已完成/失败/已停止与成果/原因 | 各子任务按其终态，不伪造成功 |
| R19 | error，无主流程失败终态 | 局部/不明作用域通知 | 明确影响范围 | 对应异常，不停止其他任务 |
| R20 | 权威委派与子生命周期 | 创建/更新子摘要 | 目标、正在执行/已结束、摘要 | 目标与本 run 流，不补造工具 |
| R21 | roleKind=temporaryWorker | 归父责后台辅助 | 不创建独立成员 | 在父责业务组保留必要记录 |
| R22 | 取消请求 → 确认 cancelled | stopping → cancelled | 正在停止→已停止，成果保留 | 不产生未授权独立停止 |
| R23 | 停止中/后迟到 result/artifact | 续收，不新动作，不反转终态 | 补记已收结果，不称完成 | 注明停止后收到的结果 |
| R24 | 重复 eventId/乱序 seq/snapshot | 去重、按 seq 回放，同 ID patch | 无重复行，保留折叠 | 不重建详情/抢焦点滚动 |
| R25 | 执行中发新消息/改方向 | FIFO queued，当前 run 不变 | 待发送区 | 不即时 steer |
| R26 | 子任务摘要返回 | 子工具→子结果；子结果→主责答复 | 汇总证据、差异与缺失 | 子结果可追溯，不删除冲突 |

### 分组与摘要边界

首选分组键 `(taskRunId, agentRunId, stepId, businessActionId)`。businessActionId 可由 Runtime 或登记规则生成，不得跨步骤/Agent，不能仅同工具名合并。无权威边界时一调用一组。

活动/结果摘要优先安全进展/结果通道，其次登记模板；“正在处理”比假精确阶段正确。摘要保留无结果、失败、恢复、限制。新摘要可替换当前活动，历史调用仍原位可查。

不同尝试是多条调用，同业务动作可只占一个折叠组；不是删除“重复”动作证据。group ID 建立后保持稳定，不能结果到达时重新分组造成页面跳动。

## 6. 状态机与操作

### 整任务

`queued → running → confirming → success/error/cancelled`。明确缺补充才进 waiting-input；取消请求从运行/确认进 stopping，仅取消确认进 cancelled。

Message 终态可以直接到达，无需等 done。断线只变 transportState，不变失败/停止。Message success 不替子 Agent 推定 success；主责可带空结果/恢复异常完成。

取消确认后，迟到工具/产物可保存。取消与 success 竞态由 Runtime 返回权威最终状态与取消请求结果，前端不按到达顺序裁决。旧 run 的终态不影响重试新 run。

### @ 与队列

未 @ 默认 MushSCI；单 @ 指定专业 Agent 主责。共享工具/临时 Worker 不代表 MushSCI 接管。需要主控协作时须有明确调度事实。

改方向按 PRD 入队，不立即改当前 run。失败/停止暂停受影响队列、保留消息。重试是新 run；修改是新请求；跳过不产生成功产物；依赖缺失继续暂停。

### 子任务独立停止

待用户确认且接口未确认，默认只查看。后续开放前定义：可停止角色、是否级联、主责等待/补偿/部分汇总、依赖影响、迟到结果、权限、幂等；不能只加按钮。

## 7. 回放示例

以下 ID 与 Agent 事件为**待补充契约的示例**，不是盘点已有字段。后端也可提供等价快照。

### A：论文空结果后补查，材料任务并行

| seq | 示例输入 | 主流 | 论文详情 |
| --- | --- | --- | --- |
| 1 | Message processing，owner=MushSCI | 正在处理 | 尚无详情 |
| 2 | agent_delegated(paper,检索已有研究) | 论文任务目标可点 | 委派目标 |
| 3 | agent_delegated(material,分析条件) | 材料任务已分派 | 不混入论文流 |
| 4 | tool_pending(p1,文献检索) | 论文正在检索 | p1 运行 |
| 5 | tool_result(p1,NO_RESULT) | 不称失败 | p1 改未找到结果 |
| 6 | tool_pending(p2,同 action，网络补查) | 正在补充资料 | 同组新 p2，不盖 p1 |
| 7 | tool_result(p2,SEARCH_SUCCESS,3篇) | 获得资料，不判子任务结束 | p2 成功与引用 |
| 8 | agent_completed(paper,3篇摘要) | 论文进已结束，结果摘要 | 结束与可用结果 |
| 9 | agent_completed(material,计算限制) | 材料进已结束 | 不混入论文详情 |
| 10 | 主责公开汇总/最终正文 | 两项结果与限制统一收口 | 内容保留 |
| 11 | done | 正在确认结果 | 不改各子终态 |
| 12 | Message success | 整任务已完成 | 仍可查看 |

### B：失败、恢复与保存

`pending(c1) → result(c1,{success:false,MP_API_ERROR}) → pending(c2,attempt=2,同 action) → result(c2,备用数据源可用) → FILE_CREATED → artifact(f1)`。

主流“备用数据源获得结果”；详情保留 c1 失败、c2 成功，组 degraded。FILE_CREATED 无下载，artifact 后才有正式产物。不把 c1 画成功，不抹错误。

### C：停止后返回

`停止请求 → stopping → tool_result(c3) → Message cancelled → artifact(f2)`。

确认前正在停止，确认后已停止。c3/f2 保留，不恢复任务/创建新 Agent/重规划。如果 Runtime 返回取消未生效且已成功，显示权威状态与请求结果，不能本地覆盖。

## 8. 联调必须签字项

| 项 | 必须确认的契约 | 负责人 |
| --- | --- | --- |
| A1 关联 | result/error 定位唯一 pending，重试区分 attempt | Runtime + 适配层 |
| A2 恢复 | seq 作用域、重复策略、快照版本/补发方式 | Runtime + 前端 |
| A3 Agent | 委派、归属、生命周期、结果的现有事件/快照 | 多 Agent Runtime |
| A4 安全 | 哪类 block 是公开进展；thinking 不进 PublicItem | 模型接入 + 产品 |
| A5 业务 | 各 MCP 成功/空/失败/fallback schema | MCP + 适配层 |
| A6 终态 | done 与 Message 终态推送/查询、超时处理 | Runtime |
| A7 取消 | 确认、迟到事件、success 竞态与断线区别 | Runtime + 产品 |
| A8 文件 | artifact 权限、重复 fileId、保存失败 | 文件服务 + 前端 |
| A9 子停止 | 用户选择；若开放，作用域与依赖策略 | 用户/产品 + Runtime |

未签字项不得假定已存在。A1/A3 未确认时目标态只能用演示 fixture，不能称生产就绪。

## 9. GWT 验收与自动回放

| 编号 | Given | When | Then |
| --- | --- | --- | --- |
| T01 | 已有同 call pending | result 重复到达 | 同行更新，不新增动作 |
| T02 | 同工具两个 step | 两结果返回 | 两组，不跨阶段合并 |
| T03 | 正常请求返回 | success=false | failed，不成功/不整任务完成 |
| T04 | 查询正常返回 | 空列表/NO_RESULT | empty，非故障，可继续 |
| T05 | 首方式失败 | 备用成功 | degraded，原异常与尝试保留 |
| T06 | FILE_CREATED | artifact 未到 | 无下载；artifact 后才可下载 |
| T07 | processing | done，终态未到 | confirming；success 后才完成 |
| T08 | Robot 提交成功 | 无动作执行事件 | submitted，动作状态未知 |
| T09 | 无 Agent run/委派 | 多工具调用 | 只有消息主责，不生成专业 Agent |
| T10 | @专业 Agent | 调共享工具/临时 Worker | 主责不变，Worker 不成成员 |
| T11 | 明确子 run | 子工具调用 | 主流摘要、详情工具，不串其他 Agent |
| T12 | 用户展开详情并上滚 | 新事件/终态 | 保持选中、展开、焦点、阅读位置 |
| T13 | 请求停止 | 未确认取消 | stopping，不 cancelled；迟到不重启 |
| T14 | 断线 | 暂无事件 | 连接提示，非停止；重连无重复 |
| T15 | 执行中 | 新方向消息 | FIFO queued，当前方向不变 |
| T16 | 子结论冲突 | 主责汇总 | 差异、证据、不确定性保留 |
| T17 | thinking block | 流式内容 | 主流/详情均不可见 |
| T18 | 子失败后主责恢复 | 主责权威 success | 整体可成功，局部记录保留 |

适配层用原始 fixture 回放 T01–T11、T13–T18；UI 验证 T12、键盘、窄屏、侧栏关闭返回焦点。构建成功不等于生产联调通过，视觉 QA 单独记录。
