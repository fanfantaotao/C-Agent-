import React,{useState,useEffect,useRef,useReducer} from 'react';
import {ArrowUp,ArrowDown,ArrowUpLeft,ChevronDown,ChevronRight,Plus,X,Search,FileText,FolderOpen,Paperclip,Cloud,Monitor,Mic,Grid2X2,Pin,PinOff,Trash2,Copy,Quote,BookOpen,Lightbulb,Check,CheckCheck,LoaderCircle,Square,Users,Bot,Download,Terminal,Puzzle,Library,ArrowLeft,AlertCircle,Clock,FlaskConical,PanelLeftOpen,PanelRightOpen,PanelRightClose,ListChecks,Info,Timer,UserCog,Layers,Sparkles,Shield,Pencil,Wrench,Eye,Flower2} from 'lucide-react';
import ref from './reference.json';
import sourceMessages from './messages.json';
import ExecutionTrace from './ExecutionTrace.jsx';
import WorkbenchPanel from './WorkbenchPanel.jsx';
import AgentRoster from './AgentRoster.jsx';
import {createPanelState,panelReducer,agentPanelId,filePanelId} from './panelModel.js';
import {FULL_SAMPLE_MESSAGES,upgradeSavedSample} from './sampleMessages.js';
import {getDemoExecution, normalizeLegacyExecution} from './executionModel.js';
import './reference.css';
import './workspace.css';
/* 产品规则：主控默认 MushSCI；未@由主控拆分分发并统一反馈；@直达；画像智能体长期存在；临时智能体仅本轮参与，入口与记录保留 */
const MAIN='mushsci';
const KIND_META={main:{label:'主控',cls:'kind-main'},profile:{label:'画像',cls:'kind-profile'},official:{label:'官方应用',cls:'kind-official'},temp:{label:'临时',cls:'kind-temp'}};
const INITIAL_AGENTS=[
  {id:MAIN,name:MAIN,kind:'main',desc:'主控协调 · 拆分任务并统一反馈用户',direction:'任务协调与成果汇总',tags:[],persistent:true},
  {id:'论文检索',name:'论文检索',kind:'profile',desc:'学术检索、证据整理与研究综述',direction:'学术检索与文献综述',tags:['材料科学硕士','钙钛矿太阳能电池稳定性'],persistent:true},
  {id:'材料科学专家',name:'材料科学专家',kind:'profile',desc:'研究方向评估与实验方案分析',direction:'材料科学方向评估',tags:['材料科学硕士','钙钛矿太阳能电池稳定性'],persistent:true}
];
const PRODUCT_RULES=[
  'MushSCI 为默认主控智能体（协调者）',
  '未 @ 的任务：主控拆分并分发给子智能体，完成后由主控统一反馈',
  '主动 @ 的任务：由指定智能体完成并直接反馈',
  '子智能体可包含由用户画像标签自动创建的画像智能体和官方智能体应用',
  '当前会话仅展示已选定的智能体，不提供管理、创建或修改方向入口',
  '临时智能体由 AI 按任务创建，任务结束后保留入口与执行记录；不可 @，不可跨任务复用',
  '会话内只能 @ 本对话最开始选定范围内的智能体（不含临时智能体）',
  '执行中发送的新请求进入待发送队列，不改变当前任务',
  '多智能体并行受 LLM API 调用限制，数量与作用范围待技术补充',
  '首版上线智能体清单由产品后续提供，原型不预设正式角色与数量',
  '本期不考虑多人协作',
  '引用或文件删除后不可再次引用；历史引用与下游成果展示待补充'
];
const skills=['深度调研','PPT','Excel','网页','图表','设计','播客','话题追踪'];
const plugins=['OpenAlex 学术数据库','Crossref 文献引用溯源','Semantic Scholar 论文搜索','arXiv 论文数据搜索'];
const libraries=['钙钛矿研究资料','我的论文库','课题组共享知识库'];
const BASE_FILES=['钙钛矿电池稳定性研究_report.md','研究方向三维评估.md','补充文献清单.md'];

/* ===== 首访开场引导：不填表、不选标签，描述一句 -> AI 解析 -> AI 为我准备工作环境 ===== */
const ONBOARD_KEY = 'mushsci-onboard-v1';
const ONBOARD_EXAMPLE = '我目前做新能源材料研究，主要关注钙钛矿、第一性原理计算和材料稳定性。';
const FIELD_FALLBACK = '跨领域研究';
/* 自由文本 -> 领域/方法标签。原型用规则匹配模拟「AI 解析」，不调用真实模型 */
const FIELD_RULES = [
  [/新能源|储能|锂电|钠电|固态电池|氢能|燃料电池/, ['新能源材料']],
  [/钙钛矿|太阳能|光伏/, ['钙钛矿光伏']],
  [/第一性原理|DFT|密度泛函|计算材料|分子动力学|仿真|建模/, ['第一性原理计算']],
  [/稳定性|降解|失效|钝化|寿命|衰减/, ['材料稳定性']],
  [/催化|电催化|合成|化学反应/, ['催化与合成']],
  [/高分子|聚合物|复合材料|纳米材料|薄膜|涂层|合金|半导体/, ['材料与器件']],
  [/蛋白|抗原|引物|基因|细胞|药物|疫苗|生物|医学|临床/, ['生物医药']],
  [/机器学习|深度学习|神经网络|大模型|算法|人工智能/, ['机器学习方法']],
  [/水处理|环境|碳排|大气|土壤|生态/, ['环境科学']],
  [/经济|金融|市场|投资|财务|会计/, ['经济与金融']],
  [/问卷|访谈|回归|实证|社会学|社科/, ['社会科学方法']],
  [/数据|统计|可视化|指标/, ['数据分析']]
];
/* 第二问：常用任务多选。选中的工作会预置成技能/插件，并写成任务偏好 */
const TASK_OPTIONS = [
  {id: 'literature', label: '文献检索与综述', Icon: Search, skills: ['深度调研'], plugins: ['Semantic Scholar 论文搜索']},
  {id: 'experiment', label: '实验方案与可行性', Icon: FlaskConical, skills: [], plugins: ['OpenAlex 学术数据库']},
  {id: 'data', label: '数据分析与图表', Icon: Layers, skills: ['Excel', '图表'], plugins: []},
  {id: 'writing', label: '论文写作与投稿', Icon: FileText, skills: [], plugins: ['Crossref 文献引用溯源']},
  {id: 'report', label: '组会汇报与 PPT', Icon: ListChecks, skills: ['PPT'], plugins: []},
  {id: 'patent', label: '专利与项目申报', Icon: Shield, skills: [], plugins: ['Crossref 文献引用溯源']},
  {id: 'track', label: '方向调研与竞品跟踪', Icon: Lightbulb, skills: ['话题追踪'], plugins: ['arXiv 论文数据搜索']},
  {id: 'code', label: '代码与计算脚本', Icon: Terminal, skills: [], plugins: ['arXiv 论文数据搜索']}
];
const getOnboard = () => {try {return JSON.parse(localStorage.getItem(ONBOARD_KEY) || 'null')} catch {return null}};
const onboardSeen = () => {try {return !!localStorage.getItem(ONBOARD_KEY)} catch {return false}};
/* 把用户的一句话解析成 领域 + 画像标签（原型模拟解析，非真实模型） */
const parseDirection = input => {
  const text = String(input || '').trim();
  const tags = [];
  FIELD_RULES.forEach(rule => {if (rule[0].test(text)) rule[1].forEach(t => {if (tags.indexOf(t) < 0) tags.push(t)})});
  const head = text.replace(/^(我(目前|现在|最近)?|本人|我们)?(主要|正在|目前|现在)?(从事|做|负责|在做|研究|关注)?/, '').split(/[，,。；;、\n]/)[0].trim();
  const domain = (head || tags[0] || FIELD_FALLBACK).slice(0, 18);
  return {domain, tags: (tags.length ? tags : [FIELD_FALLBACK]).slice(0, 4)};
};
/* 按「解析结果 + 多选任务」推导出准备清单（供准备态展示，也供落库） */
const onboardPlan = (parsed, taskIds) => {
  const chosen = TASK_OPTIONS.filter(o => taskIds.indexOf(o.id) >= 0);
  const sk = [];
  const pl = [];
  chosen.forEach(o => {(o.skills || []).forEach(x => {if (sk.indexOf(x) < 0) sk.push(x)}); (o.plugins || []).forEach(x => {if (pl.indexOf(x) < 0) pl.push(x)})});
  const domain = (parsed && parsed.domain) || FIELD_FALLBACK;
  const tags = (parsed && parsed.tags) || [FIELD_FALLBACK];
  const labels = chosen.map(o => o.label);
  const items = [
    {t: '读出你的研究方向', d: domain},
    {t: '提取画像标签', d: tags.join('、')},
    {t: '按方向调整专业助手', d: '论文检索 · ' + domain + ' ／ 材料科学专家 · ' + domain},
    {t: '记录常用任务偏好', d: labels.join('、') || '按需记录'},
    {t: '预置技能与插件', d: sk.concat(pl).join('、') || '按需添加'},
    {t: '挂载领域知识库', d: domain + '资料'}
  ];
  return {domain, tags, labels, skills: sk, plugins: pl, chosen, items};
};
/* 把方向写进画像智能体：不新增编造角色，只改现有画像智能体的方向与标签 */
const applyDirectionToRoster = (roster, domain, tags) => roster.map(a => a.kind !== 'profile' ? a : Object.assign({}, a, {
  direction: domain + (a.id === '论文检索' ? ' · 学术检索与综述' : ' · 方向评估与实验方案'),
  tags: (tags && tags.length) ? tags : a.tags
}));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const plain=html=>{const d=document.createElement('div');d.innerHTML=html;return d.innerText;};
const formatMessageTime=(message,now=new Date())=>{
 const raw=message.completedAt??message.finishedAt??message.sentAt??message.createdAt;
 if(raw!==undefined&&raw!==null){
  const date=raw instanceof Date?raw:new Date(raw);
  if(!Number.isNaN(date.getTime())){
   const time=date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
   if(date.toDateString()===now.toDateString())return time;
   const yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
   if(date.toDateString()===yesterday.toDateString())return `${date.getMonth()+1}月${date.getDate()} ${time}`;
   return date.getFullYear()===now.getFullYear()?`${date.getMonth()+1}月${date.getDate()}日 ${time}`:`${date.getFullYear()}年${date.getMonth()+1}月${date.getDate()}日 ${time}`;
  }
 }
 return message.time||'';
};
const getSaved=()=>{try{return JSON.parse(localStorage.getItem('mushsci-workspace-v2')||'null')}catch{return null}};
const restoreDemoMessages=messages=>messages.map(message=>{
 if(!message.execution?.demo||['success','error','cancelled'].includes(message.execution.status))return message;
 const execution={...message.execution,status:'unknown',startedAt:null,current:'页面已重新载入，本地演示未继续运行。可重新演示；这不是服务器任务的停止确认。',agents:message.execution.agents.map(agent=>['success','error','cancelled'].includes(agent.status)?agent:{...agent,status:'unknown'}),tools:message.execution.tools.map(tool=>tool.status==='running'?{...tool,status:'unknown',detail:'本地演示中断，未收到工具结果。'}:tool)};
 return {...message,execution,messageStatus:undefined};
});
const findAgent=(list,id)=>list.find(a=>a.id===id);
const parseMention=(text,list)=>{const m=String(text||'').match(/@([^\s：:，,。]+)/);if(!m)return null;const name=m[1];const hit=list.find(a=>a.id===name||a.name===name);return hit&&hit.kind!=='temp'?hit:null};
/* 收起态图标轨道的数据：直接从 ref.sidebar 这段静态 HTML 里取，避免图标与文案再抄一份 */
const sideRoot=()=>{const d=document.createElement('div');d.innerHTML=ref.sidebar;return d};
const railIcons=(()=>{try{return Array.from(sideRoot().querySelectorAll('.nav-btn')).map(b=>{const l=b.querySelector('.nav-label'),s=b.querySelector('svg');return l&&s?{name:l.textContent.trim(),svg:s.outerHTML}:null}).filter(Boolean)}catch{return[]}})();
/* 侧栏「置顶 / 项目」条目：从 live DOM 读，改名/删除/置顶后收起态轨道能立刻跟上 */
const parseSideTasks=root=>{try{const nav=root&&root.querySelector('.side-nav'),out=[];if(!nav)return out;let sec='',inSec=false;for(const el of Array.from(nav.children)){if(el.classList.contains('side-h')){const t=el.textContent.trim();sec=t.includes('置顶')?'置顶任务':t;inSec=true}else if(inSec&&(el.classList.contains('pinned-btn')||el.classList.contains('nav-btn'))){const n=(el.querySelector('.t')||el.querySelector('.nav-label'))?.textContent.trim();if(n)out.push({name:n,sec,pinned:el.classList.contains('pinned-btn')})}}return out}catch{return[]}};
const sideItemName=el=>el?((el.querySelector('.t')||el.querySelector('.nav-label'))?.textContent.trim()||''):'';
const SIDE_MORE_SVG=(()=>{try{const m=sideRoot().querySelector('#moreBtn svg');return m?m.outerHTML:''}catch{return''}})();
/* 必须是模块级常量：`dangerouslySetInnerHTML={{__html:ref.sidebar}}` 每次渲染都会新建对象，
   导致 React 在每次重渲染时把 innerHTML 重设一遍 —— 注入的三点图标、data-grp、折叠状态
   会连同用户改动（置顶/重命名/删除）一起被冲掉。引用稳定后 React 才会跳过这次写入。 */
const SIDE_HTML={__html:ref.sidebar};
function Avatar({name,size=28,kind}){
  const agentKind=kind||findAgent(INITIAL_AGENTS,name)?.kind||(/临时|快扫|速读/.test(name||'')?'temp':name==='mushsci'?'main':'profile');
  if(name==='LI')return <img className="avatar" width={size} height={size} src={ref.avatar} alt="LI"/>;
  if(name===MAIN)return <img className="avatar mascot-avatar" width={size} height={size} src={ref.hero} alt="mushsci"/>;
  return <span className={'agent-avatar '+(agentKind==='temp'?'temp':name==='材料科学专家'?'green':'')} style={{width:size,height:size}} title={KIND_META[agentKind]?.label||''}>{agentKind==='temp'?<Timer/>:name==='材料科学专家'?<FlaskConical/>:<BookOpen/>}</span>;
}
function RoleBadge({kind,mode}){return <span className={'role-badge '+(KIND_META[kind]?.cls||'')}>{mode||(KIND_META[kind]?.label||'AI')}</span>}
function IconButton({label,children,className='',...props}){return <button type="button" className={'icon-btn '+className} title={label} aria-label={label} {...props}>{children}</button>}
function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'text/markdown;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
/* Runtime aggregation lives outside the presentation layer. Legacy records never fabricate agents. */
function ExecutionPanel({message,onOpenAgent,selectedAgentId}) {
 const execution = message.execution || normalizeLegacyExecution(message);
 return <ExecutionTrace execution={execution} onOpenAgent={onOpenAgent} selectedAgentId={selectedAgentId}/>;
}
function Message({message,index,onQuote,onReport,onTask,onMention,onJump,onOpenAgent,selectedAgentId,notify,agentList}){
 const [longOpen,setLongOpen]=useState(false);
 const long=index===0&&!message.local;
 const meta=findAgent(agentList,message.sender)||findAgent(INITIAL_AGENTS,message.sender);
 const kind=message.kind||meta?.kind||(message.sender==='LI'?'user':/临时|快扫/.test(message.sender||'')?'temp':'profile');
 const copy=async()=>{try{await navigator.clipboard.writeText(plain(message.html));notify('消息已复制')}catch{notify('复制未成功，请选中文字后复制')}};
 const bodyClick=async e=>{const mention=e.target.closest('[data-mention]');if(mention)onMention(mention.dataset.mention);const anchor=e.target.closest('a');if(anchor&&anchor.getAttribute('href')==='#report'){e.preventDefault();onReport()}const btn=e.target.closest('[data-copy-table]');if(btn){try{const table=btn.parentElement.nextElementSibling;const text=Array.from(table.querySelectorAll('tr')).map(tr=>Array.from(tr.querySelectorAll('th,td')).map(td=>td.innerText).join('\t')).join('\n');await navigator.clipboard.writeText(text);notify('表格已复制，可直接粘贴到 Excel')}catch{notify('复制未成功，请重试')}}};
 let html=message.html.replace(/<div>表格<\/div>/g,'').replace(/<table>/g,'<div class="table-wrap"><div class="table-label">表格<button type="button" data-copy-table="true" aria-label="复制表格">复制表格</button></div><table>').replace(/<\/table>/g,'</table></div>').replace(/<a href="https:/g,'<a target="_blank" rel="noopener noreferrer" href="https:');
 if(message.sender==='LI')html=html.replace(/材料科学专家(?=等会|结果)/g,'<button class="avatar-tag" data-mention="材料科学专家">@材料科学专家</button>').replace(/@论文检索/g,'<button class="avatar-tag" data-mention="论文检索">@论文检索</button>');
 const isUser=message.sender==='LI',showMessageFooter=isUser||message.messageStatus!=='processing';
 const messageTime=formatMessageTime(message);
 const mentionable=message.sender!=='LI'&&kind!=='temp';
 return <article className={'message '+(message.sender==='LI'?'user-message':'')} id={'message-'+message.id} data-message={index}>
 <Avatar name={message.sender} kind={kind==='user'?undefined:kind}/><div className="message-main"><div className="message-header">{mentionable?<button className="sender" onClick={()=>onMention(message.sender)} title={'提及 '+message.sender}>{message.sender}</button>:<span className="sender">{message.sender}</span>}{message.sender!=='LI'&&(kind==='main'?<RoleBadge kind="main"/>:kind==='temp'?<RoleBadge kind="temp"/>:<span className="ai-badge">AI</span>)}{message.local&&message.sender!=='LI'&&<span className="local-label">模拟回复</span>}</div>
 {(message.execution||message.process||message.duration)&&<ExecutionPanel message={message} onOpenAgent={onOpenAgent} selectedAgentId={selectedAgentId}/>} 
 <div className="bubble-wrap"><div className={'bubble '+(long&&!longOpen?'folded':'')} onClick={bodyClick}>{message.quote&&<button className="quote-strip" onClick={()=>onJump(message,index)}><Quote size={13}/><span>{message.quote.replace(/^回复\s*/,'')}</span></button>}<div className="markdown" dangerouslySetInnerHTML={{__html:html}}/></div>
  {showMessageFooter&&<div className="message-footer"><div className="message-actions">{!isUser&&<IconButton label="引用消息" onClick={()=>onQuote(message)}><Quote size={15}/></IconButton>}<IconButton label="复制消息" onClick={copy}><Copy size={15}/></IconButton></div><time>{messageTime}</time></div>}
 {long&&<button className="expand-message" onClick={()=>setLongOpen(!longOpen)}>{longOpen?'收起':'展开'}<ChevronDown size={13} className={longOpen?'up':''}/></button>}</div>
 {index===0&&!message.local&&<button className="mention-chip" onClick={()=>onMention("论文检索")}><BookOpen size={13}/>@论文检索</button>}{message.task&&<button className="task-card" onClick={onTask}><span className="task-icon"><FlaskConical size={21}/></span><span><strong>钙钛矿太阳能电池稳定性深度调研</strong><small>已创建后台任务，完成后将自动通知</small></span><ChevronRight size={16}/></button>}</div></article>
}

const MODEL_LANG=[
 {n:'Auto',b:'auto',sp:'0.05x',sig:'g',gem:false,d:'自动匹配最合适的模型，兼顾响应速度与效果',load:'12% - 空闲',tag:''},
 {n:'GLM-5.3-Flash',b:'glm',sp:'0.81x',sig:'g',gem:false,d:'轻量快速，适合高频次的日常科研任务',load:'8% - 空闲',tag:'推理能力'},
 {n:'GLM-5.3',b:'glm',sp:'0.81x',sig:'g',gem:true,d:'旗舰模型，处理复杂任务',load:'35% - 轻度负载',tag:'推理能力'},
 {n:'GLM-5.2',b:'glm',sp:'0.81x',sig:'g',gem:true,d:'旗舰模型，处理复杂任务',load:'35% - 轻度负载',tag:'推理能力'},
 {n:'GLM-5.1',b:'glm',sp:'0.81x',sig:'g',gem:false,d:'均衡型模型，通用科研场景表现稳定',load:'21% - 空闲',tag:'推理能力'},
 {n:'Kimi K3',b:'kimi',sp:'1.38x',sig:'y',gem:true,d:'超长上下文，适合长文档与多篇论文综述',load:'42% - 轻度负载',tag:'长文本'},
 {n:'Kimi K2.7 Code',b:'kimi',sp:'0.51x',sig:'y',gem:false,d:'代码专精，适合数据分析与脚本任务',load:'18% - 空闲',tag:'代码能力'},
 {n:'Deepseek-V4-Pro',b:'ds',sp:'0.62x',sig:'y',gem:false,d:'推理与数学能力突出，适合多步推导',load:'27% - 空闲',tag:'推理能力'},
 {n:'Deepseek-V4-Flash',b:'ds',sp:'0.12x',sig:'o',gem:false,d:'极速响应，适合简单问答与批量摘要',load:'9% - 空闲',tag:''},
 {n:'Doubao-Seed-Evolving',b:'doubao',sp:'0.23x',sig:'g',gem:true,d:'自适应推理，复杂任务下更稳定',load:'31% - 轻度负载',tag:'推理能力'},
 {n:'Doubao-Seed-2.1-pro',b:'doubao',sp:'0.47x',sig:'g',gem:false,d:'综合能力强，适合多轮协作',load:'24% - 空闲',tag:''},
 {n:'Doubao-Seed-2.1-turbo',b:'doubao',sp:'0.30x',sig:'g',gem:false,d:'高吞吐，适合批量处理',load:'15% - 空闲',tag:''}
];
const MODEL_MULTI=[
 {n:'Auto',b:'auto',sp:'0.06x',sig:'g',gem:false,d:'自动匹配最合适的多模态模型',load:'10% - 空闲',tag:''},
 {n:'Doubao-Seed-2.1-vision',b:'doubao',sp:'0.35x',sig:'g',gem:false,d:'图文理解均衡，性价比高',load:'22% - 空闲',tag:'视觉理解'},
 {n:'GLM-5V',b:'glm',sp:'0.74x',sig:'g',gem:true,d:'视觉推理能力强，支持图表解析',load:'33% - 轻度负载',tag:'视觉理解'},
 {n:'Qwen3-VL-Max',b:'qwen',sp:'0.68x',sig:'y',gem:false,d:'文档与表格识别准确率高',load:'29% - 空闲',tag:'文档理解'},
 {n:'Kimi-VL',b:'kimi',sp:'0.92x',sig:'y',gem:false,d:'长图文混排理解，适合整篇 PDF',load:'19% - 空闲',tag:'长文本'},
 {n:'Step-3-Vision',b:'step',sp:'0.41x',sig:'g',gem:false,d:'图像细节识别，适合实验数据图',load:'14% - 空闲',tag:'视觉理解'}
];
function BrandIcon({b}){
 const M={glm:'Z',kimi:'K',qwen:'Q',step:'S'};
 if(b==='ds')return <span className="mp-ic ds"><svg viewBox="0 0 24 24" width="13" height="13" fill="#fff"><path d="M4 16.4c2 0 3.4-1.2 4.3-2.9.8-1.5 1.9-2.5 3.4-2.5 1.4 0 2.4.8 3.2 2.1.6 1.2 1.5 2 2.7 2.2-1.5.5-2.7 0-3.8-1.1-1-1.1-2.2-1.8-3.7-1.8-2 0-3.5 1.3-4.6 3.1-.4.6-.9 1.2-1.5 1.6z"/></svg></span>;
 if(b==='doubao')return <span className="mp-ic doubao"><svg viewBox="0 0 24 24" width="14" height="14" fill="#fff"><ellipse cx="12" cy="6.6" rx="2.8" ry="3.8"/><ellipse cx="12" cy="17.4" rx="2.8" ry="3.8"/><ellipse cx="6.6" cy="12" rx="3.8" ry="2.8"/><ellipse cx="17.4" cy="12" rx="3.8" ry="2.8"/></svg></span>;
 if(b==='auto')return <span className="mp-ic auto"><svg viewBox="0 0 24 24" width="12" height="12" fill="#fff"><path d="M12 2.6 14.6 9.4 21.4 12 14.6 14.6 12 21.4 9.4 14.6 2.6 12 9.4 9.4z"/></svg></span>;
 return <span className={'mp-ic '+b}>{M[b]||'?'}</span>;
}
function Gem(){return <svg className="mp-gem" viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M12 2.6 17.2 8.9 12 21.4 6.8 8.9z"/></svg>}
function ModelPicker({model,tab,setTab,hover,setHover,onPick}){
 const list=tab==='lang'?MODEL_LANG:MODEL_MULTI;
 const DETAIL_W=222;
 const track=(el,x)=>{
  const pop=el.closest('.composer-popover');
  const room=pop?window.innerWidth-pop.getBoundingClientRect().right-16:0;
  return {m:x,side:room>=DETAIL_W?'right':'left'};
 };
 return <div className="mp">
  <div className="mp-tabs">
   <button className={'mp-tab'+(tab==='lang'?' on':'')} onClick={()=>{setTab('lang');setHover(null)}}>语言模型</button>
   <button className={'mp-tab'+(tab==='multi'?' on':'')} onClick={()=>{setTab('multi');setHover(null)}}>多模态模型</button>
  </div>
  <div className="mp-h">内置模型</div>
  <div className="mp-list">
   {list.map(x=><button key={x.n} className={'mp-row'+(model===x.n?' on':'')} onMouseEnter={e=>setHover(track(e.currentTarget,x))} onClick={()=>onPick(x.n)}>
    <BrandIcon b={x.b}/>
    <span className="mp-nm">{x.n}{x.gem&&<Gem/>}</span>
    {model===x.n?<svg className="mp-ck" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
     :<span className="mp-meta"><span className="mp-sp">{x.sp}</span></span>}
   </button>)}
  </div>
  {hover&&<div className={'mp-detail '+hover.side}>
   <div className="mp-dt-h"><BrandIcon b={hover.m.b}/><strong>{hover.m.n}</strong></div>
   <p className="mp-dt-d">{hover.m.d}</p>
   <div className="mp-dt-r"><span>消耗速度</span><b>{hover.m.sp}</b></div>
   {hover.m.tag&&<div className="mp-dt-f"><span>可用功能</span><em className="mp-tag">{hover.m.tag}</em></div>}
  </div>}
 </div>;
}

export default function Workspace(){
 const saved=useRef(getSaved());
 const restoredMessages=useRef(Array.isArray(saved.current?.messages)?restoreDemoMessages(upgradeSavedSample(saved.current.messages)):FULL_SAMPLE_MESSAGES);
 const [workbench,dispatchWorkbench]=useReducer(panelReducer,undefined,createPanelState);
 const [view,setView]=useState('home'),[messages,setMessages]=useState(restoredMessages.current),[title,setTitle]=useState(saved.current?.title||'钙钛矿太阳能电池稳定性研究'),[draft,setDraft]=useState(''),[menu,setMenu]=useState(''),[subMenu,setSubMenu]=useState(''),[modal,setModal]=useState(null),[toast,setToast]=useState(''),[quote,setQuote]=useState(null),[agent,setAgent]=useState(MAIN),[skill,setSkill]=useState(''),[kb,setKb]=useState([]),[model,setModel]=useState('Auto'),[modelTab,setModelTab]=useState('lang'),[hoverModel,setHoverModel]=useState(null),[files,setFiles]=useState([]),[busy,setBusy]=useState(false),[pinned,setPinned]=useState(true),[search,setSearch]=useState(''),[showBottom,setShowBottom]=useState(false),[collapsed,setCollapsed]=useState(false),[railList,setRailList]=useState('');
 const [runPhase,setRunPhase]=useState(0),[activeRun,setActiveRun]=useState(null),[stopping,setStopping]=useState(false);
 const [pendingRequests,setPendingRequests]=useState([]),[queuePaused,setQueuePaused]=useState(false),[queueEditId,setQueueEditId]=useState(null);
 const awayFromBottom=useRef(false);
 /* 已经按方向准备过的话，刷新后要恢复，否则「AI 为我准备工作环境」只活在内存里 */
 const bootProfile=useRef(getOnboard()).current;
 const bootRoster=useRef(bootProfile&&bootProfile.domain?applyDirectionToRoster(INITIAL_AGENTS,bootProfile.domain,bootProfile.tags):INITIAL_AGENTS).current;
 const [agentRoster,setAgentRoster]=useState(bootRoster),[sessionScope,setSessionScope]=useState(bootRoster.map(a=>a.id)),[tempAgents,setTempAgents]=useState([]),[deletedRefs,setDeletedRefs]=useState([]),[sideMenu,setSideMenu]=useState(null),[renameDraft,setRenameDraft]=useState(''),[mentionPos,setMentionPos]=useState(null);
 const [profile,setProfile]=useState(()=>getOnboard());
 const [onboard,setOnboard]=useState(()=>{const p=getOnboard();return p&&p.skipped?null:(onboardSeen()?null:'ask')});
 const [onboardText,setOnboardText]=useState(()=>getOnboard()?.text||'');
 const [onboardTasks,setOnboardTasks]=useState([]);
 const [onboardParsed,setOnboardParsed]=useState(null);
 const [prepStep,setPrepStep]=useState(0);
 const onboardStep=useRef('ask');onboardStep.current=onboard;
 const editor=useRef(null),fileInput=useRef(null),scroll=useRef(null),timer=useRef(null),phaseTimer=useRef(null),toastTimer=useRef(null),returnFocus=useRef(null),sideRef=useRef(null);
 const notify=text=>{clearTimeout(toastTimer.current);setToast(text);toastTimer.current=setTimeout(()=>setToast(''),2600)};
 const closeMenus=()=>{setMenu('');setSubMenu('')};
 const openModal=(type,data)=>{returnFocus.current=document.activeElement;closeMenus();setSearch('');setModal({type,data})};
 const closeModal=(restoreFocus=true)=>{setModal(null);if(restoreFocus)setTimeout(()=>returnFocus.current?.focus(),0)};
 const bottom=()=>requestAnimationFrame(()=>scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'}));
 const jump=index=>{closeModal();setTimeout(()=>{const m=document.getElementById('message-'+messages[index]?.id);m?.scrollIntoView({block:'start',behavior:'smooth'});m?.classList.add('highlight');setTimeout(()=>m?.classList.remove('highlight'),1600)},80)};
 const openSideMenu=(node,x,y)=>setSideMenu({node,grp:node?.dataset?.grp||'project',x,y});
 /* 分组头「置顶 / 项目」折叠展开：只切换 class，不动静态 DOM 结构（那段 HTML 由 reference.json 注入） */
 const sideGroupToggle=hd=>{if(!hd)return;const collapsed=hd.classList.toggle('collapsed');hd.setAttribute('aria-expanded',collapsed?'false':'true');let n=hd.nextElementSibling;while(n&&!n.classList.contains('side-h')){if(n.classList.contains('si'))n.classList.toggle('grp-hidden',collapsed);n=n.nextElementSibling}};
 /* @ 提及浮层要贴着文本里那个「@」的右上角，所以得量出 @ 的真实坐标。
    文本域没有"取光标像素位置"的 API，只能用镜像元素复用同一套字体/宽度把文本排一遍。 */
 const measureMention=()=>{try{
  const ta=editor.current,shell=ta&&ta.closest('.composer-shell');
  if(!ta||!shell)return null;
  const m=draft.match(/@[^\s]*$/);if(!m)return null;
  const caretIndex=draft.length-m[0].length;                 // 这个 @ 的索引
  const cs=getComputedStyle(ta);
  const padL=parseFloat(cs.paddingLeft)||0,padR=parseFloat(cs.paddingRight)||0,padT=parseFloat(cs.paddingTop)||0;
  const mirror=document.createElement('div');
  mirror.style.cssText='position:absolute;left:-99999px;top:0;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;margin:0;border:0;padding:0;box-sizing:content-box';
  ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordSpacing','textTransform'].forEach(k=>{mirror.style[k]=cs[k]});
  mirror.style.width=Math.max(0,ta.clientWidth-padL-padR)+'px';   // 内容宽度与文本域一致，换行才会一致
  mirror.textContent=draft.slice(0,caretIndex+1);
  const marker=document.createElement('span');marker.textContent='\u200b';mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const dx=marker.offsetLeft,dy=marker.offsetTop;
  document.body.removeChild(mirror);
  const tr=ta.getBoundingClientRect(),sr=shell.getBoundingClientRect();
  const caretLeft=tr.left-sr.left+padL+dx-ta.scrollLeft;
  const caretTop=tr.top-sr.top+padT+dy-ta.scrollTop;
  const W=240,GAP=14;                                        // 浮层宽 240（见 CSS），落在 @ 右侧 14px
  return{left:Math.max(8,Math.min(caretLeft+GAP,sr.width-W-8)),bottom:Math.max(6,sr.height-caretTop+10)};
 }catch{return null}};
 useEffect(()=>{if(menu!=='mention'){setMentionPos(null);return}const raf=requestAnimationFrame(()=>setMentionPos(measureMention()));return()=>cancelAnimationFrame(raf)},[menu,draft]);
 const pinToggle=m=>{const nav=sideRef.current?.querySelector('.side-nav'),node=m?.node;if(!nav||!node)return;const pin=m.grp!=='pinned';if(pin){const d=nav.querySelectorAll('.side-div')[1];if(d)d.insertAdjacentElement('beforebegin',node);else nav.appendChild(node);node.dataset.grp='pinned'}else{nav.appendChild(node);node.dataset.grp='project'}notify(pin?'已置顶':'已取消置顶')};
 const saveRename=()=>{const node=modal?.data?.node,name=renameDraft.trim();if(node&&name){const l=node.querySelector('.nav-label')||node.querySelector('.t');if(l)l.textContent=name;notify('已重命名为「'+name+'」')}closeModal()};
 const mentionableAgents=agentRoster.filter(a=>a.kind!=='temp'&&sessionScope.includes(a.id));
 const mention=name=>{if(name==='LI')return;const hit=findAgent(agentRoster,name)||mentionableAgents.find(a=>a.id===name||a.name===name);if(!hit){notify('临时智能体不可 @，仅可 @ 本会话选定范围内的智能体');return}if(hit.kind==='temp'){notify('临时智能体不可 @，可在任务详情查看记录');return}if(!sessionScope.includes(hit.id)){notify('只能 @ 本对话最开始选定范围内的智能体');return}setAgent(hit.id);setDraft(s=>s.replace(/@[^\s]*$/,'')+(!s.includes('@'+hit.id)?'@'+hit.id+' ':''));closeMenus();editor.current?.focus()};
 /* 会话开始时锁定可 @ 范围，子智能体包含画像和官方应用。 */
 const lockSessionScope=(roster)=>setSessionScope(roster.filter(a=>a.kind!=='temp').map(a=>a.id));
 const startSample=()=>{if(busy||pendingRequests.length){notify('请先处理当前任务和待发送消息');return}const base=profile?applyDirectionToRoster(INITIAL_AGENTS,profile.domain,profile.tags):INITIAL_AGENTS;setAgentRoster(base);lockSessionScope(base);setTempAgents([]);setAgent(MAIN);setView('chat');setMessages(FULL_SAMPLE_MESSAGES);dispatchWorkbench({type:'CLEAR'});setTitle('钙钛矿太阳能电池稳定性研究');setDraft('');setQuote(null);setFiles([]);setDeletedRefs([]);closeMenus();requestAnimationFrame(()=>scroll.current?.scrollTo(0,0))};
 const addQuote=m=>{setQuote(m);if(m.sender!=='LI'&&m.sender!==MAIN&&sessionScope.includes(m.sender)&&findAgent(agentRoster,m.sender)?.kind!=='temp')setAgent(m.sender);editor.current?.focus();closeMenus()};
 const dropFile=i=>{const f=files[i];if(!f)return;const name=f.name;setFiles(files.filter((_,n)=>n!==i));setDeletedRefs(d=>d.includes(name)?d:[...d,name]);notify('引用已删除，不可再次引用')};
 const tryAddFile=(name,{restoreFocus=true}={})=>{if(deletedRefs.includes(name)){notify('该引用已删除，不支持再次引用');return}setFiles(old=>old.some(file=>file.name===name)?old:[...old,{name,size:12000}]);closeModal(restoreFocus);notify('已添加到输入框')};

 /* ===== 开场引导：描述 -> 解析 -> 多选任务 -> 准备环境 ===== */
 const onboardSubmitText=()=>{const t=onboardText.trim();if(!t){notify('先用一句话告诉我你的研究方向');return}setOnboard('parsing');setTimeout(()=>{setOnboardParsed(parseDirection(t));setOnboard('tasks')},1100)};
 const onboardToggleTask=id=>setOnboardTasks(s=>s.indexOf(id)>=0?s.filter(x=>x!==id):s.concat(id));
 const onboardFinish=()=>{
  const info=onboardPlan(onboardParsed||parseDirection(onboardText),onboardTasks);
  const rec={text:onboardText.trim(),domain:info.domain,tags:info.tags,tasks:info.labels,skills:info.skills,plugins:info.plugins,at:Date.now()};
  const next=applyDirectionToRoster(agentRoster,info.domain,info.tags);
  setAgentRoster(next);lockSessionScope(next);
  setProfile(rec);try{localStorage.setItem(ONBOARD_KEY,JSON.stringify(rec))}catch{}
  setOnboard(null);setView('home');closeMenus();
  notify('已按「'+info.domain+'」准备好工作环境');
 };
 const onboardSkip=()=>{try{localStorage.setItem(ONBOARD_KEY,JSON.stringify({skipped:true,at:Date.now()}))}catch{}setProfile(null);setOnboard(null)};
 const reopenOnboard=()=>{const p=profile;setOnboardText(p&&p.text?p.text:'');setOnboardTasks(p&&p.tasks?TASK_OPTIONS.filter(o=>p.tasks.indexOf(o.label)>=0).map(o=>o.id):[]);setOnboardParsed(p?{domain:p.domain,tags:p.tags||[]}:null);setPrepStep(0);setOnboard('ask');closeModal()};
 useEffect(()=>{try{localStorage.setItem('mushsci-workspace-v2',JSON.stringify({messages,title}))}catch{}},[messages,title]);
 useEffect(()=>()=>{clearTimeout(timer.current);clearInterval(phaseTimer.current);clearTimeout(toastTimer.current)},[]);
 useEffect(()=>{if(busy&&!showBottom)bottom()},[runPhase]);

 /* 准备态逐条点亮，全部完成后才允许进入工作区 */
 useEffect(()=>{if(onboard!=='preparing')return;setPrepStep(0);const n=onboardParsed?onboardPlan(onboardParsed,onboardTasks).items.length:6;let i=0;const id=setInterval(()=>{i+=1;setPrepStep(i);if(i>=n)clearInterval(id)},260);return()=>clearInterval(id)},[onboard]);
 /* 侧栏条目增强：只有「置顶 / 项目」两组可交互，其余导航项沿用原设计的不可点 */
 useEffect(()=>{const nav=sideRef.current?.querySelector('.side-nav');if(!nav)return;let sec='';for(const el of Array.from(nav.children)){if(el.classList.contains('side-h')){el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-expanded','true');const t=el.textContent.trim();sec=t.includes('置顶')?'pinned':t.includes('项目')?'project':'';continue}if(!sec)continue;if(!el.classList.contains('pinned-btn')&&!el.classList.contains('nav-btn'))continue;el.classList.add('si');el.dataset.grp=sec;const old=el.querySelector('#moreBtn')||el.querySelector('.item-more');if(old)old.classList.add('item-more');else{const s=document.createElement('span');s.className='ic item-more';s.style.cssText='width:16px;height:16px';s.innerHTML=SIDE_MORE_SVG;el.appendChild(s)}}},[]);
 useEffect(()=>{const f=e=>{if(e.key==='Escape'){closeMenus();setModal(null);setSideMenu(null);if(onboardStep.current==='ask')onboardSkip()}if((e.ctrlKey||e.metaKey)&&e.key==='k'){e.preventDefault();openModal('search')}};window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[]);
 useEffect(()=>{if(!modal)return;const d=document.querySelector('.modal');d?.querySelector('input,button,textarea')?.focus();const trap=e=>{if(e.key!=='Tab')return;const items=Array.from(d?.querySelectorAll('button,input,textarea,a[href]')||[]).filter(el=>!el.disabled);if(!items.length)return;const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}};document.addEventListener('keydown',trap);return()=>document.removeEventListener('keydown',trap)},[modal?.type]);
 const stopRun=()=>{
  if(!activeRun||stopping)return;
  clearTimeout(timer.current);clearInterval(phaseTimer.current);setStopping(true);setQueuePaused(true);
  const run=activeRun,phase=runPhase;
  setMessages(ms=>ms.map(m=>m.id===run.id?{...m,messageStatus:'processing',execution:getDemoExecution({id:run.id,owner:run.responder,mode:run.mode,phase,status:'stopping',startedAt:run.startedAt})}:m));
  timer.current=setTimeout(()=>{
   const finishedAt=Date.now();
   const duration=Math.max(1,Math.round((Date.now()-run.startedAt)/1000))+'秒';
   setMessages(ms=>ms.map(m=>m.id===run.id?{...m,messageStatus:'cancelled',finishedAt,execution:getDemoExecution({id:run.id,owner:run.responder,mode:run.mode,phase,status:'cancelled',startedAt:run.startedAt,duration}),html:'<p>任务已停止。已返回的结果与执行记录仍然保留；待发送消息已暂停，请确认后再继续。</p>'}:m));
   setBusy(false);setStopping(false);setActiveRun(null);setTempAgents([]);notify('任务已停止，已保留执行记录');
  },650);
 };
 const submit=(requestedText,requestedFiles,requestOptions={})=>{
  const override=typeof requestedText==='string'?requestedText:null;
  const attachments=Array.isArray(requestedFiles)?requestedFiles:files;
  const requestQuote=requestOptions.background?requestOptions.quote:quote;
  const text=override||draft.trim()||(attachments.length?'请分析这些附件':'');
  if(!text)return;
  if(busy){
   if(override)return;
   setPendingRequests(q=>[...q,{id:'queued-'+Date.now(),text,files:attachments.map(f=>({...f})),quote,skill}]);setDraft('');setFiles([]);setQuote(null);closeMenus();notify('已加入待发送，不改变当前任务');return;
  }
  const hit=parseMention(text,mentionableAgents),isDirect=!!hit,responder=isDirect?hit.id:MAIN,mode=isDirect?'direct':'coord',now=Date.now();
   const time=new Date(now).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});
   const user={id:'local-'+now,sender:'LI',local:true,mode,time,sentAt:now,html:'<p>'+esc(text).replace(/\n/g,'<br>')+'</p>'+(attachments.length?'<p>附件：'+attachments.map(f=>esc(f.name)).join('、')+'</p>':''),quote:requestQuote?requestQuote.sender+'：'+plain(requestQuote.html).slice(0,100):''};
  const run={id:'reply-'+now,mode,responder,text,startedAt:now};
   const response={id:run.id,sender:responder,kind:responder===MAIN?'main':'profile',mode,time,sentAt:now,local:true,messageStatus:'processing',html:'',execution:getDemoExecution({id:run.id,owner:responder,mode,phase:0,startedAt:now})};
  if(view==='home'){setMessages([user,response]);dispatchWorkbench({type:'CLEAR'});setTitle(text.replace(/^@\S+\s*/,'').slice(0,24)||'新任务');setView('chat');lockSessionScope(agentRoster)}else setMessages(ms=>[...ms,user,response]);
  if(!requestOptions.background){setDraft('');setQuote(null);setFiles([]);closeMenus();}setBusy(true);setStopping(false);setRunPhase(0);setActiveRun(run);setAgent(responder);setTempAgents([]);if(!requestOptions.background||!awayFromBottom.current)bottom();
  clearInterval(phaseTimer.current);phaseTimer.current=setInterval(()=>setRunPhase(p=>Math.min(5,p+1)),1800);
  timer.current=setTimeout(()=>{
   const isPpt=/PPT|汇报|大纲/i.test(text)||(requestOptions.background?requestOptions.skill:skill)==='PPT';
   const body=isPpt?'<h3>组会汇报大纲</h3><p>'+esc(responder===MAIN?'MushSCI':responder)+' 已整理本次任务的结果：</p><ol><li>研究问题与背景</li><li>近期研究证据</li><li>技术瓶颈</li><li>候选方向比较</li><li>推荐方向与实验计划</li><li>讨论要点</li></ol>':isDirect?'<h3>'+esc(responder)+'的定向反馈</h3><p>当前请求由你 @ 的专业智能体直接处理。执行过程与工具结果保留在上方，不交由 MushSCI 冒名收口。</p><p>下一步建议：确认研究对象、对照组与现有实验条件，再细化工作计划。</p>':'<h3>主责汇总：建议先验证界面钝化方向</h3><p>两路子任务分别提供研究证据和可行性判断。已合并重复内容，并将需要进一步验证的假设保留。</p><p>下一步建议：先确认光热老化设备与样品周期，建立基准器件和单变量对照，再逐步展开。</p>';
   const duration=Math.max(1,Math.round((Date.now()-now)/1000))+'秒';
   const completedAt=Date.now();
   setMessages(ms=>ms.map(m=>m.id===run.id?{...m,messageStatus:'success',completedAt,html:body+'<p class="simulation-note">交互示例：未调用真实模型，以上研究内容不作为真实证据。</p>',execution:getDemoExecution({id:run.id,owner:responder,mode,phase:6,status:'success',startedAt:now,duration})}:m));
   clearInterval(phaseTimer.current);setTempAgents([]);setBusy(false);setRunPhase(6);setActiveRun(null);
   if(!awayFromBottom.current)bottom();
  },11200);
 };
 useEffect(()=>{
  if(!activeRun||stopping)return;
  setMessages(ms=>ms.map(m=>m.id===activeRun.id?{...m,execution:getDemoExecution({id:activeRun.id,owner:activeRun.responder,mode:activeRun.mode,phase:runPhase,startedAt:activeRun.startedAt})}:m));
 },[runPhase,activeRun,stopping]);
 useEffect(()=>{
  if(busy||queuePaused||!pendingRequests.length)return;
  const next=pendingRequests[0];setPendingRequests(q=>q.slice(1));submit(next.text,next.files,{background:true,quote:next.quote,skill:next.skill});
 },[busy,queuePaused,pendingRequests]);
 const playExecutionDemo=(mode='coord')=>{
  if(busy)return;
  submit(mode==='direct'?'@材料科学专家 请基于现有成果比较三个候选研究方向，不重新做文献检索。':'请结合论文与现有成果，比较三个研究方向，推荐适合作为硕士课题推进的方向。',[],{background:true,quote:null,skill:''});
 };
 const chooseFiles=e=>{const chosen=Array.from(e.target.files||[]);setFiles(old=>[...old,...chosen.map(f=>({name:f.name,size:f.size}))]);e.target.value='';closeMenus();if(chosen.length)notify('已添加 '+chosen.length+' 个附件，仅保留本地文件信息')};
 const exportChat=()=>download(title+'.md','# '+title+'\n\n'+messages.map(m=>'## '+m.sender+' · '+m.time+'\n\n'+plain(m.html)).join('\n\n'));
 const resolveAgent=tab=>{
  const execution=messages.find(message=>message.execution?.id===tab.runId)?.execution;
  return {execution,agent:execution?.agents.find(item=>item.id===tab.agentId)};
 };
 const focusOpenedPanel=()=>requestAnimationFrame(()=>document.querySelector('#workbench-panel [role="tab"][aria-selected="true"]')?.focus());
 const openAgent=(runId,agentId)=>{
  const resolved=resolveAgent({runId,agentId});
  if(!resolved.agent)return;
  closeMenus();
  dispatchWorkbench({type:'OPEN',tab:{id:agentPanelId(runId,agentId),type:'agent',title:resolved.agent.name,runId,agentId}});
  focusOpenedPanel();
 };
 const activePanelTab=workbench.tabs.find(tab=>tab.id===workbench.activeId);
 const selectedAgentId=runId=>!workbench.collapsed&&activePanelTab?.type==='agent'&&activePanelTab.runId===runId?activePanelTab.agentId:undefined;
 const openReport=section=>{
  const index=Number.isInteger(section)&&section>=0&&section<BASE_FILES.length?section:null;
  const fileName=index===null?'钙钛矿研究-对话成果摘录.md':BASE_FILES[index];
  const ids=index===null?[sourceMessages[4].id,sourceMessages[6].id,sourceMessages[8].id]:[sourceMessages[[4,6,8][index]].id];
  const bodies=ids.map(id=>messages.find(message=>message.id===id)?.html||'');
  if(!bodies.some(Boolean)){notify('当前对话没有这份示例成果');return}
  const html=('<h1>'+esc(index===null?'钙钛矿太阳能电池稳定性研究':fileName.replace(/\.md$/,''))+'</h1><p class="report-caption">对话成果摘录 · 原型示例</p>'+bodies.join('')).replace(/<a href="#report">(.*?)<\/a>/g,'<span>$1</span>').replace(/<a href="https:/g,'<a target="_blank" rel="noopener noreferrer" href="https:').replace(/<table>/g,'<div class="table-wrap"><table>').replace(/<\/table>/g,'</table></div>');
  closeModal(false);
  dispatchWorkbench({type:'OPEN',tab:{id:filePanelId(fileName),type:'file',title:index===null?'研究成果摘录':fileName.replace(/\.md$/,''),fileId:fileName,fileName,html,fileType:'Markdown'}});
  focusOpenedPanel();
 };
 const quotePreview=tab=>{
  if(deletedRefs.includes(tab.fileName)){notify('该引用已删除，不支持再次引用');return}
  tryAddFile(tab.fileName,{restoreFocus:false});
  if(window.innerWidth<=760)dispatchWorkbench({type:'TOGGLE_COLLAPSE'});
  requestAnimationFrame(()=>editor.current?.focus());
 };
 const toggleMenu=m=>{setSubMenu('');setMenu(menu===m?'':m)};
 const composer=<div className={'composer-shell '+(view==='home'?'home-composer':'')}>
 {pendingRequests.length>0&&<div className="execution-queue"><div><Clock size={13}/><span>{queuePaused?'待发送已暂停':'待发送'} · {pendingRequests.length} 条</span>{queuePaused&&!busy&&<button type="button" disabled={!!queueEditId} onClick={()=>setQueuePaused(false)}>继续队列</button>}</div>{pendingRequests.map(request=><div className="execution-queue-item" key={request.id}>{queueEditId===request.id?<input aria-label="编辑待发送内容" value={request.text} onChange={event=>setPendingRequests(q=>q.map(r=>r.id===request.id?{...r,text:event.target.value}:r))}/>:<span>{request.text}</span>}<button type="button" onClick={()=>{if(queueEditId===request.id){if(request.text.trim())setQueueEditId(null)}else{setQueuePaused(true);setQueueEditId(request.id)}}} aria-label={queueEditId===request.id?'保存待发送消息':'编辑待发送消息'}>{queueEditId===request.id?<Check size={12}/>:<Pencil size={12}/>}</button><button type="button" onClick={()=>{setPendingRequests(q=>q.filter(r=>r.id!==request.id));if(queueEditId===request.id)setQueueEditId(null)}} aria-label="取消待发送消息"><X size={12}/></button></div>)}</div>}
 <button className="kb-tab" onClick={()=>openModal('knowledge')}><Library size={18}/><span className="t">{kb.length?'已选择 '+kb.length+' 个知识库':'选择知识库'}</span><ChevronDown size={13}/></button>
 <div className="input-card"><div className="composer-context">{quote&&<div className="reply-context"><Quote size={14}/><span>{quote.sender}：{plain(quote.html).slice(0,140)}</span><IconButton label="取消引用" onClick={()=>setQuote(null)}><X size={14}/></IconButton></div>}{skill&&<button className="context-chip" onClick={()=>setSkill('')}><Puzzle size={13}/>{skill}<X size={12}/></button>}{files.map((f,i)=><button key={i} className="context-chip" title="移除后不可再次引用" onClick={()=>dropFile(i)}><FileText size={14}/>{f.name}<X size={12}/></button>)}</div>
 <textarea ref={editor} aria-label="消息内容" placeholder={view==='home'?'今天帮你做些什么？':'同步更多项目背景和信息，提升协作效率'} value={draft} rows={view==='home'?3:2} onChange={e=>{setDraft(e.target.value);if(/@[^\s]*$/.test(e.target.value))setMenu('mention');else if(menu==='mention')setMenu('')}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit()}}}/>
 <div className="input-bar"><div className="composer-tools"><IconButton label="添加" className={menu==='add'?'active':''} onClick={()=>toggleMenu('add')}><Plus size={19}/></IconButton><button className="agent-select" onClick={()=>toggleMenu('mention')}><span>@</span><span className="selected-agent">{view==='home'?'主控 MushSCI':(parseMention(draft,mentionableAgents)?.id||(agent===MAIN?MAIN+' · 主控':agent))}</span><ChevronDown size={12}/></button></div><div className="bar-right"><button className="model-pill" onClick={()=>toggleMenu('model')}><span className="t">{model}</span><ChevronDown size={13}/></button><IconButton label="语音输入" onClick={()=>openModal('voice')}><Mic size={17}/></IconButton>{busy&&<button type="button" className="round-btn send busy" aria-label={stopping?'正在停止':'停止当前任务'} disabled={stopping} onClick={stopRun}>{stopping?<LoaderCircle size={14} className="spin"/>:<Square size={14}/>}</button>}<button className="round-btn send" aria-label={busy?'加入待发送':'发送消息'} disabled={stopping||(!draft.trim()&&!files.length)} onClick={submit}><ArrowUp size={19}/></button></div></div></div>
 {menu&&<><button className="menu-backdrop" tabIndex={-1} aria-label="关闭菜单" onClick={closeMenus}/><div className={'composer-popover '+menu} role="dialog" aria-label={menu==='add'?'添加内容':menu==='mention'?'选择智能体':menu==='model'?'选择模型':'任务运行环境'} style={menu==='mention'&&mentionPos?{left:mentionPos.left,bottom:mentionPos.bottom}:undefined}>
 {menu==='add'&&<><button onClick={()=>fileInput.current?.click()}><Paperclip size={17}/>上传附件</button><button onClick={()=>openModal('cloud')}><Cloud size={17}/>从云盘上传</button><button className={subMenu==='plugins'?'active':''} onClick={()=>setSubMenu(subMenu==='plugins'?'':'plugins')}><Puzzle size={17}/>插件<ChevronRight size={15}/></button><button className={subMenu==='skills'?'active':''} onClick={()=>setSubMenu(subMenu==='skills'?'':'skills')}><BookOpen size={17}/>技能<ChevronRight size={15}/></button>{subMenu&&<div className="submenu"><small>{subMenu==='skills'?'已添加技能':'可用插件'}</small>{(subMenu==='skills'?skills:plugins).map(s=><button key={s} onClick={()=>{setSkill(s);closeMenus();editor.current?.focus()}}><Puzzle size={16}/><span>{s}</span><small>{agent}</small></button>)}</div>}</>}
 {menu==='mention'&&<><small>本会话可 @ 范围</small>{mentionableAgents.filter(a=>a.name.toLowerCase().includes((draft.match(/@([^\s]*)$/)?.[1]||'').toLowerCase())).map(a=><button key={a.id} onClick={()=>mention(a.id)}><Avatar name={a.id} size={25} kind={a.kind}/><span><span className="row-title">{a.id}{a.kind==='main'&&<RoleBadge kind="main"/>}</span><small>{a.desc}</small></span>{agent===a.id?<Check size={15}/>:<ChevronRight size={15}/>}</button>)}</>}
 {menu==='model'&&<ModelPicker model={model} tab={modelTab} setTab={setModelTab} hover={hoverModel} setHover={setHoverModel} onPick={m=>{setModel(m);closeMenus()}}/>}
 </div></>}
 </div>;
 const titles={knowledge:'选择知识库',members:'协作智能体',settings:'任务设置',files:'任务文件',cloud:'从云盘选择',search:'搜索聊天记录',task:'深度调研任务',voice:'语音输入',desktop:'连接电脑说明',delete:'删除聊天',rules:'多智能体交互规则',rename:'重命名'};

 const onboardInfo=onboardParsed?onboardPlan(onboardParsed,onboardTasks):null;
 const onboardModal=!onboard?null:<div className="modal-overlay"><section className="modal onboard-modal" role="dialog" aria-modal="true" aria-label="开场引导">
 {onboard==='ask'&&<div className="onboard-body">
  <div className="onboard-steps"><i className="on"/><i/></div>
  <div className="onboard-mark"><Sparkles size={19}/></div>
  <h2>让 MushSCI 更了解你</h2>
  <p className="onboard-lead">告诉我你的研究或工作方向，我会为你准备更适合的专业助手，之后也会根据你的使用逐渐调整。</p>
  <textarea autoFocus rows={3} maxLength={200} value={onboardText} placeholder="例如：我目前做新能源材料研究，主要关注钙钛矿、第一性原理计算和材料稳定性。" onChange={e=>setOnboardText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))onboardSubmitText()}}/>
  <button type="button" className="onboard-example" onClick={()=>setOnboardText(ONBOARD_EXAMPLE)}><Lightbulb size={13}/>用示例填一句</button>
  <div className="onboard-foot"><button type="button" className="onboard-skip" onClick={onboardSkip}>稍后再说</button><button type="button" className="primary" disabled={!onboardText.trim()} onClick={onboardSubmitText}>开始 <ChevronRight size={14}/></button></div>
 </div>}
 {onboard==='parsing'&&<div className="onboard-body onboard-center">
  <div className="onboard-mark"><LoaderCircle className="spin" size={19}/></div>
  <h2>正在理解你的方向</h2>
  <p className="onboard-lead">从这段描述里读出研究领域、关键词，以及该为你准备哪些专业助手。</p>
  <p className="onboard-quote">{onboardText.trim()}</p>
 </div>}
 {onboard==='tasks'&&onboardParsed&&<div className="onboard-body">
  <div className="onboard-steps"><i className="on"/><i className="on"/></div>
  <div className="onboard-read"><span className="tag">已识别方向</span><strong>{onboardParsed.domain}</strong><div className="tag-cloud">{onboardParsed.tags.map(t=><span key={t} className="tag">{t}</span>)}</div></div>
  <h2>你通常希望它们帮你完成哪些工作？</h2>
  <p className="onboard-lead">可多选。选中的工作会预置成默认能力，之后也能随时调整。</p>
  <div className="onboard-options">{TASK_OPTIONS.map(o=><button type="button" key={o.id} className={'onboard-option'+(onboardTasks.indexOf(o.id)>=0?' on':'')} aria-pressed={onboardTasks.indexOf(o.id)>=0} onClick={()=>onboardToggleTask(o.id)}><o.Icon size={15}/><span>{o.label}</span>{onboardTasks.indexOf(o.id)>=0&&<Check size={14}/>}</button>)}</div>
  <div className="onboard-foot"><button type="button" className="onboard-skip" onClick={()=>setOnboard('ask')}>返回修改方向</button><button type="button" className="primary" disabled={!onboardTasks.length} onClick={()=>setOnboard('preparing')}>开始准备 <ChevronRight size={14}/></button></div>
 </div>}
 {onboard==='preparing'&&onboardInfo&&<div className="onboard-body">
  <div className="onboard-mark done"><CheckCheck size={19}/></div>
  <h2>已为你准备好工作环境</h2>
  <p className="onboard-lead">下面这些准备会随着你的使用继续调整，不需要你填任何资料。</p>
  <ol className="onboard-prep">{onboardInfo.items.map((it,i)=><li key={it.t} className={i<prepStep?'on':''}>{i<prepStep?<Check size={14}/>:<Timer size={14}/>}<span><strong>{it.t}</strong><small>{it.d}</small></span></li>)}</ol>
  <div className="onboard-foot"><span className="onboard-note">想改方向，随时在「任务设置」里重新描述</span><button type="button" className="primary" disabled={prepStep<onboardInfo.items.length} onClick={onboardFinish}>{prepStep<onboardInfo.items.length?'正在准备…':'进入工作区'}</button></div>
 </div>}
 </section></div>;
 const liveSideTasks=(sideRef.current?parseSideTasks(sideRef.current):parseSideTasks(sideRoot()))||[];
 const railListItems=railList==='pinned'?liveSideTasks.filter(t=>t.sec==='置顶任务'):liveSideTasks.filter(t=>t.sec!=='置顶任务');
 return <div className={'app '+(collapsed?'sidebar-collapsed ':'')+(workbench.tabs.length?(workbench.collapsed?'workbench-collapsed ':'workbench-open ')+(workbench.fullscreen?'workbench-fullscreen':''):'')}>
 <div className="reference-sidebar" ref={sideRef} dangerouslySetInnerHTML={SIDE_HTML} onClick={e=>{const more=e.target.closest('.item-more');if(more){const it=more.closest('.si');if(it){const r=more.getBoundingClientRect();openSideMenu(it,Math.min(r.left,window.innerWidth-196),Math.min(r.bottom+6,window.innerHeight-210))}return}const hd=e.target.closest('.side-h');if(hd){setSideMenu(null);sideGroupToggle(hd);return}setSideMenu(null);if(e.target.closest('.search')){openModal('search');return}if(e.target.closest('.panel')){setCollapsed(true);return}if(e.target.closest('.pinned-btn')){setView('home');return}if(e.target.closest('.nav-btn')?.textContent.includes('新对话'))setView('home')}} onKeyDown={e=>{if(e.key!=='Enter'&&e.key!==' ')return;const hd=document.activeElement?.closest?.('.side-h');if(!hd)return;e.preventDefault();sideGroupToggle(hd)}} onContextMenu={e=>{const it=e.target.closest('.si');if(!it)return;e.preventDefault();openSideMenu(it,Math.min(e.clientX,window.innerWidth-196),Math.min(e.clientY,window.innerHeight-200))}}/>
 {collapsed&&<aside className="sidebar side-rail">
  <div className="rail-head"><IconButton label="展开侧边栏" className="rail-btn" onClick={()=>{setRailList('');setCollapsed(false)}}><PanelLeftOpen size={19}/></IconButton></div>
  <div className="rail-nav">{railIcons.map(it=><button key={it.name} type="button" className={'rail-btn'+(it.name==='新对话'?'':' inert')} title={it.name} aria-label={it.name} onClick={()=>{if(it.name==='新对话')setView('home')}}><span className="ic" style={{width:20,height:20}} dangerouslySetInnerHTML={{__html:it.svg}}/></button>)}</div>
  <div className="rail-div"/>
  <div className="rail-tasks">
   <button type="button" className={'rail-btn'+(railList==='pinned'?' on':'')} title="置顶任务" aria-label="置顶任务" onClick={()=>setRailList(railList==='pinned'?'':'pinned')}><Pin size={18}/></button>
   <button type="button" className={'rail-btn'+(railList==='all'?' on':'')} title="任务列表" aria-label="任务列表" onClick={()=>setRailList(railList==='all'?'':'all')}><ListChecks size={18}/></button>
   {railList&&<div className="rail-flyout">
    <div className="rail-flyout-h"><strong>{railList==='pinned'?'置顶任务':'任务列表'}</strong><IconButton label="关闭" onClick={()=>setRailList('')}><X size={15}/></IconButton></div>
    {railListItems.slice(0,10).map((t,i)=><button key={railList+t.name+i} type="button" className="rail-task" onClick={()=>{setRailList('');setTitle(t.name);setView('chat')}}>{railList==='pinned'?<Pin size={14}/>:<FileText size={14}/>}<span>{t.name}</span></button>)}
   </div>}
  </div>
  <div className="rail-foot"><img src={ref.avatar} alt="LI"/></div>
 </aside>}
 {railList&&<button className="menu-backdrop" tabIndex={-1} aria-label="关闭任务列表" onClick={()=>setRailList('')}/>}
 {sideMenu&&<><button className="menu-backdrop side-menu-backdrop" tabIndex={-1} aria-label="关闭菜单" onClick={()=>setSideMenu(null)}/><div className="side-menu" role="menu" style={{left:sideMenu.x,top:sideMenu.y}}><button type="button" role="menuitem" onClick={()=>{pinToggle(sideMenu);setSideMenu(null)}}>{sideMenu.grp==='pinned'?<PinOff size={15}/>:<Pin size={15}/>}{sideMenu.grp==='pinned'?'取消置顶':'置顶'}</button><button type="button" role="menuitem" onClick={()=>{setRenameDraft(sideItemName(sideMenu.node));openModal('rename',sideMenu);setSideMenu(null)}}><Pencil size={15}/>重命名</button>{sideMenu.grp==='project'&&<button type="button" role="menuitem" onClick={()=>{setSideMenu(null);notify('项目管理 · 占位')}}><FolderOpen size={15}/>项目管理</button>}<button type="button" role="menuitem" className="danger" onClick={()=>{const n=sideItemName(sideMenu.node);sideMenu.node.remove();setSideMenu(null);notify('已删除「'+n+'」')}}><Trash2 size={15}/>删除</button></div></>}
 <main className="main"><header className="topbar"><div className="crumb-wrap"><IconButton label={view==='home'?'工作区首页':'返回首页'} className="grid-btn" onClick={()=>setView('home')}>{view==='home'?<Grid2X2 size={19}/>:<ArrowLeft size={19}/>}</IconButton><div className="crumb"><button className="c1" onClick={()=>setView('home')}>智能体</button><ChevronRight size={13}/><button className="c2" onClick={()=>view==='chat'&&openModal('settings')}>{view==='home'?'新任务':title}</button></div></div><div className="header-actions">{view==='home'?<button className="sample-link" onClick={startSample}>查看协作示例<ChevronRight size={15}/></button>:<><button type="button" className="header-member" aria-label="协作智能体" title="查看协作智能体" onClick={()=>openModal('members')}><Bot size={16}/><span>协作智能体</span><small>{agentRoster.filter(a=>['main','profile','official'].includes(a.kind)).length}</small></button><button onClick={()=>openModal('files')} className="header-file"><FolderOpen size={17}/><span>查看文件</span></button><IconButton label={workbench.tabs.length?(workbench.collapsed?'展开工作区':'收起工作区'):'工作区暂无内容'} disabled={!workbench.tabs.length} onClick={()=>dispatchWorkbench({type:'TOGGLE_COLLAPSE'})}>{workbench.collapsed?<PanelRightOpen size={18}/>:<PanelRightClose size={18}/>}</IconButton></>}</div></header>
 {view==='home'?<div className="content"><div className="cluster"><img className="hero-mascot" src={ref.hero} alt="mushsci 科研助手"/><h1 className="hero-h1">很高兴见到你</h1>{profile&&!profile.skipped&&<button type="button" className="prepared-strip" onClick={reopenOnboard}><Sparkles size={13}/><span>已按你的方向准备：<strong>{profile.domain}</strong>{profile.tasks&&profile.tasks.length?' · '+profile.tasks.slice(0,2).join('、'):''}</span><Pencil size={12}/></button>}{composer}<div className="cards">{[['办公助手智能体','一句话生成PPT、文档与表格','请帮我整理一份 6 页组会 PPT 大纲','mushsci'],['人才画像助手','多源学术数据汇成可追溯的人才画像','请根据我提供的学术资料，整理研究者的人才画像','mushsci'],['论文检索助手','海量文献中快速锁定核心证据','@论文检索 请帮我检索近两年钙钛矿太阳能电池稳定性研究，推荐 3 个研究方向','论文检索']].map(([name,desc,prompt,a])=><button className="sg-card" key={name} onClick={()=>{setDraft(prompt);setAgent(a||MAIN);editor.current?.focus()}}><span className="sg-circle"><Lightbulb size={18}/></span><ArrowUpLeft className="card-arrow" size={16}/><div className="sg-title">{name}</div><div className="sg-desc">{desc}</div></button>)}</div><button className="recent-task" onClick={()=>{setView('chat');requestAnimationFrame(()=>scroll.current?.scrollTo(0,0))}}><Clock size={15}/><span>继续浏览：{title}</span><ChevronRight size={14}/></button></div></div>:<><div className="conversation-scroll" ref={scroll} onScroll={()=>{const el=scroll.current;awayFromBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight>180;setShowBottom(awayFromBottom.current)}}><div className="conversation"><div className="conversation-note">对话由 AI 生成 · 示例内容</div><div className="date-divider">今天</div><div className="execution-demo-bar"><span>执行流交互示例</span><button type="button" disabled={busy} onClick={()=>playExecutionDemo()}><Flower2 size={12}/>重新演示协作</button><button type="button" disabled={busy} onClick={()=>playExecutionDemo('direct')}>演示 @ 直达</button></div>{messages.map((m,i)=><Message key={m.id} message={m} index={i} agentList={agentRoster} onQuote={addQuote} onReport={()=>openReport(m.id===sourceMessages[6].id?1:m.id===sourceMessages[8].id?2:0)} onOpenAgent={openAgent} selectedAgentId={selectedAgentId(m.execution?.id)} onTask={()=>openModal('task')} onMention={mention} onJump={(m,i)=>{const sender=m.quote.replace(/^回复\s*/,'').split(/[：:]/)[0].trim();const before=messages.slice(0,i);let target=before.findLastIndex(x=>x.sender===sender);jump(target<0?Math.max(0,i-1):target)}} notify={notify}/>)}<div className="end-space"/></div></div><div className="composer-dock">{showBottom&&<IconButton label="回到最新消息" className="scroll-bottom" onClick={bottom}><ArrowDown size={18}/></IconButton>}{composer}<div className="composer-caption">Enter 发送，Shift + Enter 换行</div></div></>}
 </main><WorkbenchPanel state={workbench} onDispatch={dispatchWorkbench} resolveAgent={resolveAgent} onDownloadFile={tab=>download(tab.fileName,plain(tab.html))} onQuoteFile={quotePreview}/><input ref={fileInput} type="file" multiple hidden onChange={chooseFiles}/>{toast&&<div className="toast" role="status"><Check size={16}/>{toast}</div>}
 {modal&&<div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)closeModal()}}><section className={'modal '+(modal.type==='search'?' search-modal':'')} role="dialog" aria-modal="true" aria-label={titles[modal.type]}><div className="modal-header"><h2>{titles[modal.type]}</h2><IconButton label="关闭弹窗" onClick={closeModal}><X size={19}/></IconButton></div><div className="modal-body">
 {modal.type==='knowledge'&&<><p className="muted">为这次任务添加可参考的知识库</p>{libraries.map((l,i)=><label className="library-row" key={l}><span className="file-icon"><Library size={22}/></span><span><strong>{l}</strong><small>{[24,128,56][i]} 份资料 · 最近更新于今天</small></span><input type="checkbox" checked={kb.includes(l)} onChange={()=>setKb(kb.includes(l)?kb.filter(x=>x!==l):[...kb,l])}/></label>)}<div className="modal-footer"><span className="muted">已选择 {kb.length} 个知识库</span><button className="primary" onClick={closeModal}>完成</button></div></>}
 {modal.type==='members'&&<AgentRoster agents={agentRoster} sessionScope={sessionScope} AvatarComponent={Avatar} onMention={id=>{closeModal(false);mention(id);requestAnimationFrame(()=>editor.current?.focus())}} onDone={closeModal}/>}
 {modal.type==='settings'&&<><label className="field-label">对话名<input value={title} maxLength={50} onChange={e=>setTitle(e.target.value)} onBlur={()=>{if(!title.trim())setTitle('新任务')}}/></label><button className="setting-row" onClick={()=>openModal('members')}><Bot size={18}/><span>协作智能体<small>{agentRoster.filter(a=>['main','profile','official'].includes(a.kind)).length} 个智能体</small></span><ChevronRight size={16}/></button><button className="setting-row" onClick={reopenOnboard}><Sparkles size={18}/><span>开场引导<small>重新描述你的研究或工作方向</small></span><ChevronRight size={16}/></button><button className="setting-row" onClick={()=>openModal('rules')}><Shield size={18}/><span>多智能体交互规则<small>默认主控 · @ 直达 · 子智能体</small></span><ChevronRight size={16}/></button><button className="setting-row" onClick={()=>openModal('search')}><Search size={18}/><span>搜索聊天记录<small>搜索当前会话中的消息</small></span><ChevronRight size={16}/></button><button className="setting-row" onClick={()=>setPinned(!pinned)}>{pinned?<PinOff size={18}/>:<Pin size={18}/>}<span>{pinned?'取消置顶':'置顶对话'}</span><span className={'toggle '+(pinned?'on':'')} role="switch" aria-checked={pinned}/></button><button className="setting-row" onClick={()=>{exportChat();notify('聊天记录已导出')}}><Download size={18}/><span>导出聊天记录</span></button><button className="setting-row danger" onClick={()=>openModal('delete')}><Trash2 size={18}/><span>删除聊天</span></button></>}
 {['files','cloud'].includes(modal.type)&&<><p className="muted">{modal.type==='files'?'当前项目中的成果与资料':'选择文件后添加到输入框'}</p>{BASE_FILES.map((f,i)=>{const gone=deletedRefs.includes(f);return <button key={f} className={'file-row'+(gone?' disabled':'')} disabled={gone} onClick={()=>{if(modal.type==='cloud')tryAddFile(f);else if(!gone)openReport(i)}}><span className="file-icon"><FileText size={24}/></span><span><strong>{f}</strong><small>{gone?'已删除 · 不可再次引用':'Markdown · 对话成果'}</small></span>{modal.type==='cloud'?(gone?<AlertCircle size={18}/>:<Plus size={18}/>):<ChevronRight size={17}/>}</button>})}{deletedRefs.length>0&&<p className="footnote">已删除 {deletedRefs.length} 项引用，删除后不可再次引用。</p>}<p className="footnote">原型文件预览使用当前对话的成果摘录。</p></>}
 {modal.type==='search'&&<><div className="search-input"><Search size={18}/><input placeholder="搜索消息、研究方向或关键词" value={search} onChange={e=>setSearch(e.target.value)}/><kbd>Ctrl K</kbd></div><div className="search-results">{messages.map((m,i)=>({m,i})).filter(({m})=>!search||plain(m.html).toLowerCase().includes(search.toLowerCase())||m.sender.includes(search)).map(({m,i})=><button className="search-result" key={m.id} onClick={()=>{setView('chat');jump(i)}}><Avatar name={m.sender}/><span><strong>{m.sender}<time>{m.time}</time></strong><small>{plain(m.html).slice(Math.max(0,plain(m.html).indexOf(search)-20),Math.max(0,plain(m.html).indexOf(search)-20)+150)}</small></span><ChevronRight size={15}/></button>)}{search&&!messages.some(m=>plain(m.html).includes(search)||m.sender.includes(search))&&<div className="empty-state"><Search size={28}/><h3>没有找到相关消息</h3><p>换一个关键词试试</p></div>}</div></>}
 {modal.type==='task'&&<><div className="task-heading"><span className="task-icon"><FlaskConical size={24}/></span><div><h3>钙钛矿太阳能电池稳定性深度调研</h3><p className="success-label"><CheckCheck size={15}/>报告已返回 · 历史示例</p></div></div><div className="timeline">{['论文检索确认研究范围','提交后台深度调研任务','已有报告返回并读取','整理候选方向与研究证据','形成组会研究简报'].map(s=><div key={s}><Check size={15}/><span>{s}</span></div>)}</div><button className="file-row" onClick={()=>openReport(0)}><FileText size={24}/><span><strong>查看研究成果</strong><small>论文检索 · 对话成果摘录</small></span><ChevronRight size={17}/></button></>}
 {modal.type==='voice'&&<><div className="empty-state"><Mic size={32}/><h3>语音输入</h3><p>原型使用文字模拟语音转写，无需开启麦克风。</p></div><textarea className="voice-draft" placeholder="输入要模拟转写的内容" value={search} onChange={e=>setSearch(e.target.value)}/><div className="modal-footer"><button className="primary" disabled={!search.trim()} onClick={()=>{setDraft(draft+search);closeModal();editor.current?.focus()}}>插入到输入框</button></div></>}
 {modal.type==='desktop'&&<><div className="empty-state"><Monitor size={36}/><h3>连接电脑运行环境</h3><p>此原型展示运行环境选择。实际连接能力需要接入桌面客户端。</p></div><button className="primary full" onClick={closeModal}>知道了</button></>}
 {modal.type==='rules'&&<><p className="muted">产品交互规则摘要 · 用于原型验收对照</p><ol className="rule-list">{PRODUCT_RULES.map((r,i)=><li key={r}><span className="rule-num">{String(i+1).padStart(2,'0')}</span><span>{r}</span></li>)}</ol><div className="modal-footer"><button className="primary" onClick={closeModal}>知道了</button></div></>}
 {modal.type==='rename'&&<><label className="field-label">名称<input value={renameDraft} maxLength={40} onChange={e=>setRenameDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')saveRename()}}/></label><div className="modal-footer"><button className="outline" onClick={closeModal}>取消</button><button className="primary" onClick={saveRename}>保存</button></div></>}
 {modal.type==='delete'&&<><p>删除当前原型中的聊天记录？可以通过首页的“查看协作示例”恢复示例对话。</p><p className="footnote">删除后不可再次引用。</p><div className="modal-footer"><button className="outline" onClick={closeModal}>取消</button><button className="primary danger-bg" onClick={()=>{clearTimeout(timer.current);clearInterval(phaseTimer.current);setBusy(false);setStopping(false);setActiveRun(null);setPendingRequests([]);setQueuePaused(false);setQueueEditId(null);setTempAgents([]);setMessages([]);dispatchWorkbench({type:'CLEAR'});setTitle('新任务');setView('home');closeModal();notify('聊天已删除')}}>删除聊天</button></div></>}
 </div></section></div>}
 {onboardModal}
 </div>
}
