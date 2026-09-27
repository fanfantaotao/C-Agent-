import json
from pathlib import Path

p = Path(r"C:\Users\Administrator\Desktop\PM资产\C端产品内部设计\mushsci-workspace-prototype\src\messages.json")
data = json.loads(p.read_text(encoding="utf-8"))

# Ensure addressed follow-ups are explicit @ so sample matches direct mode
for m in data:
    text = m.get("text") or ""
    if m.get("sender") == "LI" and text.startswith("材料科学专家"):
        if not text.startswith("@材料科学专家"):
            text = "@材料科学专家" + text[len("材料科学专家"):]
            m["text"] = text
            html = m.get("html") or ""
            if "@材料科学专家" not in html:
                html = html.replace(
                    "<div><div><div>材料科学专家",
                    '<div><div><div><button class="avatar-tag" data-mention="材料科学专家">@材料科学专家</button><br/>',
                    1,
                )
                # fallback: plain replace of leading name in html content
                if "data-mention=\"材料科学专家\"" not in html and "<div><div><div>" in html and "材料科学专家" in html:
                    html = html.replace(
                        "材料科学专家",
                        '<button class="avatar-tag" data-mention="材料科学专家">@材料科学专家</button><br/>',
                        1,
                    )
                m["html"] = html
        m["mode"] = "direct"
    if m.get("sender") == "LI":
        t = m.get("text") or ""
        if t.startswith("材料科学专家") and not t.startswith("@材料科学专家"):
            m["mode"] = "direct"

# Append an explicit un-@ coordination example at the end (rules 1/2/6/9)
coord_user_id = "sample-coord-user"
coord_main_id = "sample-coord-main"
if not any(m.get("id") == coord_user_id for m in data):
    data.append(
        {
            "id": coord_user_id,
            "sender": "LI",
            "local": False,
            "mode": "coord",
            "time": "18:20",
            "duration": "",
            "process": "",
            "quote": "",
            "task": False,
            "text": "请把前面讨论的三个候选方向，整理成一页可执行的推进清单，不用点名具体智能体。",
            "html": "<div><div><div>请把前面讨论的三个候选方向，整理成一页可执行的推进清单，不用点名具体智能体。</div></div></div>",
        }
    )
    data.append(
        {
            "id": coord_main_id,
            "sender": "mushsci",
            "kind": "main",
            "mode": "coord",
            "local": False,
            "time": "18:21",
            "duration": "已处理 12秒",
            "process": "已处理 12秒\n未指定智能体 · 主控接收并拆分任务\n已创建临时智能体「清单速记」并分发子任务 · 任务结束后自动消失\n已分发给画像智能体 · 并行受 LLM API 调用限制\n临时智能体已完成并销毁 · 不可 @ / 不可跨任务复用\n主控统一汇总反馈",
            "quote": "回复\nLI：请把前面讨论的三个候选方向，整理成一页可执行的推进清单，不用点名具体智能体。",
            "task": False,
            "text": "回复\nLI：请把前面讨论的三个候选方向，整理成一页可执行的推进清单，不用点名具体智能体。\n已按未 @ 任务处理：由主控拆分并分发，统一反馈如下。",
            "html": "<div><div><div><h3>主控统一反馈 · 候选方向推进清单</h3><p>你未指定智能体，本任务由主控 <strong>mushsci</strong> 拆分后分发：</p><ol><li><strong>光热耦合界面钝化</strong> — 补光热老化对照，明确原位 PL 表征排期</li><li><strong>宽湿度窗口制备</strong> — 验证 20%–93% 湿度窗口在本组器件上的可复现性</li><li><strong>组件封装可靠性</strong> — 整理加速老化标准差异，列出户外实证缺口</li></ol><p class=\"policy-note\">过程含临时智能体「清单速记」（单次任务，结束后消失，不可 @）；并行数量受 LLM API 调用限制（待技术补充）。子智能体完成后由主控统一反馈。</p></div></div></div>",
        }
    )

# Only mark non-sample explicit-@ replies as direct; coord pair already set
for m in data:
    t = m.get("text") or ""
    if m.get("sender") == "LI" and t.startswith("@"):
        m["mode"] = "direct"
    if m.get("sender") in ("论文检索", "材料科学专家") and "@" in (m.get("quote") or t):
        m["mode"] = "direct"

p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print("messages", len(data))
print("last modes", [(m["sender"], m.get("mode")) for m in data[-2:]])
