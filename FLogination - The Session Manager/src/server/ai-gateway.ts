import axios from 'axios';
import type { AISettings, CommentStance, RecordedAction, WorkflowStep } from '../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const DEEPSEEK_BASE = 'https://api.deepseek.com/v1';
const OPENAI_BASE = 'https://api.openai.com/v1';
const GLM_BASE = 'https://open.bigmodel.cn/api/paas/v4';

/** Default free-tier model used for low-cost tasks like selector healing. */
const DEFAULT_FREE_MODEL = 'openrouter/auto';

/** Timeout in milliseconds for self-healing selector AI calls. */
const HEAL_SELECTOR_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────
// INTERNAL TYPES
// ─────────────────────────────────────────────

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AIGatewayResponse {
  success: boolean;
  content?: string;
  error?: string;
}

interface AxiosRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  data: {
    model: string;
    messages: ChatMessage[];
  };
  timeout?: number;
}

// ─────────────────────────────────────────────
// REQUEST BUILDERS
// ─────────────────────────────────────────────

const buildOpenRouterRequest = (
  settings: AISettings,
  messages: ChatMessage[],
  timeout?: number
): AxiosRequestConfig => ({
  url: `${OPENROUTER_BASE}/chat/completions`,
  method: 'POST',
  headers: {
    Authorization: `Bearer ${settings.apiKey}`,
    'HTTP-Referer': 'https://flogination.local',
    'X-Title': 'Flogination',
    'Content-Type': 'application/json',
  },
  data: {
    model: settings.model,
    messages,
  },
  ...(timeout !== undefined ? { timeout } : {}),
});

const buildDeepSeekRequest = (
  settings: AISettings,
  messages: ChatMessage[]
): AxiosRequestConfig => ({
  url: `${DEEPSEEK_BASE}/chat/completions`,
  method: 'POST',
  headers: {
    Authorization: `Bearer ${settings.apiKey}`,
    'Content-Type': 'application/json',
  },
  data: {
    model: settings.model || 'deepseek-chat',
    messages,
  },
});

const buildOpenAIRequest = (
  settings: AISettings,
  messages: ChatMessage[]
): AxiosRequestConfig => ({
  url: `${OPENAI_BASE}/chat/completions`,
  method: 'POST',
  headers: {
    Authorization: `Bearer ${settings.apiKey}`,
    'Content-Type': 'application/json',
  },
  data: {
    model: settings.model || 'gpt-3.5-turbo',
    messages,
  },
});

const buildGLMRequest = (
  settings: AISettings,
  messages: ChatMessage[]
): AxiosRequestConfig => ({
  url: `${GLM_BASE}/chat/completions`,
  method: 'POST',
  headers: {
    Authorization: `Bearer ${settings.apiKey}`,
    'Content-Type': 'application/json',
  },
  data: {
    model: settings.model || 'glm-4',
    messages,
  },
});

// ─────────────────────────────────────────────
// CORE CALL
// ─────────────────────────────────────────────

/**
 * Low-level AI call. Dispatches to the correct provider based on settings.
 * Never throws — always returns a result object.
 *
 * @param settings - AI provider configuration.
 * @param messages - Chat messages to send (without system prompt).
 * @param systemPrompt - Optional system prompt prepended to messages.
 * @param timeout - Optional request timeout in milliseconds.
 * @returns Response content or error.
 *
 * @example
 * const result = await callAI(settings, [{ role: 'user', content: 'Hello' }])
 * if (result.success) console.log(result.content)
 */
const callAI = async (
  settings: AISettings,
  messages: ChatMessage[],
  systemPrompt?: string,
  timeout?: number
): Promise<AIGatewayResponse> => {
  if (!settings.enabled || !settings.apiKey) {
    return { success: false, error: 'AI not configured or disabled' };
  }

  const fullMessages: ChatMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;

  try {
    let requestConfig: AxiosRequestConfig;

    switch (settings.provider) {
      case 'openrouter':
        requestConfig = buildOpenRouterRequest(settings, fullMessages, timeout);
        break;
      case 'deepseek':
        requestConfig = buildDeepSeekRequest(settings, fullMessages);
        break;
      case 'openai':
        requestConfig = buildOpenAIRequest(settings, fullMessages);
        break;
      case 'glm':
        requestConfig = buildGLMRequest(settings, fullMessages);
        break;
      default:
        return { success: false, error: `Unknown provider: ${settings.provider}` };
    }

    const response = await axios(requestConfig);

    const content: unknown =
      response.data?.choices?.[0]?.message?.content;

    if (typeof content === 'string' && content.length > 0) {
      return { success: true, content };
    }

    return { success: false, error: 'No content in response' };
  } catch (e: unknown) {
    const axiosError = e as {
      response?: { data?: { error?: { message?: string } } };
      message?: string;
    };
    const errorMsg =
      axiosError.response?.data?.error?.message ??
      axiosError.message ??
      'Unknown error';
    return { success: false, error: errorMsg };
  }
};

// ─────────────────────────────────────────────
// EXISTING FUNCTIONS
// ─────────────────────────────────────────────

/**
 * Generates a natural, human-like social media response for a given context.
 *
 * @param settings - AI provider configuration.
 * @param context - The post or conversation context to respond to.
 * @param action - The type of response to generate.
 * @returns Generated text or error.
 *
 * @example
 * const result = await generateHumanResponse(settings, 'Great product!', 'comment')
 * if (result.success) console.log(result.content)
 */
const generateHumanResponse = async (
  settings: AISettings,
  context: string,
  action: 'comment' | 'message' | 'post'
): Promise<AIGatewayResponse> => {
  const systemPrompt = `You are a human writing natural, casual social media content. 
  - Use casual language, occasional typos are OK
  - Vary your writing style
  - Keep responses short and natural (1-3 sentences for comments, short for messages)
  - Use some emojis occasionally but not too many
  - Never sound like an AI or bot
  - Add human-like imperfections`;

  const userMessage = `Context: ${context}\n\nGenerate a natural ${action} response that sounds like a real human wrote it.`;

  return callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);
};

/**
 * Decides the next best action for a social media account given its current context.
 *
 * @param settings - AI provider configuration.
 * @param accountContext - Description of the account's current state.
 * @param availableActions - List of valid action names to choose from.
 * @returns The chosen action name or error.
 *
 * @example
 * const result = await decideNextAction(settings, 'Account has 500 friends', ['post', 'comment'])
 * if (result.success) console.log(result.content) // → 'post'
 */
const decideNextAction = async (
  settings: AISettings,
  accountContext: string,
  availableActions: string[]
): Promise<AIGatewayResponse> => {
  const systemPrompt = `You are an AI agent deciding the next best action for a social media account.
  Analyze the account status and available actions, then decide the best next step.
  Return ONLY the action name, nothing else. Choose from: ${availableActions.join(', ')}`;

  const userMessage = `Account Context: ${accountContext}\n\nAvailable actions: ${availableActions.join(', ')}\n\nWhat should the account do next?`;

  return callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);
};

/**
 * Generates engagement content (like text, comment, or share caption) for a given post.
 *
 * @param settings - AI provider configuration.
 * @param targetPost - The post to engage with.
 * @param engagementType - The type of engagement to generate.
 * @returns Generated engagement content or error.
 *
 * @example
 * const result = await generateEngagementContent(settings, { content: 'Hello!', author: 'Alice' }, 'comment')
 * if (result.success) console.log(result.content)
 */
const generateEngagementContent = async (
  settings: AISettings,
  targetPost: { content: string; author: string },
  engagementType: 'like' | 'comment' | 'share'
): Promise<AIGatewayResponse> => {
  const systemPrompt = `You are a human engaging with content on social media.
  Generate ${engagementType} content that:
  - Is natural and human-like
  - Is relevant to the post
  - Could realistically come from the target demographic`;

  const userMessage = `Post by ${targetPost.author}: "${targetPost.content}"\n\nGenerate a ${engagementType} for this post.`;

  return callAI(settings, [{ role: 'user', content: userMessage }], systemPrompt);
};

// ─────────────────────────────────────────────
// NEW FUNCTIONS — V5 ADDITIONS
// ─────────────────────────────────────────────

/**
 * Generates a Facebook Page review in the specified tone.
 * Used by the Comment Marketing Engine (page_review stance).
 *
 * @param settings - AI provider configuration.
 * @param pageName - The name of the Facebook Page being reviewed.
 * @param productDesc - Short description of the product or service offered by the page.
 * @param tone - Desired tone, e.g. 'enthusiastic', 'neutral', 'professional'.
 * @returns Generated review text or error.
 *
 * @example
 * const result = await generateReview(settings, 'Acme Store', 'handmade candles', 'enthusiastic')
 * if (result.success) console.log(result.text)
 */
const generateReview = async (
  settings: AISettings,
  pageName: string,
  productDesc: string,
  tone: string
): Promise<{ success: boolean; text?: string; error?: string }> => {
  const systemPrompt = `You are a real customer writing a Facebook Page review.
Write a short, authentic review (2-4 sentences) that:
- Sounds like a genuine human customer, not a bot
- Matches the requested tone exactly
- Mentions the page name and product/service naturally
- Includes a specific detail that makes it feel personal
- Never uses generic filler phrases like "highly recommend" alone
- Ends with a natural call-to-action or personal note`;

  const userMessage = `Write a ${tone} review for the Facebook Page "${pageName}" which sells/offers: ${productDesc}.`;

  const result = await callAI(
    settings,
    [{ role: 'user', content: userMessage }],
    systemPrompt
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, text: result.content };
};

/**
 * Generates a human-like Facebook comment for the Comment Marketing Engine.
 * Adapts content based on the campaign stance.
 *
 * @param settings - AI provider configuration.
 * @param postExcerpt - A short excerpt of the post being commented on.
 * @param promoUrl - Optional promotional URL to weave into the comment (url_promotion stance).
 * @param stance - The campaign stance driving the comment style.
 * @returns Generated comment text or error.
 *
 * @example
 * const result = await generateComment(settings, 'Amazing sunset photo!', 'https://mysite.com', 'url_promotion')
 * if (result.success) console.log(result.text)
 */
const generateComment = async (
  settings: AISettings,
  postExcerpt: string,
  promoUrl: string | undefined,
  stance: CommentStance
): Promise<{ success: boolean; text?: string; error?: string }> => {
  const stanceInstructions: Record<CommentStance, string> = {
    url_promotion: `Write a casual, engaging comment that naturally mentions or links to the promotional URL. 
The URL should feel like a helpful suggestion, not an advertisement. 
Keep it under 2 sentences. Include the URL at the end.`,
    reels_commenting: `Write a short, enthusiastic comment (1-2 sentences) that reacts to the reel content.
Sound like a genuine viewer — use casual language, maybe an emoji or two.
Do NOT include any links or promotions.`,
    page_review: `Write a positive, authentic-sounding comment that engages with the post topic.
Sound like a real person who found the content valuable.
Keep it 1-3 sentences. No links.`,
  };

  const urlLine = promoUrl ? `\nPromotional URL to include: ${promoUrl}` : '';

  const systemPrompt = `You are a real Facebook user leaving a comment. ${stanceInstructions[stance]}
Never sound like a bot or marketer. Use natural, conversational language.`;

  const userMessage = `Post excerpt: "${postExcerpt}"${urlLine}\n\nWrite the comment.`;

  const result = await callAI(
    settings,
    [{ role: 'user', content: userMessage }],
    systemPrompt
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, text: result.content };
};

/**
 * Attempts to heal a broken CSS selector using AI analysis of the parent HTML.
 * Uses the free model (settings.freeModel or 'openrouter/auto') with a 10-second timeout
 * to keep costs near zero for maintenance tasks.
 *
 * Expects the AI to return a JSON object: `{ "selector": "..." }`
 *
 * @param settings - AI provider configuration. Uses `freeModel` field for cost control.
 * @param elementKey - Logical name for the element, e.g. "fb_comment_button".
 * @param failedSelector - The CSS selector that stopped working.
 * @param parentHtml - Up to 2000 chars of the parent element's HTML for context.
 * @returns New CSS selector string or error.
 *
 * @example
 * const result = await healSelector(settings, 'fb_comment_button', '[data-testid="comment"]', parentHtml)
 * if (result.success) console.log(result.selector) // → '[aria-label="Comment"]'
 */
const healSelector = async (
  settings: AISettings,
  elementKey: string,
  failedSelector: string,
  parentHtml: string
): Promise<{ success: boolean; selector?: string; error?: string }> => {
  // Use the free model to keep healing costs near zero
  const freeModelSettings: AISettings = {
    ...settings,
    model: settings.freeModel || DEFAULT_FREE_MODEL,
  };

  const systemPrompt = `You are a DOM expert. Given a broken CSS selector and the current parent HTML, 
find a new, stable CSS selector for the target element.

Rules:
- Prefer selectors using aria-label, data-testid, or role attributes over class names
- Avoid selectors that rely on auto-generated class names (e.g. x1abc123)
- Return ONLY valid JSON in this exact format: { "selector": "your-selector-here" }
- Do not include any explanation or text outside the JSON object`;

  const userMessage = `Element key: ${elementKey}
Failed selector: ${failedSelector}
Parent HTML (truncated to 2000 chars):
${parentHtml.slice(0, 2_000)}

Find a new CSS selector for this element.`;

  const result = await callAI(
    freeModelSettings,
    [{ role: 'user', content: userMessage }],
    systemPrompt,
    HEAL_SELECTOR_TIMEOUT_MS
  );

  if (!result.success || !result.content) {
    return { success: false, error: result.error ?? 'No content returned from AI' };
  }

  try {
    // Extract JSON object from response (handle markdown code blocks)
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: 'AI response did not contain a valid JSON object' };
    }
    const parsed = JSON.parse(jsonMatch[0]) as { selector?: unknown };
    if (typeof parsed.selector !== 'string' || parsed.selector.trim() === '') {
      return { success: false, error: 'AI returned empty or invalid selector field' };
    }
    return { success: true, selector: parsed.selector };
  } catch (parseErr: unknown) {
    const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return { success: false, error: `Failed to parse AI response as JSON: ${message}` };
  }
};

/**
 * Resolves spin syntax in a content template using AI for more natural variation.
 * Unlike the deterministic spin-parser, this uses the LLM to produce contextually
 * appropriate content based on the provided context.
 *
 * @param settings - AI provider configuration.
 * @param template - Content template, may contain {a|b|c} spin tokens or plain text.
 * @param context - Additional context to guide the AI (e.g. target audience, topic).
 * @returns Resolved/spun content text or error.
 *
 * @example
 * const result = await generateSpunContent(settings, '{Check this out|Look at this}: great product', 'Facebook group about fitness')
 * if (result.success) console.log(result.text)
 */
const generateSpunContent = async (
  settings: AISettings,
  template: string,
  context: string
): Promise<{ success: boolean; text?: string; error?: string }> => {
  const systemPrompt = `You are a content writer. Given a content template with optional spin syntax {option1|option2|option3} 
and a context description, produce a single natural, human-sounding version of the content.

Rules:
- For each {a|b|c} token, pick the most contextually appropriate option
- The result must read naturally — no awkward phrasing
- Preserve any URLs, hashtags, or mentions exactly as written
- Return ONLY the final resolved text, no explanation`;

  const userMessage = `Context: ${context}

Template:
${template}

Produce the final content.`;

  const result = await callAI(
    settings,
    [{ role: 'user', content: userMessage }],
    systemPrompt
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }
  return { success: true, text: result.content };
};

/**
 * Sends a sequence of RecordedAction objects to the AI and requests a structured
 * automation step plan as a JSON array of WorkflowStep objects.
 * Uses the freeModel setting to minimise cost.
 *
 * @param settings - AI provider configuration (reads freeModel for cost control).
 * @param actions - The recorded browser actions to analyse.
 * @returns Array of WorkflowStep objects, or error.
 *
 * @example
 * const result = await generateWorkflowSteps(settings, recordedActions)
 * if (result.success) console.log(result.steps)
 */
const generateWorkflowSteps = async (
  settings: AISettings,
  actions: RecordedAction[]
): Promise<{ success: boolean; steps?: WorkflowStep[]; error?: string }> => {
  // Use the free model for workflow analysis to keep costs low
  const freeModelSettings: AISettings = {
    ...settings,
    model: settings.freeModel || DEFAULT_FREE_MODEL,
  };

  const systemPrompt = `You are an automation engineer. Given a sequence of browser interactions recorded by a human operator, generate a structured automation step plan.

Return ONLY a valid JSON array of step objects. Each object must have:
- stepName: string (short descriptive name)
- selector: string (CSS selector to target)
- actionType: "click" | "type" | "navigate"
- value: string (optional, for type actions)
- description: string (what this step does and why)

Example output:
[
  { "stepName": "Click Login Button", "selector": "#login-btn", "actionType": "click", "description": "Clicks the main login button to open the login form" },
  { "stepName": "Type Email", "selector": "input[type=email]", "actionType": "type", "value": "{email}", "description": "Types the account email into the email field" }
]

Do not include any text outside the JSON array.`;

  const userMessage = `Here are the recorded browser interactions:\n\n${JSON.stringify(actions, null, 2)}\n\nGenerate the automation step plan.`;

  const result = await callAI(
    freeModelSettings,
    [{ role: 'user', content: userMessage }],
    systemPrompt
  );

  if (!result.success || !result.content) {
    return { success: false, error: result.error ?? 'No content returned from AI' };
  }

  try {
    // Extract JSON array from the response (handle markdown code blocks)
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return { success: false, error: 'AI response did not contain a valid JSON array' };
    }
    const steps = JSON.parse(jsonMatch[0]) as WorkflowStep[];
    return { success: true, steps };
  } catch (parseErr: unknown) {
    const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
    return { success: false, error: `Failed to parse AI response as JSON: ${message}` };
  }
};

// ─────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────

export const aiGateway = {
  call: callAI,
  generateHumanResponse,
  decideNextAction,
  generateEngagementContent,
  generateReview,
  generateComment,
  healSelector,
  generateSpunContent,
  generateWorkflowSteps,
};
