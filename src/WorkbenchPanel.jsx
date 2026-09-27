import React, {useEffect, useId, useRef, useState} from 'react';
import {FileText, Flower2, PanelRightClose, PanelRightOpen, Quote, Download, X, Maximize2, Minimize2} from 'lucide-react';
import {AgentDetail} from './ExecutionTrace';
import {MIN_WORKBENCH_WIDTH, DEFAULT_WORKBENCH_WIDTH} from './panelModel';
import './workbench.css';

function FilePreview({tab, onDownloadFile, onQuoteFile}) {
  return <section className="workbench-file" aria-label={(tab.fileName || tab.title)+' · 文件预览'}>
    <header className="workbench-file-heading">
      <span className="workbench-file-icon"><FileText size={20}/></span>
      <div><h2>{tab.fileName || tab.title}</h2><p>{tab.fileType || 'Markdown'} · 文件预览</p></div>
    </header>
    <div className="workbench-file-actions">
      <button type="button" onClick={() => onQuoteFile?.(tab)} disabled={!onQuoteFile}><Quote size={14}/>引用到对话</button>
      <button type="button" onClick={() => onDownloadFile?.(tab)} disabled={!onDownloadFile}><Download size={14}/>下载示例</button>
    </div>
    <div className="workbench-file-scroll">
      {tab.html ? <article className="workbench-file-content markdown" dangerouslySetInnerHTML={{__html:tab.html}}/> : <div className="workbench-empty">暂无可预览内容。</div>}
    </div>
    <footer>示例文件 · 预览与下载用于演示，不代表真实任务产出</footer>
  </section>;
}

export default function WorkbenchPanel({state, onDispatch, resolveAgent, onDownloadFile, onQuoteFile}) {
  const instance = useId().replaceAll(':','');
  const tabRefs = useRef(new Map());
  const panelRef = useRef(null);
  const focusAfterToggle = useRef(false);
  const resizeStart = useRef(null);
  const [resizing,setResizing] = useState(false);
  const maxWidth = () => {
    const renderedSideWidth = document.querySelector('.reference-sidebar')?.getBoundingClientRect().width;
    const sideWidth = renderedSideWidth || parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side-w')) || 224;
    return Math.max(MIN_WORKBENCH_WIDTH,Math.min(Math.round(window.innerWidth*.7),window.innerWidth-sideWidth-320));
  };
  useEffect(() => {
    if (focusAfterToggle.current) {
      panelRef.current?.querySelector(state.collapsed ? '.workbench-collapsed-rail .workbench-panel-toggle' : '.workbench-header .workbench-panel-toggle')?.focus();
      focusAfterToggle.current = false;
    }
  }, [state.collapsed]);
  useEffect(() => {
    if (!resizing) return;
    document.body.classList.add('workbench-is-resizing');
    return () => document.body.classList.remove('workbench-is-resizing');
  }, [resizing]);
  useEffect(() => {
    if (!state.tabs.length || state.collapsed || state.fullscreen) return;
    const clampWidth = () => {
      const max = maxWidth();
      if (state.width > max) onDispatch({type:'RESIZE',width:max,maxWidth:max});
    };
    clampWidth();
    window.addEventListener('resize',clampWidth);
    return () => window.removeEventListener('resize',clampWidth);
  }, [state.tabs.length,state.collapsed,state.fullscreen,state.width,onDispatch]);
  if (!state.tabs.length) return null;
  const toggle = () => {
    focusAfterToggle.current = true;
    onDispatch({type:'TOGGLE_COLLAPSE'});
  };
  const activate = id => onDispatch({type:'ACTIVATE',id});
  const close = id => onDispatch({type:'CLOSE',id});
  const resizeTo = width => onDispatch({type:'RESIZE',width,maxWidth:maxWidth()});
  const startResize = event => {
    if (state.fullscreen || state.collapsed) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStart.current = {pointerId:event.pointerId,startX:event.clientX,startWidth:state.width};
    setResizing(true);
  };
  const moveResize = event => {
    const start = resizeStart.current;
    if (!start || event.pointerId !== start.pointerId) return;
    resizeTo(start.startWidth+start.startX-event.clientX);
  };
  const stopResize = event => {
    if (!resizeStart.current || event.pointerId !== resizeStart.current.pointerId) return;
    resizeStart.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const resizeByKeyboard = event => {
    if (event.key === 'ArrowLeft') {event.preventDefault();resizeTo(state.width+24)}
    else if (event.key === 'ArrowRight') {event.preventDefault();resizeTo(state.width-24)}
    else if (event.key === 'Home') {event.preventDefault();resizeTo(MIN_WORKBENCH_WIDTH)}
    else if (event.key === 'End') {event.preventDefault();resizeTo(maxWidth())}
  };
  const current = state.tabs.find(tab => tab.id === state.activeId) || state.tabs[0];
  const closeWithFocus = id => {
    const index = state.tabs.findIndex(tab => tab.id === id);
    const target = id === current.id ? (state.tabs[index+1] || state.tabs[index-1]) : current;
    // Move focus to a surviving control before React removes the closed tab.
    if (target) tabRefs.current.get(target.id)?.focus();
    close(id);
    if (!target) {
      const tab = state.tabs[index];
      // On narrow layouts the main thread is hidden while a panel is open.
      // Wait until CLOSE restores that layout before returning focus to it.
      requestAnimationFrame(() => {
        const trigger = tab?.type === 'agent' ? [...document.querySelectorAll('[data-agent-detail-trigger]')].find(el => el.dataset.agentDetailTrigger === tab.runId+':'+tab.agentId) : null;
        (trigger || document.querySelector('.composer-dock textarea, .input-card textarea'))?.focus();
      });
    }
  };
  const tabId = index => instance+'-tab-'+index;
  const contentId = index => instance+'-content-'+index;
  const onTabKey = (event, id) => {
    const index = state.tabs.findIndex(tab => tab.id === id);
    let next;
    if (event.key === 'ArrowRight') next = state.tabs[(index+1)%state.tabs.length];
    if (event.key === 'ArrowLeft') next = state.tabs[(index-1+state.tabs.length)%state.tabs.length];
    if (event.key === 'Home') next = state.tabs[0];
    if (event.key === 'End') next = state.tabs.at(-1);
    if (next) {
      event.preventDefault();
      activate(next.id);
      tabRefs.current.get(next.id)?.focus();
    } else if (event.key === 'Delete') {
      event.preventDefault();
      closeWithFocus(id);
    }
  };
  return <aside id="workbench-panel" ref={panelRef} className={'workbench-panel'+(state.collapsed ? ' collapsed' : '')+(state.fullscreen ? ' fullscreen' : '')+(resizing ? ' resizing' : '')} style={{'--workbench-width':state.width+'px'}} aria-label="右侧工作区" data-workbench-state={state.fullscreen ? 'fullscreen':state.collapsed ? 'collapsed' : 'expanded'}>
    <div className="workbench-resize-handle" role="separator" aria-label="调整右侧工作区宽度" title="拖动调整宽度，最小 320 像素" aria-orientation="vertical" aria-controls="workbench-panel" aria-valuemin={MIN_WORKBENCH_WIDTH} aria-valuemax={maxWidth()} aria-valuenow={state.width} aria-valuetext={state.width+' 像素'} tabIndex={state.fullscreen||state.collapsed?-1:0} hidden={state.fullscreen||state.collapsed} onPointerDown={startResize} onPointerMove={moveResize} onPointerUp={stopResize} onPointerCancel={stopResize} onKeyDown={resizeByKeyboard} />
    <div className="workbench-collapsed-rail" hidden={!state.collapsed}>
      <button type="button" className="workbench-panel-toggle" onClick={toggle} aria-label="展开右侧工作区" title="展开右侧工作区" aria-expanded="false"><PanelRightOpen size={18}/></button>
      <span className="workbench-tab-total" aria-label={state.tabs.length+' 个已打开标签页'}>{state.tabs.length}</span>
      <span className="workbench-rail-title">{current.title}</span>
    </div>
    <div className="workbench-expanded" hidden={state.collapsed}>
      <header className="workbench-header">
        <span>工作区</span>
        <div className="workbench-header-actions">
          <button type="button" className="workbench-fullscreen-toggle" onClick={() => onDispatch({type:'TOGGLE_FULLSCREEN'})} aria-label={state.fullscreen?'退出全屏工作区':'全屏工作区'} title={state.fullscreen?'退出全屏工作区':'全屏工作区'} aria-pressed={state.fullscreen}>{state.fullscreen?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button>
          <button type="button" className="workbench-panel-toggle" onClick={toggle} aria-label="收起右侧工作区" title="收起右侧工作区" aria-expanded="true"><PanelRightClose size={17}/></button>
        </div>
      </header>
      <div className="workbench-tabs" role="tablist" aria-label="已打开的子任务和文件">
        {state.tabs.map((tab,index) => {
          const Icon = tab.type === 'agent' ? Flower2 : FileText;
          const active = tab.id === current.id;
          return <div className={'workbench-tab'+(active ? ' active' : '')} key={tab.id}>
            <button type="button" role="tab" id={tabId(index)} aria-controls={contentId(index)} aria-selected={active} tabIndex={active ? 0 : -1} ref={node => {if (node) tabRefs.current.set(tab.id,node); else tabRefs.current.delete(tab.id);}} onClick={() => activate(tab.id)} onKeyDown={event => onTabKey(event,tab.id)} title={tab.title}>
              <Icon size={14}/><span>{tab.title}</span>
            </button>
            <button type="button" className="workbench-tab-close" onClick={() => closeWithFocus(tab.id)} aria-label={'关闭'+tab.title+'标签页'} title={'关闭'+tab.title}><X size={12}/></button>
          </div>;
        })}
      </div>
      <div className="workbench-panels">
        {state.tabs.map((tab,index) => {
          const visible = tab.id === current.id && !state.collapsed;
          const resolved = tab.type === 'agent' ? resolveAgent?.(tab) : null;
          return <div className="workbench-tabpanel" role="tabpanel" id={contentId(index)} aria-labelledby={tabId(index)} key={tab.id} hidden={tab.id !== current.id}>
            {tab.type === 'file' ? <FilePreview tab={tab} onDownloadFile={onDownloadFile} onQuoteFile={onQuoteFile}/>
              : resolved?.agent && resolved?.execution ? <AgentDetail agent={resolved.agent} execution={resolved.execution} visible={visible}/>
              : <div className="workbench-empty"><Flower2 size={22}/><p>这条子任务记录暂不可用。</p><span>可以收起工作区，继续查看主对话。</span></div>}
          </div>;
        })}
      </div>
    </div>
  </aside>;
}
