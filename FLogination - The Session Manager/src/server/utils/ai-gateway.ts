/**
 * Flogination V5 — AI Gateway
 *
 * Multi-provider LLM client for content generation and selector healing.
 * Supports: OpenRouter, DeepSeek, OpenAI, GLM.
 *
 * Design principles:
 *  - AI is enhancement only — never a blocker for automation tasks.
 *  - All functions return { success: false, error } on failure — never throw.
 *  - The freeModel config is used exclusively for selector healing to minimize cost.
 *  - Content generation falls back to spin syntax templates when AI is unavailable.
 *
 * Supported functions:
 *  - generateComment()      → unique comment for url_promotion/reels/page_review
 *  - generateReview()       → organic-looking product/page review
 *  - generateHumanResponse() → natural reply for inbox messages
 *  - generateEngagementContent() → like/comment/share content
 *  - decideNextAction()     → AI decides next automation step
 *  - healSelector()         → replacement CSS selector for broken elements
 *  - generateSpunContent()  → AI-enhanced spin syntax resolution
 */

import axios from 'axios';
import type { AISettings, AppSettings, RecordedAction, WorkflowStep } from '../../types';
import { spinParser } from './spin-parser';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEEPSEEK_BASE   = 'https://api.deepseek.com/v1';
const OPENAI_BASE     = 'https://api.openai.com/v1';
const GLM_BASE        = 'https://open.bigmodel.cn/api/paas/v4';

/** Default timeout for AI API calls in milliseconds. */
const AI_TIMEOUT_MS = 20_000;

/** Timeout for free model calls (selector healing) — shorter to fail fast. */
const FREE_MODEL_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** Standard response shape for all AI Gateway functions. */
export interface AIGatewayResponse {
  success: boolean;
  content?: string;
  error?: string;
}

/** Comment stance for generateComment(). */
export type CommentStance = 'url_promotion' | 'reels_commenting' | 'page_review';

// ─────────────────────────────────────────────
// CORE: callAI
// ─────────────────────────────────────────────

/**
 * Makes a chat completion request to the configured AI provider.
 * Handles all four supported providers with the same OpenAI-compatible interface.
 *
 * @param settings     - The AI settings from app config.
 * @param messages     - The chat messages array.
 * @param systemPrompt - Optional system prompt prepended to messages.
 * @param timeoutMs    - Request timeout in milliseconds.
 * @returns The AI response content or an error.
 */
async function callAI(
  settings: AISettings,
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string,
  timeoutMs = AI_TIMEOUT_MS
): Promise<AIGatewayResponse> {
  if (!settings.enabled || !settings.apiKey) {
    return { success: false, error: 'AI not configured or disabled' };
  }

  const fullMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  const { url, headers, data } = buildRequest(settings, fullMessages);

  try {
    const response = await axios.post(url, data, { headers, timeout: timeoutMs });

    const content = response.data?.choices?.[0]?.message?.content;
    if (content) {
      return { success: true, content };
    }

    return { success: false, error: 'No content in AI response' };
  } catch (err: unknown) {
    const message = err instanceof Error
      ? (axios.isAxiosError(err) ? err.response?.data?.error?.message ?? err.message : err.message)
      : String(err);

    return { success: false, error: message };
  }
}

/**
 * Builds the HTTP request config for the configured AI provider.
 * All providers use the OpenAI-compatible /chat/completions endpoint shape.
 */
function buildRequest(
  settings: AISettings,
  messages: Array<{ role: string; content: string }>
): { url: string; headers: Record<string, string>; data: Record<string, unknown> } {
  const baseData = { model: settings.model, messages };

  switch (settings.provider) {
    case 'openrouter':
      return {
        url: `${OPENROUTER_BASE}/chat/completions`,
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'HTTP-Referer': 'https://flogination.local',
          'X-Title': 'Flogination',
          'Content-Type': 'application/json',
        },
        data: baseData,
      };

    case 'deepseek':
      return {
        url: `${DEEPSEEK_BASE}/chat/completions`,
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
        },
        data: { ...baseData, model: settings.model || 'deepseek-chat' },
      };

    case 'openai':
      return {
        url: `${OPENAI_BASE}/chat/completions`,
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
        },
        data: { ...baseData, model: settings.model || 'gpt-3.5-turbo' },
      };

    case 'glm':
      return {
        url: `${GLM_BASE}/chat/completions`,
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
        },
        data: { ...baseData, model: settings.model || 'glm-4' },
      };

    default:
      throw new Error(`Unknown AI provider: ${settings.provider}`);
  }
}

// ─────────────────────────────────────────────
// CONTENT GENERATION FUNCTIONS
// ─────────────────────────────────────────────

/**
 * Generates a unique comment for a Facebook post based on the specified stance.
 *
 * @param settings    - AI settings from app config.
 * @param postExcerpt - A brief excerpt of the target post content.
 * @param stance      - The comment stance: url_promotion, reels_commenting, or page_review.
 * @param promoUrl    - Optional URL to embed in url_promotion comments.
 * @returns A unique, human-like comment string.
 *
 * @example
 * const result = await aiGateway.generateComment(settings, 'Check out this product!', 'url_promotion', 'https://example.com')
 * // → { success: true, content: "Wow this looks amazing! I found something similar here: https://example.com" }
 */
async function generateComment(
  settings: AISettings,
  postExcerpt: string,
  stance: CommentStance,
  promoUrl?: string
): Promise<AIGatewayResponse> {
  const stanceInstructions: Record<CommentStance, string> = {
    url_promotion: `Write a natural, casual comment that subtly promotes this URL: ${promoUrl ?? ''}. 
      The comment should feel organic — not like an ad. Include the URL naturally in the text.
      Keep it under 200 characters.`,
    reels_commenting: `Write a short, engaging reaction comment for this reel/video.
      Sound like a real viewer — enthusiastic but not over the top.
      Keep it under 100 characters.`,
    page_review: `Write a genuine-sounding product review or page recommendation.
      Sound like a real customer who tried the product/service.
      1-3 sentences, conversational tone.`,
  };

  const systemPrompt = `You are a real Facebook user writing comments. 
Rules:
- Write naturally, like a human — not an AI
- Use casual language, occasional abbreviations are fine
- Never sound promotional or robotic
- Vary your writing style
- Keep responses concise`;

  const userMessage = `Post content: "${postExcerpt}"

Task: ${stanceInstructions[stance]}

Write ONLY the comment text. No quotes, no explanation.`;

  return callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);
}

/**
 * Generates an organic-looking product or page review.
 *
 * @param settings        - AI settings from app config.
 * @param pageName        - The name of the Facebook page or product.
 * @param productDesc     - Brief description of the product or service.
 * @param tone            - 'positive' or 'neutral'.
 * @returns A unique review text of 1-4 sentences.
 *
 * @example
 * const result = await aiGateway.generateReview(settings, 'TechStore BD', 'electronics shop', 'positive')
 * // → { success: true, content: "Been buying from TechStore BD for 2 years now. Great prices and fast delivery!" }
 */
async function generateReview(
  settings: AISettings,
  pageName: string,
  productDesc: string,
  tone: 'positive' | 'neutral' = 'positive'
): Promise<AIGatewayResponse> {
  const systemPrompt = `You are a real customer writing a Facebook review.
Rules:
- Sound like a genuine customer, not a marketer
- Use natural, conversational language
- Include specific details that make it believable
- Never use phrases like "I highly recommend" or "5 stars" — too generic
- 1-4 sentences maximum
- No AI-identifying phrases`;

  const userMessage = `Write a ${tone} review for: ${pageName}
Product/service type: ${productDesc}

Write ONLY the review text. No quotes, no explanation.`;

  return callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);
}

/**
 * Generates a natural human-like response for inbox messages.
 *
 * @param settings - AI settings from app config.
 * @param context  - The conversation context (last few messages).
 * @param type     - The type of response: 'comment', 'message', or 'post'.
 * @returns A natural response string.
 */
async function generateHumanResponse(
  settings: AISettings,
  context: string,
  type: 'comment' | 'message' | 'post'
): Promise<AIGatewayResponse> {
  const systemPrompt = `You are a human writing natural, casual social media content.
- Use casual language, occasional typos are OK
- Vary your writing style
- Keep responses short and natural (1-3 sentences for comments, short for messages)
- Use some emojis occasionally but not too many
- Never sound like an AI or bot
- Add human-like imperfections`;

  const userMessage = `Context: ${context}

Generate a natural ${type} response that sounds like a real human wrote it.
Write ONLY the response text. No quotes, no explanation.`;

  return callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);
}

/**
 * Generates engagement content (like/comment/share) for a specific post.
 *
 * @param settings       - AI settings from app config.
 * @param targetPost     - The post to engage with.
 * @param engagementType - 'like', 'comment', or 'share'.
 * @returns Engagement content appropriate for the type.
 */
async function generateEngagementContent(
  settings: AISettings,
  targetPost: { content: string; author: string },
  engagementType: 'like' | 'comment' | 'share'
): Promise<AIGatewayResponse> {
  const systemPrompt = `You are a human engaging with content on social media.
Generate ${engagementType} content that:
- Is natural and human-like
- Is relevant to the post
- Could realistically come from the target demographic`;

  const userMessage = `Post by ${targetPost.author}: "${targetPost.content}"

Generate a ${engagementType} for this post.
Write ONLY the content. No quotes, no explanation.`;

  return callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);
}

/**
 * Uses AI to decide the next best action for an account.
 *
 * @param settings          - AI settings from app config.
 * @param accountContext    - Description of the account's current state.
 * @param availableActions  - List of possible actions to choose from.
 * @returns The name of the recommended action.
 */
async function decideNextAction(
  settings: AISettings,
  accountContext: string,
  availableActions: string[]
): Promise<AIGatewayResponse> {
  const systemPrompt = `You are an AI agent deciding the next best action for a social media account.
Analyze the account status and available actions, then decide the best next step.
Return ONLY the action name, nothing else.
Choose from: ${availableActions.join(', ')}`;

  const userMessage = `Account Context: ${accountContext}

Available actions: ${availableActions.join(', ')}

What should the account do next? Reply with ONLY the action name.`;

  return callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);
}

// ─────────────────────────────────────────────
// SELECTOR HEALING
// ─────────────────────────────────────────────

/**
 * Calls the AI to get a replacement CSS selector for a broken element.
 * Uses the free model (openrouter/auto) to minimize cost.
 * Returns null if the response is invalid or AI is unavailable.
 *
 * @param settings       - AI settings from app config.
 * @param elementKey     - Logical name for the element.
 * @param failedSelector - The CSS selector that failed.
 * @param parentHtml     - The parent HTML context around the element.
 * @returns A JSON object { selector: "..." } or null on failure.
 *
 * @example
 * const result = await aiGateway.healSelector(settings, 'fb_like_button', '[aria-label="Like"]', '<div>...</div>')
 * // → { success: true, content: '{"selector": "[data-testid=\\"like-button\\"]"}' }
 */
async function healSelector(
  settings: AISettings,
  elementKey: string,
  failedSelector: string,
  parentHtml: string
): Promise<AIGatewayResponse> {
  if (!settings.apiKey) {
    return { success: false, error: 'No API key configured for selector healing' };
  }

  const prompt = `You are a CSS selector expert. A web automation script failed to find an element on Facebook.

Element purpose: ${elementKey}
Failed selector: ${failedSelector}

Parent HTML context:
${parentHtml.slice(0, 2000)}

Provide a replacement CSS selector. Respond with ONLY this JSON: {"selector": "your-selector"}`;

  // Use free model for healing to minimize cost
  const freeModelSettings: AISettings = {
    ...settings,
    provider: 'openrouter',
    model: settings.freeModel || 'openrouter/auto',
    enabled: true,
  };

  const result = await callAI(
    freeModelSettings,
    [{ role: 'user', content: prompt }],
    undefined,
    FREE_MODEL_TIMEOUT_MS
  );

  if (!result.success) {
    // Fallback to configured provider
    return callAI(
      settings,
      [{ role: 'user', content: prompt }],
      undefined,
      FREE_MODEL_TIMEOUT_MS
    );
  }

  return result;
}

// ─────────────────────────────────────────────
// SPIN CONTENT ENHANCEMENT
// ─────────────────────────────────────────────

/**
 * Resolves spin syntax in a template, optionally enhancing with AI.
 * If AI is disabled or fails, falls back to pure spin syntax resolution.
 *
 * @param settings - AI settings from app config.
 * @param template - Content template with optional {a|b|c} spin tokens.
 * @param context  - Optional context to help AI generate better variations.
 * @returns The resolved content string.
 *
 * @example
 * const result = await aiGateway.generateSpunContent(settings, '{Check this|Look at this}: {url}', 'product promotion')
 * // → { success: true, content: "Look at this: https://example.com" }
 */
async function generateSpunContent(
  settings: AISettings,
  template: string,
  context?: string
): Promise<AIGatewayResponse> {
  // Always resolve spin syntax first — this works without AI
  const spinResolved = spinParser.resolve(template);

  // If AI is not enabled, return spin-resolved content
  if (!settings.enabled || !settings.apiKey) {
    return { success: true, content: spinResolved };
  }

  // Optionally enhance with AI for more natural variation
  if (context) {
    const systemPrompt = `You are helping create natural social media content.
Given a template, produce a natural, human-sounding version.
Keep the core message but vary the phrasing naturally.
Return ONLY the final text, no explanation.`;

    const userMessage = `Template: ${spinResolved}
Context: ${context}

Rewrite this to sound more natural and human. Keep it concise.`;

    const aiResult = await callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);

    // Fall back to spin-resolved if AI fails
    if (aiResult.success && aiResult.content) {
      return aiResult;
    }
  }

  return { success: true, content: spinResolved };
}

// ─────────────────────────────────────────────
// WORKFLOW STEP GENERATION
// ─────────────────────────────────────────────

/**
 * Analyzes a sequence of recorded browser actions and generates a structured
 * automation step plan using the free AI model.
 *
 * @param settings - App settings containing AI configuration.
 * @param actions - Array of RecordedAction objects from a Browser Recorder session.
 * @returns Array of WorkflowStep objects, or error.
 *
 * @example
 * const result = await aiGateway.generateWorkflowSteps(settings, recordedActions)
 * if (result.success) {
 *   console.log(result.steps)
 * }
 */
async function generateWorkflowSteps(
  settings: AppSettings,
  actions: RecordedAction[]
): Promise<{ success: boolean; steps?: WorkflowStep[]; error?: string }> {
  if (!settings.ai.enabled || !settings.ai.apiKey) {
    return { success: false, error: 'AI not configured or disabled' };
  }

  const actionSummary = actions
    .map((a) => {
      if (a.actionType === 'click') {
        return `Step ${a.step}: CLICK on <${a.elementTag}> "${a.elementText}" (selector: ${a.selector}, x:${a.x}, y:${a.y})`;
      }
      if (a.actionType === 'type') {
        return `Step ${a.step}: TYPE "${a.value}" into ${a.selector}`;
      }
      if (a.actionType === 'navigate') {
        return `Step ${a.step}: NAVIGATE to ${a.url}`;
      }
      return `Step ${a.step}: ${a.actionType}`;
    })
    .join('\n');

  const prompt = `You are a browser automation expert. Analyze the following recorded browser interactions and generate a structured automation workflow.

Recorded actions:
${actionSummary}

Generate a JSON array of WorkflowStep objects. Each object must have:
- stepName: string (short descriptive name, e.g. "Click Login Button")
- selector: string (CSS selector to target the element)
- actionType: "click" | "type" | "navigate"
- value: string (only for "type" actions, otherwise omit)
- description: string (human-readable explanation of what this step does)

Respond with ONLY a valid JSON array. No markdown, no explanation, no code fences.
Example: [{"stepName":"Open Facebook","selector":"","actionType":"navigate","description":"Navigate to Facebook homepage"}]`;

  // Use free model to minimize cost
  const freeModelSettings: AISettings = {
    ...settings.ai,
    provider: 'openrouter',
    model: settings.ai.freeModel || 'openrouter/auto',
    enabled: true,
  };

  const result = await callAI(
    freeModelSettings,
    [{ role: 'user', content: prompt }],
    undefined,
    FREE_MODEL_TIMEOUT_MS
  );

  if (!result.success || !result.content) {
    return { success: false, error: result.error ?? 'No content returned from AI' };
  }

  try {
    // Strip any accidental markdown fences before parsing
    const cleaned = result.content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
    const steps = JSON.parse(cleaned) as WorkflowStep[];
    return { success: true, steps };
  } catch (parseErr: unknown) {
    const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return { success: false, error: `Failed to parse AI response as JSON: ${message}` };
  }
}

// ─────────────────────────────────────────────
// DEBUGGER AGENT
// ─────────────────────────────────────────────

/**
 * Context-aware debugging assistant for the Browser Recorder.
 * Receives the operator's question, the current screenshot, and the recent
 * action log, then responds with analysis, selector suggestions, and
 * proposed next steps.
 *
 * @param settings  - App settings containing AI configuration.
 * @param message   - The operator's question or comment.
 * @param screenshot - Base64-encoded PNG of the current browser viewport (optional).
 * @param actions   - Recent recorded actions (last N entries from the log).
 * @returns AI response with analysis, suggested selectors, and proposed steps.
 *
 * @example
 * const result = await aiGateway.debugSession(settings, 'Why is the login button not found?', frameBase64, recentActions)
 * if (result.success) console.log(result.content)
 */
async function debugSession(
  settings: AppSettings,
  message: string,
  screenshot: string | null,
  actions: RecordedAction[]
): Promise<{ success: boolean; content?: string; error?: string }> {
  if (!settings.ai.enabled || !settings.ai.apiKey) {
    return { success: false, error: 'AI not configured or disabled' };
  }

  // Summarise recent actions for context (last 20 to keep prompt tight)
  const recentActions = actions.slice(-20);
  const actionSummary = recentActions.length > 0
    ? recentActions.map((a, i) =>
        `${i + 1}. [${a.actionType.toUpperCase()}] selector="${a.selector}" value="${a.value ?? ''}" url="${(a as { pageUrl?: string }).pageUrl ?? ''}"`
      ).join('\n')
    : 'No actions recorded yet.';

  const systemPrompt = `You are a browser automation debugger and Facebook DOM expert embedded inside Flogination — a Facebook session management tool.

The operator is manually testing a Facebook feature using a live browser session. You can see:
1. A screenshot of the current browser viewport (if provided)
2. The recent action log showing what the operator has done

Your role:
- Answer the operator's question with precision
- Suggest working CSS selectors when elements are missing or broken
- Identify why automation might be failing based on the DOM context
- Propose workflow steps if asked
- Be concise — this is a debugging session, not a tutorial

When suggesting selectors, prefer: data-testid > aria-label > role > class chains.
Always explain WHY a selector works or fails.`;

  const userContent = `Recent actions (last ${recentActions.length}):\n${actionSummary}\n\nOperator question: ${message}${screenshot ? '\n\n[Note: A screenshot was captured but vision is not available with the current model. Base your analysis on the action log above.]' : ''}`;

  // Use primary model — text-only (vision requires paid model)
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  try {
    const result = await callAI(settings.ai, messages);
    if (!result.success) return { success: false, error: result.error };
    return { success: true, content: result.content };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The AI Gateway — multi-provider LLM client for content generation.
 * All functions return { success: false, error } on failure — never throw.
 *
 * @example
 * import { aiGateway } from '../utils/ai-gateway'
 *
 * const comment = await aiGateway.generateComment(settings, postText, 'url_promotion', promoUrl)
 * if (comment.success) {
 *   await page.fill(commentInput, comment.content!)
 * } else {
 *   // Fall back to spin syntax template
 *   await page.fill(commentInput, spinParser.resolve(template))
 * }
 */
export const aiGateway = {
  /** Core AI call — use typed helpers below when possible. */
  call: callAI,
  /** Generates a unique comment for url_promotion, reels, or page_review. */
  generateComment,
  /** Generates an organic-looking product/page review. */
  generateReview,
  /** Generates a natural human response for inbox messages. */
  generateHumanResponse,
  /** Generates engagement content for a post. */
  generateEngagementContent,
  /** Uses AI to decide the next automation action. */
  decideNextAction,
  /** Gets a replacement CSS selector for a broken element. */
  healSelector,
  /** Resolves spin syntax with optional AI enhancement. */
  generateSpunContent,
  /** Analyzes recorded browser actions and generates a structured workflow step plan. */
  generateWorkflowSteps,
  /** Context-aware debugging assistant — answers questions using live screenshot + action log. */
  debugSession,
};
