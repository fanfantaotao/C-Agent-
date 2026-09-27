// The right workspace owns presentation state only. Agent data is resolved from
// the live execution snapshot, not copied into a tab when it is first opened.
export const agentPanelId = (runId, agentId) => 'agent:'+encodeURIComponent(runId)+':'+encodeURIComponent(agentId);
export const filePanelId = fileId => 'file:'+encodeURIComponent(fileId);
export const DEFAULT_WORKBENCH_WIDTH = 440;
export const MIN_WORKBENCH_WIDTH = 320;

export function createPanelState() {
  return {tabs:[],activeId:null,collapsed:false,fullscreen:false,width:DEFAULT_WORKBENCH_WIDTH};
}

export function panelReducer(state, action) {
  switch (action.type) {
    case 'CLEAR':
      return createPanelState();
    case 'OPEN': {
      const tab = action.tab;
      if (!tab?.id || !['agent','file'].includes(tab.type)) return state;
      const existing = state.tabs.find(item => item.id === tab.id);
      // Reopening a document can refresh its source without duplicating tabs.
      const tabs = existing
        ? state.tabs.map(item => item.id === tab.id ? {...item,...tab} : item)
        : [...state.tabs,{...tab}];
      return {...state,tabs,activeId:tab.id,collapsed:false};
    }
    case 'ACTIVATE':
      return state.tabs.some(tab => tab.id === action.id)
        ? {...state,activeId:action.id,collapsed:false}
        : state;
    case 'CLOSE': {
      const id = action.id || state.activeId;
      const index = state.tabs.findIndex(tab => tab.id === id);
      if (index < 0) return state;
      const tabs = state.tabs.filter(tab => tab.id !== id);
      if (!tabs.length) return createPanelState();
      const activeId = id === state.activeId ? tabs[Math.min(index,tabs.length-1)].id : state.activeId;
      return {...state,tabs,activeId};
    }
    case 'TOGGLE_COLLAPSE':
      return state.tabs.length ? {...state,collapsed:!state.collapsed,fullscreen:false} : state;
    case 'TOGGLE_FULLSCREEN':
      return state.tabs.length ? {...state,fullscreen:!state.fullscreen,collapsed:false} : state;
    case 'RESIZE': {
      if (!state.tabs.length || state.fullscreen || state.collapsed) return state;
      const maxWidth = Math.max(MIN_WORKBENCH_WIDTH,Number(action.maxWidth)||1600);
      const width = Math.max(MIN_WORKBENCH_WIDTH,Math.min(maxWidth,Number(action.width)||state.width));
      return {...state,width};
    }
    default:
      return state;
  }
}
