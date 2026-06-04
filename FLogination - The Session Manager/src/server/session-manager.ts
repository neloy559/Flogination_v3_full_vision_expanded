import type { Session, Proxy, AppSettings } from '../types';
import { stealthBrowser } from './stealth-browser';
import { db_ } from './database';
import { aiGateway } from './ai-gateway';

interface ActiveSession {
  session: Session;
  proxy?: Proxy;
  browser?: ReturnType<typeof stealthBrowser.launch> extends Promise<infer R> ? R : never;
  userDataDir?: string;
  isHibernating: boolean;
}

const activeSessions = new Map<string, ActiveSession>();

const SESSION_STATES = {
  IDLE: 'idle',
  LAUNCHING: 'launching',
  ACTIVE: 'active',
  HIBERNATING: 'hibernating',
  CLOSING: 'closing',
};

const getProxy = (proxyId?: string): Proxy | undefined => {
  if (!proxyId) return undefined;
  const proxies = db_.getProxies();
  return proxies.find(p => p.id === proxyId);
};

const launchSession = async (sessionId: string): Promise<{ success: boolean; error?: string }> => {
  const session = db_.getSessionById(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }
  
  const existing = activeSessions.get(sessionId);
  if (existing && existing.browser) {
    return { success: false, error: 'Session already running' };
  }
  
  try {
    const settings = db_.getSettings();
    const proxy = getProxy(session.proxyId);
    
    const userDataDir = `./user-data/${session.uid}`;
    
    const browser = await stealthBrowser.launch(
      proxy,
      settings,
      userDataDir
    );
    
    activeSessions.set(sessionId, {
      session,
      proxy,
      browser,
      userDataDir,
      isHibernating: false,
    });
    
    db_.logActivity(sessionId, 'session_launched', `Launched with proxy: ${proxy?.host || 'none'}`);
    
    return { success: true };
  } catch (e: any) {
    const errorMsg = e.message || 'Unknown error';
    db_.logActivity(sessionId, 'session_launch_error', errorMsg);
    return { success: false, error: errorMsg };
  }
};

const closeSession = async (sessionId: string): Promise<{ success: boolean; error?: string }> => {
  const active = activeSessions.get(sessionId);
  
  if (!active || !active.browser) {
    return { success: false, error: 'Session not running' };
  }
  
  try {
    await stealthBrowser.close(active.browser);
    activeSessions.delete(sessionId);
    db_.logActivity(sessionId, 'session_closed', 'Session closed');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

const checkSessionHealth = async (sessionId: string): Promise<{ success: boolean; status?: string; error?: string }> => {
  const active = activeSessions.get(sessionId);
  
  if (!active || !active.browser) {
    const session = db_.getSessionById(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    
    await launchSession(sessionId);
    const updated = activeSessions.get(sessionId);
    if (!updated || !updated.browser) {
      return { success: false, error: 'Failed to launch session' };
    }
    
    const health = await stealthBrowser.checkHealth(updated.browser);
    await closeSession(sessionId);
    
    db_.updateSession(sessionId, { 
      healthStatus: health.status, 
      lastCheck: Date.now() 
    });
    
    return { success: true, status: health.status };
  }
  
  const health = await stealthBrowser.checkHealth(active.browser);
  
  db_.updateSession(sessionId, { 
    healthStatus: health.status, 
    lastCheck: Date.now() 
  });
  
  return { success: true, status: health.status };
};

const hibernateSession = async (sessionId: string): Promise<{ success: boolean; error?: string }> => {
  const active = activeSessions.get(sessionId);
  
  if (!active || !active.browser) {
    return { success: false, error: 'Session not running' };
  }
  
  try {
    await active.browser.page.close();
    active.isHibernating = true;
    activeSessions.set(sessionId, active);
    
    db_.logActivity(sessionId, 'session_hibernated', 'Session hibernated');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

const wakeSession = async (sessionId: string): Promise<{ success: boolean; error?: string }> => {
  const active = activeSessions.get(sessionId);
  
  if (!active || !active.isHibernating) {
    return { success: false, error: 'Session not hibernating' };
  }
  
  try {
    const settings = db_.getSettings();
    if (!active.browser) {
      return { success: false, error: 'Browser instance not available' };
    }
    const newPage = await active.browser.context.newPage();
    stealthBrowser.injectStealthScript(newPage);
    active.browser.page = newPage;
    active.isHibernating = false;
    activeSessions.set(sessionId, active);
    
    db_.logActivity(sessionId, 'session_woke', 'Session woke from hibernation');
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

const runAIAction = async (
  sessionId: string,
  action: 'generate_response' | 'decide_action' | 'engagement',
  params: any
): Promise<{ success: boolean; result?: string; error?: string }> => {
  const settings = db_.getSettings();
  
  if (!settings.ai.enabled) {
    return { success: false, error: 'AI not enabled' };
  }
  
  try {
    let result;
    
    switch (action) {
      case 'generate_response':
        result = await aiGateway.generateHumanResponse(settings.ai, params.context, params.type);
        break;
      case 'decide_action':
        result = await aiGateway.decideNextAction(settings.ai, params.context, params.availableActions);
        break;
      case 'engagement':
        result = await aiGateway.generateEngagementContent(settings.ai, params.targetPost, params.type);
        break;
    }
    
    if (result.success) {
      db_.logActivity(sessionId, `ai_${action}`, result.content || '');
      return { success: true, result: result.content };
    }
    
    return { success: false, error: result.error };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
};

const getActiveSessions = (): ActiveSession[] => {
  return Array.from(activeSessions.values());
};

const getSessionState = (sessionId: string): string => {
  const active = activeSessions.get(sessionId);
  if (!active) return SESSION_STATES.IDLE;
  if (active.isHibernating) return SESSION_STATES.HIBERNATING;
  return SESSION_STATES.ACTIVE;
};

export const sessionManager = {
  launch: launchSession,
  close: closeSession,
  checkHealth: checkSessionHealth,
  hibernate: hibernateSession,
  wake: wakeSession,
  runAIAction,
  getActive: getActiveSessions,
  getState: getSessionState,
  STATES: SESSION_STATES,
};
