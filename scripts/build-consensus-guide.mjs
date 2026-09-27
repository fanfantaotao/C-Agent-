import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// A deliberately small renderer for this document's Markdown subset. There are
// no downloads, third-party scripts, or runtime dependencies in the exported HTML.
const source=new URL('../../多Agent执行过程规则-共识图解版.md',import.meta.url);
const destination=new URL('../../多Agent执行过程规则-共识图解版.html',import.meta.url);
const markdown=await readFile(source,'utf8');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const inline=text=>escape(text)
  .replace(/`([^`]+)`/g,'<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
  .replace(/\[([^\]]+)\]\(([^\s)]+)\)/g,'<a href="$2">$1</a>');
const cell=(title,body,extra='')=>`<div class="diagram-cell ${extra}"><strong>${title}</strong><span>${body}</span></div>`;
const arrow='<div class="diagram-arrow" aria-hidden="true">→</div>';
const diagrams={
  pipeline:`<figure class="diagram" aria-labelledby="pipeline-title"><figcaption id="pipeline-title">图 1 · 从执行事实，到用户能读懂的汇报</figcaption><div class="flow three">${cell('① 系统提供事实','任务、工具调用、结果<br>文件、异常、任务状态')}${arrow}${cell('② 整理层解释事实','认清负责人 · 同一次调用更新<br>判断结果 · 过滤内部内容','highlight')}${arrow}${cell('③ 页面分层呈现','主对话：进展和结果摘要<br>右侧：子任务过程、文件预览')}</div><p class="diagram-note">没有可信事实，就标为待确认；不替后台编造执行过程。</p></figure>`,
  workspace:`<figure class="diagram" aria-labelledby="workspace-title"><figcaption id="workspace-title">图 2 · 主对话看全局，右侧看细节</figcaption><div class="workspace-map"><section class="main-map"><div class="map-label">主对话 / 主责 MushSCI</div><p class="narrative">我会分别核对研究证据和实验条件，再合并建议。</p><div class="tool-line">⌄ 主责的重要工具动作</div><div class="summary-row"><span class="dot active"></span><div><b>材料科学专家 · 进行中</b><small>正在比较实验条件</small></div></div><div class="summary-row selected"><span class="dot ended"></span><div><b>论文检索 · 已结束</b><small>已标注证据与缺口</small></div><span aria-hidden="true">→</span></div><div class="map-result"><b>主责汇总 / 最终答复</b><p>结论、证据差异、条件限制，以及正式保存的成果。</p></div></section><section class="side-map"><div class="map-label">右侧共享工作区 <span>可收起</span></div><div class="map-tabs"><span class="chosen">论文检索</span><span>材料评估</span><span>研究报告</span></div><h4>论文检索</h4><p class="assignment">本次分工：核对已有研究证据与缺口。</p><p>我先读取已有报告，再核对不同测试条件。</p><div class="tool-line">⌄ 核对已有成果</div><div class="map-result"><b>返回给主责的结果</b><p>证据摘要、待补缺口与测试限制。</p></div><small class="read-only">只读 · 不提供单个子任务停止</small></section></div><p class="diagram-note">结构说明图，非新的原型截图。右侧占据布局宽度，不覆盖或灰化主对话。</p></figure>`,
  states:`<figure class="diagram" aria-labelledby="states-title"><figcaption id="states-title">图 3 · 任务状态与连接状态分别判断</figcaption><div class="state-label">任务的常见路径</div><div class="state-flow">${cell('排队','等待执行')}${arrow}${cell('执行中','发生真实动作')}${arrow}${cell('确认结果','传输结束，终态未到','highlight')}${arrow}${cell('已完成 / 失败','后台确认最终结果')}</div><div class="branch"><b>用户请求停止</b><span aria-hidden="true">→</span><b>正在停止</b><span aria-hidden="true">→</span><b>后台确认后：已停止</b></div><div class="branch waiting"><b>明确需要信息</b><span aria-hidden="true">→</span><b>等待用户补充</b></div><div class="connection"><b>连接线（单独判断）</b><span>已连接 → 连接中断 → 正在恢复</span><strong>断线 ≠ 已停止</strong></div><p class="diagram-note">不是强制状态机：终态可直接到达；停止与成功的冲突由后台裁定。</p></figure>`,
  delivery:`<figure class="diagram" aria-labelledby="delivery-title"><figcaption id="delivery-title">图 4 · 先接入可信过程，再接入可信协作</figcaption><div class="flow three">${cell('第一阶段','真实单层进展<br>前提：调用关联 + 任务最终状态')}${arrow}${cell('第二阶段','真实多 Agent 协作<br>前提：权威身份 + 生命周期','highlight')}${arrow}${cell('恢复能力验收','断线、重入、回补、取消竞态<br>前提：持久化 + 恢复契约')}</div><p class="diagram-note">这是交付建议，不是工期承诺。若上线要求断线后可靠继续使用，恢复能力必须纳入上线验收。</p></figure>`,
};

const lines=markdown.split(/\r?\n/);
const blocks=[],headings=[];
let index=0,diagramKey=null,section=0;
const isStart=line=>/^(#{1,3} |\| |[-*] |\d+\. |>|```|<!--)/.test(line);
while(index<lines.length){
  const line=lines[index];
  if(!line.trim()){index++;continue}
  const marker=line.match(/^<!-- diagram:(\w+) -->$/);
  if(marker){diagramKey=marker[1];index++;continue}
  if(line.startsWith('```')){
    const code=[];index++;
    while(index<lines.length&&!lines[index].startsWith('```'))code.push(lines[index++]);
    index++;
    blocks.push(diagramKey&&diagrams[diagramKey]?diagrams[diagramKey]:`<pre><code>${escape(code.join('\n'))}</code></pre>`);
    diagramKey=null;continue;
  }
  const heading=line.match(/^(#{1,3}) (.+)$/);
  if(heading){
    const level=heading[1].length,title=heading[2];
    const id=level===2?'section-'+(++section):'heading-'+index;
    if(level===2)headings.push({id,title});
    blocks.push(`<h${level} id="${id}">${inline(title)}</h${level}>`);index++;continue;
  }
  if(line.startsWith('| ')){
    const rows=[];
    while(index<lines.length&&lines[index].startsWith('| '))rows.push(lines[index++]);
    const split=row=>row.slice(1,-1).split('|').map(value=>value.trim());
    const head=split(rows[0]);
    const body=rows.slice(2).map(row=>`<tr>${split(row).map(value=>`<td>${inline(value)}</td>`).join('')}</tr>`).join('');
    blocks.push(`<div class="table-scroll"><table><thead><tr>${head.map(value=>`<th scope="col">${inline(value)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`);continue;
  }
  if(/^[-*] |^\d+\. /.test(line)){
    const ordered=/^\d+\. /.test(line),items=[];
    const pattern=ordered?/^\d+\. (.+)$/:/^[-*] (.+)$/;
    while(index<lines.length&&pattern.test(lines[index]))items.push(lines[index++].replace(pattern,'$1'));
    const tag=ordered?'ol':'ul';blocks.push(`<${tag}>${items.map(item=>`<li>${inline(item)}</li>`).join('')}</${tag}>`);continue;
  }
  if(line.startsWith('> ')){blocks.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);index++;continue}
  const paragraph=[line];index++;
  while(index<lines.length&&lines[index].trim()&&!isStart(lines[index]))paragraph.push(lines[index++]);
  blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
}

const content=blocks.join('\n');
const numbered=number=>headings.find(heading=>heading.title.startsWith(number+'.'))?.id;
const route=(name,label,numbers)=>`<a class="route" href="#${numbered(numbers[0])}"><strong>${name}</strong><span>${label}</span><small>重点章节 ${numbers.join(' / ')}</small></a>`;
const html=`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>多 Agent 执行过程 · 共识图解版</title><style>
:root{--ink:#25303e;--muted:#657181;--line:#dee5ec;--paper:#fff;--bg:#f3f5f7;--blue:#365b86;--soft:#edf3f9;--amber:#785c22}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:35px}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.85 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif}a{color:var(--blue);text-underline-offset:3px}a:focus-visible{outline:3px solid #527ca4;outline-offset:4px}strong{font-weight:650}code{padding:2px 5px;border-radius:4px;background:#eef1f5;color:#475869;font:12px/1.7 Consolas,monospace}pre{overflow:auto;padding:20px;background:#f4f7fa;border:1px solid var(--line);border-radius:8px;white-space:pre}pre code{padding:0;background:transparent}p{margin:13px 0}ul,ol{padding-left:24px}li{padding:3px 0;break-inside:avoid}
.page{display:grid;grid-template-columns:210px minmax(0,980px);gap:32px;max-width:1280px;padding:40px 28px 70px;margin:auto}.toc{position:sticky;top:30px;align-self:start;max-height:calc(100vh - 60px);overflow:auto;font-size:12px;line-height:1.65}.toc-title{display:block;color:#586777;letter-spacing:.1em;margin-bottom:16px;font-size:11px}.toc a{display:block;padding:7px 11px;margin:2px 0;text-decoration:none;color:#697687;border-left:2px solid transparent}.toc a:hover{background:#e7edf3;color:#2c527a;border-left-color:#5f7d9e}.toc .source-link{margin-top:18px;border-top:1px solid var(--line);padding-top:16px}
main{min-width:0}.cover{background:#243c55;color:#fff;padding:35px 38px 30px;border-radius:12px 12px 0 0}.kicker{font-size:11px;letter-spacing:.14em;color:#b9cbdb}.cover h1{font-size:31px;font-weight:650;line-height:1.4;letter-spacing:-.03em;margin:10px 0 14px}.cover p{max-width:710px;margin:0;color:#d9e4ee;font-size:15px;line-height:1.8}.cover-foot{display:flex;flex-wrap:wrap;gap:10px 22px;color:#b7c9d9;font-size:11px;margin-top:23px}.routes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));background:#fff;border:1px solid var(--line);border-top:0;gap:0}.route{padding:20px 23px;text-decoration:none;display:flex;flex-direction:column;gap:4px;min-width:0;border-right:1px solid var(--line)}.route:last-child{border-right:0}.route:hover{background:#f1f6fa}.route strong{font-size:14px;color:#36526f}.route span{font-size:12px;color:#677b8d}.route small{font-size:10px;color:#8191a2}
.document{background:var(--paper);border:1px solid var(--line);border-top:0;border-radius:0 0 12px 12px;padding:27px 38px 42px}.document>h1{font-size:20px;margin:0 0 7px}.document>h1+p{font-size:12px;color:var(--muted);margin:0 0 20px}h2{font-size:23px;line-height:1.5;color:#2e455c;margin:49px 0 19px;padding-top:23px;border-top:1px solid var(--line);break-after:avoid}h3{font-size:17px;line-height:1.6;color:#35516c;margin:27px 0 12px;break-after:avoid}blockquote{margin:20px 0;padding:16px 19px;border-left:4px solid #5b7a98;background:var(--soft);color:#36516e;font-size:16px;line-height:1.8}
.table-scroll{overflow-x:auto;margin:18px 0 23px;border:1px solid var(--line);border-radius:7px}table{width:100%;border-collapse:collapse;font-size:12.5px;line-height:1.75;table-layout:auto}th{background:#eef3f7;color:#465e75;text-align:left;font-weight:650;white-space:normal}td,th{vertical-align:top;padding:12px 13px;border-bottom:1px solid #e4eaf0;border-right:1px solid #e8edf2;overflow-wrap:anywhere;min-width:85px}td:last-child,th:last-child{border-right:0}tbody tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:#fafbfd}td:first-child{font-weight:500;color:#3d5165}table code{font-size:11px}
.diagram{margin:23px 0 28px;padding:22px;background:#f8fafc;border:1px solid #dce5ee;border-radius:9px;break-inside:avoid}.diagram figcaption{font-size:12px;font-weight:650;color:#58718b;margin-bottom:20px}.flow{display:grid;grid-template-columns:minmax(0,1fr) 26px minmax(0,1fr) 26px minmax(0,1fr);align-items:stretch;gap:6px}.diagram-cell{display:flex;flex-direction:column;gap:10px;border:1px solid #d8e2ec;border-radius:7px;background:#fff;padding:17px 14px;color:#53677c;font-size:11px;line-height:1.85}.diagram-cell>strong{color:#335270;font-size:13px}.diagram-cell.highlight{border-color:#8ba6c0;background:#edf4fa}.diagram-arrow{align-self:center;justify-self:center;font-size:23px;color:#8497aa}.diagram-note{font-size:11px;line-height:1.75;color:#738496;margin:17px 0 0}
.workspace-map{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);background:#fff;border:1px solid #d8e1eb;border-radius:7px;overflow:hidden}.main-map{padding:20px}.side-map{padding:20px;border-left:1px solid #d8e1eb;background:#fff;font-size:11px;color:#617184}.map-label{font-size:10px;font-weight:650;letter-spacing:.02em;color:#6f8193;padding-bottom:13px;border-bottom:1px solid #e3eaf1}.map-label>span{float:right;font-weight:400}.narrative{font-size:12px;color:#33465b;font-weight:550;margin:17px 0}.tool-line{font-size:10px;color:#8a95a3;padding:7px 0}.summary-row{display:flex;align-items:center;gap:9px;padding:11px 8px;border-radius:5px}.summary-row>div{flex:1;min-width:0}.summary-row b{font-weight:550;font-size:11px;color:#57697c}.summary-row small{display:block;font-size:10px;color:#8794a3;margin-top:3px}.summary-row.selected{background:#eef3f8}.dot{display:inline-block;flex:none;width:6px;height:6px;border-radius:50%;background:#998250}.dot.ended{background:#b26376}.map-result{margin-top:17px;padding-top:14px;border-top:1px solid #e4ebf2;font-size:11px;color:#697b8d}.map-result p{margin:6px 0}.map-result b{font-weight:550;color:#3c566f}.map-tabs{display:flex;gap:3px;margin:14px 0 19px;font-size:9px;white-space:nowrap;overflow:auto}.map-tabs span{padding:5px 6px;background:#f3f5f8;color:#8b98a5;border-bottom:2px solid transparent}.map-tabs span.chosen{background:#edf3f9;border-bottom-color:#8199b6;color:#466380}.side-map h4{margin:0;color:#36516b;font-size:14px}.assignment{padding-bottom:12px;border-bottom:1px solid #e4ebf2}.read-only{display:block;font-size:9px;color:#8a96a3;margin-top:19px}
.state-label{font-size:11px;color:#6a7d90;margin-bottom:10px}.state-flow{display:grid;grid-template-columns:1fr 18px 1fr 18px 1.2fr 18px 1.2fr;gap:4px}.state-flow .diagram-cell{padding:13px 9px;text-align:center;font-size:10px;gap:5px}.state-flow .diagram-cell>strong{font-size:11px}.state-flow .diagram-arrow{font-size:18px}.branch{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;font-size:11px;margin-top:17px;color:#866648;padding:13px;border:1px dashed #d8c6b2;border-radius:6px;background:#fcfaf6}.branch b{font-weight:500}.branch.waiting{color:#697487;background:#f6f8fb;border-color:#d7e0ea}.connection{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#eaf0f6;border-radius:6px;padding:14px;font-size:11px;margin-top:20px;color:#687d93}.connection strong{margin-left:auto;color:#456685;font-weight:650}
.endnote{font-size:11px;color:#7e8b99;margin-top:24px;text-align:center}.print-tip{font-size:10px;color:#8a96a3;margin:15px 11px}
@media(max-width:1020px){.page{grid-template-columns:165px minmax(0,1fr);gap:20px;padding:25px 18px}.document{padding:24px 26px}.cover{padding:27px}.flow{grid-template-columns:1fr;gap:9px}.diagram-arrow{transform:rotate(90deg)}.state-flow{grid-template-columns:1fr 18px 1fr}.state-flow .diagram-arrow{transform:none}.state-flow>.diagram-arrow:nth-child(4){display:none}.state-flow>.diagram-cell:nth-child(5){grid-column:1}.state-flow>.diagram-cell:nth-child(7){grid-column:3}}
@media(max-width:700px){.page{display:block;padding:15px 12px}.toc{display:none}.cover{padding:25px 22px}.cover h1{font-size:25px}.routes{grid-template-columns:1fr}.route{padding:14px 22px;border-right:0;border-bottom:1px solid var(--line)}.route:last-child{border-bottom:0}.route small{display:none}.document{padding:24px 19px;font-size:14px}h2{font-size:20px}.diagram{padding:16px}.workspace-map{grid-template-columns:1fr}.side-map{border-left:0;border-top:1px solid #d8e1eb}.table-scroll table{min-width:540px}.connection strong{margin-left:0}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@page{size:A4;margin:16mm}
@media print{html{scroll-behavior:auto}body{background:#fff;color:#1f2d3b;font-size:10pt;line-height:1.7}.page{display:block;max-width:none;padding:0;margin:0}.toc,.print-tip{display:none}.cover{border-radius:0;background:#fff!important;color:#233c54;border-bottom:2px solid #456889;padding:0 0 20px}.cover h1{font-size:24pt}.cover p,.cover-foot,.kicker{color:#526a7d}.routes{border:0;border-bottom:1px solid #cbd6e1}.route{padding:14px 8px}.document{padding:20px 0;border:0}.document>h1{display:none}h2{font-size:16pt;margin-top:30px}h3{font-size:12pt}a{color:inherit;text-decoration:none}code{font-size:8pt}.table-scroll{overflow:visible;border-radius:0}.table-scroll table{min-width:0;font-size:8.5pt}td,th{padding:7px 8px;min-width:0}thead{display:table-header-group}tr{break-inside:avoid}.diagram{padding:15px;box-shadow:none;border-radius:0}.diagram figcaption{font-size:9pt}.flow{grid-template-columns:minmax(0,1fr) 20px minmax(0,1fr) 20px minmax(0,1fr)}.diagram-arrow{transform:none}.diagram-cell{font-size:8pt;padding:10px;line-height:1.7}.diagram-cell>strong{font-size:9pt}.state-flow{grid-template-columns:1fr 18px 1fr 18px 1.2fr 18px 1.2fr}.state-flow>.diagram-arrow:nth-child(4){display:block}.state-flow>.diagram-cell:nth-child(5),.state-flow>.diagram-cell:nth-child(7){grid-column:auto}.workspace-map{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr)}.side-map{border-left:1px solid #d8e1eb;border-top:0}blockquote{font-size:11pt;break-inside:avoid}.endnote{font-size:8pt}}
</style></head><body><div class="page"><nav class="toc" aria-label="文档目录"><strong class="toc-title">共识图解版 / CONTENTS</strong>${headings.map(heading=>`<a href="#${heading.id}">${escape(heading.title)}</a>`).join('')}<a class="source-link" href="./多Agent执行过程规则-共识图解版.md">可编辑 Markdown</a><a href="./mushsci-workspace-prototype/EXECUTION_AGGREGATION_RULES.md">原开发技术规则</a><p class="print-tip">离线可读 · 无外部依赖<br>浏览器 Ctrl/Cmd + P 可打印或另存为 PDF</p></nav><main><header class="cover"><div class="kicker">MUSHSCI · EXECUTION PROCESS / SHARED UNDERSTANDING</div><h1>把执行过程，<br>变成大家都看得懂的工作汇报。</h1><p>同一份规则，三种阅读入口。解释用户看到什么、系统怎样判断，以及真实上线还需要补齐什么。</p><div class="cover-foot"><span>老板 / 产品经理 / 开发</span><span>2026-09-27 · 共识图解版</span><span>原技术版保留不变</span></div></header><div class="routes" aria-label="按角色阅读">${route('老板','价值、交付范围、上线风险',[1,2,8,9])}${route('产品经理','页面表现、异常、验收',[3,4,5,6,10])}${route('开发','整理逻辑、数据契约、规则索引',[4,7,8])}</div><article class="document">${content}</article><footer class="endnote">执行过程规则说明 · 图为结构示意，不是真实运行证据 · 技术事实 / 产品规则 / 待补齐能力分开判断</footer></main></div></body></html>`;

if(/https?:\/\//.test(html))throw new Error('Unexpected external dependency or URL');
if(headings.length!==14)throw new Error('Unexpected document structure: '+headings.length);
await writeFile(destination,html,'utf8');
console.log(fileURLToPath(destination));
console.log('Sections: '+headings.length+'; diagrams: '+Object.keys(diagrams).length+'; offline HTML: '+Buffer.byteLength(html)+' bytes');
