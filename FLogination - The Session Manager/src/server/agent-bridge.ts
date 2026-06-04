import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import type { AgentBridgeSettings, Session } from '../types';
import { db_ } from './database';

interface AgentRequest extends Request {
  agentAuth?: boolean;
}

const createAgentBridge = (settings: AgentBridgeSettings) => {
  const app = express();
  
  app.use(cors({
    origin: settings.allowedOrigins,
    credentials: true,
  }));
  
  app.use(bodyParser.json());
  
  const authenticate = (req: AgentRequest, res: Response, next: NextFunction) => {
    // Agent Bridge auth is always enforced per-route.
    // If the bridge is enabled but no API key is configured, reject all requests.
    if (!settings.apiKey) {
      return res.status(503).json({ error: 'Agent Bridge API key not configured' });
    }
    const apiKey = req.headers['x-agent-key'] || req.headers['authorization']?.replace('Bearer ', '');
    if (!apiKey || apiKey !== settings.apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.agentAuth = true;
    next();
  };

  // /health is intentionally public — allows uptime checks without credentials.
  app.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: Date.now(),
      version: '5.0.0',
      agentBridgeEnabled: settings.enabled,
    });
  });

  // All other routes require authentication.
  app.use(authenticate);
  
  app.get('/sessions', (req: Request, res: Response) => {
    const sessions = db_.getSessions();
    res.json({ sessions });
  });
  
  app.get('/sessions/:id', (req: Request, res: Response) => {
    const session = db_.getSessionById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ session });
  });
  
  app.post('/sessions/:id/action', (req: Request, res: Response) => {
    const { action, params } = req.body;
    const session = db_.getSessionById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    db_.logActivity(session.id, `agent_${action}`, JSON.stringify(params || {}));
    
    res.json({ 
      success: true, 
      sessionId: session.id, 
      action,
      queued: true 
    });
  });
  
  app.post('/sessions/:id/check-health', async (req: Request, res: Response) => {
    const session = db_.getSessionById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    db_.logActivity(session.id, 'agent_health_check', 'Health check requested via Agent Bridge');
    
    res.json({ 
      sessionId: session.id,
      status: session.healthStatus,
      lastCheck: session.lastCheck,
      queued: true 
    });
  });
  
  app.post('/sessions/:id/create-bm', (req: Request, res: Response) => {
    const session = db_.getSessionById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const { bmName } = req.body;
    
    db_.logActivity(session.id, 'agent_create_bm', `BM Creation requested: ${bmName || 'Unnamed'}`);
    
    res.json({ 
      success: true, 
      sessionId: session.id, 
      action: 'create_bm',
      params: { bmName },
      queued: true 
    });
  });
  
  app.get('/logs', (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 100;
    
    const logs = db_.getActivityLogs(sessionId, limit);
    res.json({ logs });
  });
  
  app.get('/logs/:sessionId', (req: Request, res: Response) => {
    const logs = db_.getActivityLogs(req.params.sessionId, 100);
    res.json({ logs });
  });
  
  app.post('/control/hibernate-all', (req: Request, res: Response) => {
    const sessions = db_.getSessions();
    const liveSessions = sessions.filter(s => s.healthStatus === 'live');
    
    liveSessions.forEach(s => {
      db_.logActivity(s.id, 'agent_hibernate', 'Hibernation triggered via Agent Bridge');
    });
    
    res.json({ 
      success: true, 
      hibernated: liveSessions.length 
    });
  });
  
  app.get('/settings', (req: Request, res: Response) => {
    const settings = db_.getSettings();
    res.json({ 
      settings: {
        ...settings,
        ai: { ...settings.ai, apiKey: settings.ai.apiKey ? '***' : '' },
        agentBridge: { ...settings.agentBridge, apiKey: settings.agentBridge.apiKey ? '***' : '' }
      }
    });
  });
  
  return app;
};

export const agentBridge = {
  create: createAgentBridge,
};
