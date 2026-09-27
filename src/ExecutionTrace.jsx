import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {AlertCircle, BookOpen, Check, ChevronDown, ChevronRight, Download, FileText, FlaskConical, Flower2, LoaderCircle, Puzzle, Search, Square, Terminal, Timer} from 'lucide-react';
import {elapsedSeconds, toolActivity} from './executionModel.js';
import './execution.css';

const terminal = new Set(['success', 'error', 'cancelled']);
const displayName = name => name === 'mushsci' ? 'MushSCI' : name;
const statusText = {assigned:'准备中', processing:'执行中', running:'执行中', waiting:'等待你补充', confirming:'确认结果中', success:'已完成', error:'未完成', cancelled:'已停止', stopping:'正在停止', empty:'无匹配结果', queued:'等待执行', unknown:'结果待确认', submitted:'指令已提交', degraded:'备用方式已返回'};
const DisclosureContext = createContext(null);
const toolIcon = kind => ({search:Search, command:Terminal, skill:Puzzle}[kind] || FileText);

function StatusIcon({status, size=14}) {
  if (['processing','running','confirming','stopping'].includes(status)) return <LoaderCircle size={size} className="spin"/>;
  if (status === 'success' || status === 'empty') return <Check size={size}/>;
  if (status === 'error') return <AlertCircle size={size}/>;
  if (status === 'cancelled') return <Square size={size}/>;
  return null;
}

function ToolGroup({entry, tools, ownerStatus}) {
  const items = entry.toolIds.map(id => tools.find(t => t.id === id)).filter(Boolean);
  const defaultOpen = items.some(tool => ['running','error','unknown'].includes(tool.status));
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const disclosure = useContext(DisclosureContext);
  const open = disclosure ? (disclosure.groups[entry.id] ?? defaultOpen) : localOpen;
  const setOpen = value => disclosure ? disclosure.setGroups(groups => ({...groups,[entry.id]:value})) : setLocalOpen(value);
  useEffect(() => {
    if (disclosure && disclosure.groups[entry.id] === undefined) disclosure.setGroups(groups => groups[entry.id] === undefined ? {...groups,[entry.id]:defaultOpen} : groups);
  }, [entry.id, disclosure?.groups[entry.id]]);
  if (!items.length) return null;
  const active = items.some(t => t.status === 'running');
  const paused = ['waiting','stopping','unknown'].includes(ownerStatus);
  const first = items[0];
  const Icon = toolIcon(first.kind);
  const activity = paused && first.status === 'running'
    ? `${ownerStatus === 'waiting' ? '等待补充后继续' : ownerStatus === 'stopping' ? '等待停止确认' : '状态待同步'} ${first.title}`
    : toolActivity(first);
  return <div className="trace-tools">
    <button type="button" className="trace-tool-heading" onClick={() => setOpen(!open)} aria-expanded={open}>
      {active && !paused ? <StatusIcon status="running"/> : <Icon size={14}/>}<span key={activity} className="trace-action-copy">{items.length === 1 ? activity : '执行记录'}</span>
      {items.length > 1 && <span className="trace-tool-count">{items.length} 项{active ? ' · 执行中' : ''}</span>}
      <ChevronDown size={13} className={open ? '' : 'collapsed'}/>
    </button>
    {open && <div className="trace-tool-items">{items.map(tool => {
      const Icon = toolIcon(tool.kind);
      return <div className={'trace-tool-item '+tool.status} key={tool.id}>
        <Icon size={14}/><div><div className="trace-tool-title"><span>{tool.title}</span><span className="trace-tool-status"><StatusIcon status={paused && tool.status === 'running' ? ownerStatus : tool.status} size={12}/>{paused && tool.status === 'running' ? (ownerStatus === 'unknown' ? '状态待同步' : statusText[ownerStatus]) : statusText[tool.status] || '已返回'}</span></div>
        {tool.detail && <p>{tool.detail}</p>}
        {tool.attempts?.length > 1 && <details className="trace-attempts"><summary>查看 {tool.attempts.length} 次尝试</summary>{tool.attempts.map((attempt,i) => <p key={attempt.id || i}>尝试 {i+1} · {statusText[attempt.status] || '已返回'}{attempt.detail ? ' — '+attempt.detail : ''}</p>)}</details>}
        </div>
      </div>;
    })}</div>}
  </div>;
}

function AgentGroup({entry, agents, selected, onSelect, runId}) {
  const visible = entry.agentIds.map(id => agents.find(a => a.id === id)).filter(Boolean);
  const active = visible.filter(a => !terminal.has(a.status));
  const done = visible.filter(a => terminal.has(a.status));
  return <div className="trace-agents" aria-label="子任务分工">
    {[[active,'进行中'],[done,'已结束']].map(([items,label]) => items.length > 0 && <div className="trace-agent-section" key={label}>
      <div className="trace-agent-section-label">{label}<span>{items.length}</span></div>
      {items.map(agent => <button type="button" className={'trace-agent-row '+agent.status+(selected === agent.id ? ' selected' : '')} key={agent.id} onClick={() => onSelect?.(agent.id)} data-agent-detail-trigger={runId+':'+agent.id} aria-controls="workbench-panel" aria-label={'在右侧查看'+agent.name+'的子任务过程'}>
        {agent.kind === 'temp' || agent.kind === 'temporary' ? <Timer size={16} className="trace-agent-mark tone-0"/> : <Flower2 size={16} className={'trace-agent-mark tone-'+(agent.name === '材料科学专家' ? 1 : 0)}/>}
        <span className="trace-agent-copy"><span className="trace-agent-name">{agent.name}<span className="trace-agent-state"><StatusIcon status={agent.status} size={11}/>{statusText[agent.status] || '状态未同步'}</span></span><span className="trace-agent-summary">{agent.summary || agent.task}</span></span>
        <ChevronRight size={14}/>
      </button>)}
    </div>)}
  </div>;
}

function TraceEntries({entries, execution, selected, onSelect, ownerStatus=execution.status}) {
  return entries.map(entry => {
    if (entry.type === 'commentary') return <p className="trace-commentary" key={entry.id}>{entry.text}</p>;
    if (entry.type === 'tools') return <ToolGroup key={entry.id} entry={entry} tools={execution.tools} ownerStatus={ownerStatus}/>;
    if (entry.type === 'agents') return <AgentGroup key={entry.id} entry={entry} agents={execution.agents} selected={selected} onSelect={onSelect} runId={execution.id}/>;
    return null;
  });
}

function AgentDetail({agent, execution, visible=true}) {
  const scroll = useRef(null);
  // Completed history starts at its assignment, while a live run follows output.
  const follow = useRef(!terminal.has(agent.status));
  const [groups, setGroups] = useState({});
  useEffect(() => {
    // Only the detail's own scroll region follows new output. It never scrolls
    // the conversation, focuses a control, or traps focus in this workspace.
    const el = scroll.current;
    if (visible && follow.current && el) el.scrollTop = el.scrollHeight;
  }, [agent.entries, agent.status, visible]);
  const isTemporary = agent.kind === 'temp' || agent.kind === 'temporary';
  const Icon = isTemporary ? Timer : agent.name === '材料科学专家' ? FlaskConical : BookOpen;
  const globallyPaused = !terminal.has(agent.status) && ['waiting','stopping','unknown'].includes(execution.status);
  const presentationStatus = globallyPaused ? execution.status : agent.status;
  const artifacts = (execution.artifacts || []).filter(a => a.agentRunId === agent.id && a.downloadUrl);
  return <DisclosureContext.Provider value={{groups,setGroups}}>
    <section className="trace-detail" aria-label={agent.name+' · 子任务详情'}>
      <div className="trace-detail-scroll" ref={scroll} onScroll={event => {const el=event.currentTarget; follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<80;}}>
        <div className="trace-detail-identity"><span className={'trace-detail-icon '+(agent.name === '材料科学专家' ? 'green' : '')}><Icon size={20}/></span><div><h2>{agent.name}</h2><p>由 {displayName(execution.owner)} 委派{isTemporary ? ' · 临时创建' : ''}</p></div><span className={'trace-detail-status '+presentationStatus}><StatusIcon status={presentationStatus}/>{statusText[presentationStatus] || '状态未同步'}</span></div>
        <section className="trace-assignment"><h3>本次分工</h3><p>{agent.task}</p></section>
        <div className="trace-detail-flow"><TraceEntries entries={agent.entries || []} execution={execution} ownerStatus={['waiting','stopping','unknown'].includes(execution.status) ? execution.status : agent.status}/></div>
        {(execution.warnings || []).filter(w => w.agentRunId === agent.id).map(w => <div className="trace-warning" key={w.id}><AlertCircle size={14}/><span>{w.message}</span></div>)}
        {terminal.has(agent.status) && <section className={'trace-agent-result '+agent.status}><h3>{agent.status === 'success' ? '返回给主责的结果' : agent.status === 'cancelled' ? '停止时的进展' : '未完成的原因'}</h3><p>{agent.summary || '尚未返回结果摘要。'}</p></section>}
        {artifacts.map(artifact => <a className="trace-artifact" key={artifact.id} href={artifact.downloadUrl} download><Download size={14}/>{artifact.name || '下载产出'}</a>)}
        <div className="trace-detail-terminal" role="status"><StatusIcon status={globallyPaused ? presentationStatus : terminal.has(agent.status) ? agent.status : (agent.currentStatus || agent.status)}/><span key={globallyPaused ? presentationStatus : agent.current || agent.status} className="trace-action-copy">{terminal.has(agent.status) ? '执行记录已保留在当前任务中' : globallyPaused ? statusText[presentationStatus] : (agent.current || agent.summary || '等待子任务更新')}</span></div>
      </div>
      <footer>详情只读 · 最终回复由 {displayName(execution.owner)} 统一整理</footer>
    </section>
  </DisclosureContext.Provider>;
}

// Exported for non-browser contract/render tests; interaction QA remains separate.
export {AgentDetail, AgentGroup, ToolGroup};

export default function ExecutionTrace({execution, onOpenAgent, selectedAgentId}) {
  const hasAttention = (execution.warnings || []).length > 0 || (execution.tools || []).some(tool => ['error','unknown'].includes(tool.status));
  const [open, setOpen] = useState(execution.mode === 'coord' || !terminal.has(execution.status) || hasAttention);
  const [groups, setGroups] = useState({});
  const [, setTick] = useState(0);
  const manual = useRef(false);
  const previous = useRef(execution.status);
  useEffect(() => {
    if (!manual.current && !hasAttention && execution.mode !== 'coord' && previous.current !== 'success' && execution.status === 'success') setOpen(false);
    previous.current = execution.status;
  }, [execution.status, execution.mode, hasAttention]);
  useEffect(() => {
    if (terminal.has(execution.status) || ['unknown','waiting','queued'].includes(execution.status) || execution.legacy) return;
    const timer = setInterval(() => setTick(t => t+1), 1000);
    return () => clearInterval(timer);
  }, [execution.status, execution.legacy]);
  const elapsed = typeof execution.duration === 'string' && execution.duration
    ? execution.duration : execution.startedAt || execution.duration ? elapsedSeconds(execution)+'秒' : '—';
  const suffix = execution.legacy ? '历史记录' : execution.status === 'success' ? '' : statusText[execution.status];
  return <DisclosureContext.Provider value={{groups,setGroups}}><section className={'execution-trace '+execution.status} aria-label={displayName(execution.owner)+'的执行过程'} data-run-id={execution.id}>
    <button type="button" className="trace-heading" onClick={() => {manual.current=true; setOpen(!open);}} aria-expanded={open}>
      <span>{execution.legacy ? '历史执行记录' : '已用时 '+elapsed}</span>{!execution.legacy && suffix && <span>· {suffix}</span>}<ChevronDown size={13} className={open ? '' : 'collapsed'}/>
    </button>
    {open && <div className="trace-flow"><TraceEntries entries={execution.entries || []} execution={execution} selected={selectedAgentId} onSelect={agentId => onOpenAgent?.(execution.id,agentId)}/>
      {(execution.warnings || []).filter(w => !w.agentRunId || !execution.agents.some(a => a.id === w.agentRunId)).map(w => <div className="trace-warning" key={w.id}><AlertCircle size={14}/><span>{w.message}</span></div>)}
      {(execution.artifacts || []).filter(a => !a.agentRunId && a.downloadUrl).map(artifact => <a className="trace-artifact" key={artifact.id} href={artifact.downloadUrl} download><Download size={14}/>{artifact.name || '下载产出'}</a>)}
      {!execution.legacy && <div className={'trace-terminal '+execution.status} role="status" aria-live="polite"><StatusIcon status={execution.currentStatus || execution.status}/><span key={execution.current} className="trace-action-copy">{execution.current || statusText[execution.status]}</span></div>}
    </div>}
  </section></DisclosureContext.Provider>;
}
