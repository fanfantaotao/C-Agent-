# 完整示例与右侧工作区检查

final result: blocked

检查日期：2026-09-27。代码、测试和单文件原型已更新；本轮没有取得新版实际浏览器截图或点击证据，视觉及交互验收仍未通过。

## 1. 比较目标与证据状态

- Source visual truth path：`audit/codex-reference.png`，以及本轮用户的 6 张浏览器批注附件。附件 1 明确要求非模态、推动中间区域、兼容文件预览及多标签。
- 用户批注元数据的 CSS viewport：2224 × 1234；聊天中显示的附图经过缩放，原像素密度未知，不进行像素级比较。Codex 参考图为布局层级参考，浅色 MushSCI 品牌是已确定差异。
- Implementation：`standalone.html`，本地预览 http://127.0.0.1:4173/ 。Implementation screenshot path：无，本轮未能捕获。
- 待捕获状态：完整 13 条示例、末条协作执行流、两个子任务和一个文件标签、收起/展开、成员弹窗、PPT 失败；桌面与 390 × 844 窄屏。
- Source / implementation 同尺寸比较、density normalization、full-view 与 focused-region comparison：均未执行。不是“相似度通过”。
- `audit/` 内此前的 implementation/comparison 图属于旧版扁平执行流，不作为本轮证据。

## 2. 阻塞原因

Product Design image-to-code / design-qa 要求实际页面截图、同源比较与交互复核。内置浏览器插件本轮再次在初始化阶段失败：

`Cannot find module .../browser/26.924.22138/scripts/browser-service.mjs`

本机目录只有 `26.915.31945`。未改插件缓存，未用替代 CDP/Playwright 绕过受支持的浏览器通道。预览 HTTP 200 仅证明服务可达，不能证明页面运行或视觉正确。

## 3. 非浏览器验证

| 项目 | 结果 |
| --- | --- |
| 最新本地构建 | `npx vite build` 通过 |
| 执行模型、流、面板、示例与协作组件测试 | 68 项通过，0 失败；含 6 项共享面板 SSR DOM 合同 |
| 原示例恢复 | 13 条正文、quote、time、task、sender、mode 等原字段逐条保留 |
| 已保存数据迁移 | 缩减示例恢复全文并保留后续消息；保存编辑优先；空聊天和无关新任务不被填充 |
| 两级归属 | 主流保留主责过程，子工具/旁白仅在对应 Agent 详情 |
| 面板模型 | 去重、激活、相邻标签关闭、折叠保留、最后标签移除、CLEAR |
| 成员页面 | profile + official 兼容、无人类/临时成员、无管理/改方向、@ 范围禁用 |
| 真实性 | 后台交接不等于调研完成；PPT 规划保留但生成失败，无虚假下载 |
| 单文件导出 | 两份 HTML 更新为 470,499 bytes |

这些是纯函数、源码合同与服务端渲染检查，不是浏览器焦点、滚动、挂载保活效果或视觉验收的证明。

测试命令：

`node --test src/executionModel.test.js tests/execution-ui.test.mjs tests/panel-model.test.mjs tests/sample-messages.test.mjs tests/workspace-compat.test.mjs tests/workbench-ui.test.mjs`

## 4. 已实施修改与代码审查修复

- 右侧工作区是 `main` 的 flex sibling，桌面默认 440px；折叠为 42px 轨道，无固定 overlay/背景蒙层/焦点 trap。主区及输入栏随剩余宽度布局。
- Agent/file 使用同一个 tab reducer；Agent ID 包含 run，文件按文件 ID 去重。所有已打开内容持续挂载，切换/折叠使用 hidden。
- Agent 详情每次从 messages 的最新 execution 查询；不会冻结打开时快照、随事件自动切换标签或抢主区滚动。
- 关闭最后标签在下一帧布局恢复后返还焦点；打开标签后聚焦 active tab；文件引用在窄屏收起后再聚焦输入框。设置弹窗的延迟焦点恢复不再覆盖这些操作。
- 完成历史首次打开从顶部阅读；进行中的详情仅在读者位于底部时跟随。
- 文件读取当前对话已有示例正文；表格就地横向滚动。引用删除守卫继续生效，下载标注“下载示例”。
- 移除人类项目成员及计数、所有 Agent 管理/创建/改方向入口；“子智能体”兼容画像与官方来源。没有虚构官方应用成员。
- 仅删除云端运行环境入口，保留云盘附件和首页上传文件。个人首访引导保留。
- 两条缩减示例不再是默认数据。新的公开演示执行记录不解析旧 process 思考文本。

本轮代码审查修复不计为视觉 QA iteration，因为没有 post-fix 截图比较。

## 5. 必须补验的 fidelity surfaces

| 表面 | 当前结论 | 下一步实际比较 |
| --- | --- | --- |
| Fonts / typography | 未验 | 主责正文、灰色动作行、侧栏小字的字号、行高、字重、中文换行与长标题截断 |
| Spacing / layout rhythm | 未验 | 与用户参考同宽比较三栏比例、内容宽度、输入栏跟随、间距、长报告和表格溢出 |
| Colors / tokens | 未验 | 浅色品牌保留，检查文字对比度、选中标签、灰色工具和错误状态 |
| Image quality / assets | 未验 | 既有 mascot/avatar 资产未替换；仍须实际查看缩放、清晰度及图标对齐 |
| Copy / content | 正文/字段合同通过，视觉未验 | 完整示例能否读全，子智能体来源文案、只读说明、示例下载、空态与失败提示 |

## 6. 实际浏览器待验清单

1. 完整 13 条示例可逐段浏览，长报告、三维表格、补充论文、引用跳转、任务卡、PPT 失败仍在。
2. 从末条协作或新演示打开两个子任务，归属正确；再打开文件，共存三个标签。重复打开不新增标签。
3. 主区真实收窄，输入栏不被盖住；面板无蒙层，可以继续操作主区。折叠恢复宽度和当前标签。
4. 标签切换/折叠时，阅读位置与手动工具展开保留；新的进展不切换标签。完成历史从顶部打开。
5. Tab、左右键、Home/End、Delete、关闭按钮与收起按钮焦点正确；关闭最后标签回到主区。
6. 窄屏面板展开/收起/关闭/引用后主区与焦点恢复，长标题、表格不破坏布局。
7. “协作智能体”弹窗无人类、管理、改方向入口；子智能体支持已有画像及配置的官方来源；会话外 @ 不可用。
8. 输入栏无云端环境按钮；本地和云盘附件仍可用。已删除引用不能再次添加。
9. 协作/@直达、停止确认、队列编辑/取消/自动出队、未发送草稿和阅读位置无回归。
10. 实际 console errors、缩放与 reduced motion 检查。

## 7. 生产边界

- 多 Agent 生命周期仍是显式演示，不代表当前 HiMAT V1 已具有 run ID、Agent 父子关系或独立取消。
- 后端公开内容清洗、业务 schema、重连、取消、artifact 权限与真实下载仍需联调。
- 本轮不涉及 Sites 托管。此前 Sites 包装测试因缺失 `dist/server/index.js` 未通过，保留已有配置，未将本地 Vite 构建冒称托管构建通过。
