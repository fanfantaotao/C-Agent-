import React from 'react';
import {Bot} from 'lucide-react';

// Read-only conversation roster. Official apps may join this list when the
// product supplies them; this prototype does not invent an official catalog.
export default function AgentRoster({agents,sessionScope,onMention,onDone,AvatarComponent}) {
  const main = agents.filter(agent => agent.kind === 'main');
  const children = agents.filter(agent => ['profile','official'].includes(agent.kind));
  const renderRow = agent => {
    const allowed = sessionScope.includes(agent.id);
    return <div className="member-row" key={agent.id}>
      {AvatarComponent ? <AvatarComponent name={agent.id} size={36} kind={agent.kind}/> : <Bot size={28}/>}
      <span className="member-description"><strong>{agent.name || agent.id}</strong><small>{agent.desc}
        {agent.direction && <><br/>方向：{agent.direction}</>}
        {agent.kind === 'profile' && agent.tags?.length > 0 && <><br/>标签：{agent.tags.join('、')}</>}
      </small></span>
      <span className={'tag '+(agent.kind === 'main' ? 'main-roster-tag' : '')}>{agent.kind === 'main' ? '主控' : agent.kind === 'official' ? '官方应用' : '画像'}</span>
      <button type="button" className="outline" disabled={!allowed} title={allowed ? '提及 '+(agent.name || agent.id) : '未纳入本会话可 @ 范围'} onClick={() => onMention(agent.id)}>提及</button>
    </div>;
  };
  return <div className="agent-roster">
    <p className="section-label">主控智能体</p>{main.map(renderRow)}
    <p className="section-label">子智能体</p>
    <p className="roster-caption">可包含画像智能体与官方智能体应用</p>
    {children.length ? children.map(renderRow) : <p className="muted">本会话尚未选定子智能体。</p>}
    <p className="footnote">仅可提及本会话开始时选定的智能体。子任务执行记录可在对话中的执行流打开。</p>
    <div className="modal-footer"><button type="button" className="primary" onClick={onDone}>完成</button></div>
  </div>;
}
