/**
 * Flogination V5 — Selector Resolver
 *
 * Central utility that resolves the best available CSS selector for any
 * Facebook UI element. Priority order:
 *
 *   1. selector_cache (human-recorded via Browser Recorder — freshest, most reliable)
 *   2. Hardcoded default (fallback when no cached entry exists)
 *
 * This makes every automation tool future-proof:
 *  - Facebook changes their DOM → operator browses once with Browser Recorder
 *  - New selectors are captured automatically
 *  - All tools pick them up on the next run — zero code changes needed
 *
 * Usage:
 *   import { S } from '../utils/selector-resolver'
 *   const sel = S.ADD_FRIEND          // resolves from cache or returns default
 *   await page.click(sel)
 */

import { db_ } from '../database';

// ─────────────────────────────────────────────
// CORE RESOLVER
// ─────────────────────────────────────────────

/**
 * Resolves the best available CSS selector for a named element.
 * Checks selector_cache first (Browser Recorder recordings), falls back to default.
 *
 * @param elementKey - Logical name for the element (must match Browser Recorder capture key).
 * @param defaultSelector - Fallback CSS selector if no fresh cache entry exists.
 * @returns The freshest available selector string.
 *
 * @example
 * const sel = resolveSelector('aria_Add friend', 'span.html-span.xdj266r.x14z9mp')
 * await page.click(sel)
 */
export function resolveSelector(elementKey: string, defaultSelector: string): string {
  const cached = db_.getFreshSelector(elementKey);
  if (cached) {
    return cached.cssSelector;
  }
  return defaultSelector;
}

// ─────────────────────────────────────────────
// SELECTOR REGISTRY
// All known Facebook UI selectors, keyed by logical name.
// Keys match what Browser Recorder captures (aria-label → aria_*, id → id, etc.)
// ─────────────────────────────────────────────

/**
 * Pre-resolved selector map for all Facebook UI elements used by automation tools.
 * Each property is a getter that resolves from cache on every access.
 *
 * @example
 * import { S } from '../utils/selector-resolver'
 * await page.click(S.ADD_FRIEND)
 * await page.click(S.MESSENGER_ICON)
 */
export const S = {

  // ── Friend Requests ──────────────────────────────────────────────────────

  /** "Add friend" button on /friends page or profile */
  get ADD_FRIEND() {
    return resolveSelector('aria_Add friend',
      'span.html-span.xdj266r.x14z9mp, div.html-div.xdj266r.xat24cr, div.x1ja2u2z.x78zum5.x2lah0s');
  },

  /** "Confirm" button in Add Friend dialog */
  get CONFIRM_ADD_FRIEND() {
    return resolveSelector('aria_Confirm',
      'div.html-div.xdj266r.xat24cr[text="Confirm"], button[aria-label="Confirm"]');
  },

  // ── Messenger / DM ───────────────────────────────────────────────────────

  /** Messenger icon in top nav */
  get MESSENGER_ICON() {
    return resolveSelector('aria_Messenger', '[aria-label="Messenger"]');
  },

  /** Message input box in a conversation thread */
  get MESSAGE_INPUT() {
    return resolveSelector('mw-numeric-code-input-prevent-composer-focus-steal',
      'p.xat24cr.xdj266r, [contenteditable="true"][aria-label*="message"], [data-testid="message-input"]');
  },

  /** Send message button */
  get SEND_MESSAGE() {
    return resolveSelector('aria_Press enter to send',
      'div > div > span > div > svg, button[aria-label*="Send"], [data-testid="send-button"]');
  },

  /** Conversation list item (unread) */
  get CONVERSATION_ITEM() {
    return resolveSelector('class_html-div xdj266r x14z9mp',
      'div.html-div.xdj266r.x14z9mp');
  },

  // ── Comments ─────────────────────────────────────────────────────────────

  /** "Write a comment" input field */
  get COMMENT_INPUT() {
    return resolveSelector('fb_comment_input',
      'p.xdj266r.x14z9mp.xat24cr, [data-testid="UFI2CommentFormBody/root"], [aria-label*="Write a comment"]');
  },

  /** "Post comment" submit button */
  get POST_COMMENT() {
    return resolveSelector('aria_Post comment',
      '[aria-label="Post comment"], [data-testid="comment-post-button"]');
  },

  /** Reply button on a comment */
  get REPLY_BUTTON() {
    return resolveSelector('fb_comment_reply_button',
      '[data-testid="UFI2CommentActionLinks/reply"], button[aria-label*="Reply"]');
  },

  /** Emoji picker button in comment box */
  get COMMENT_EMOJI() {
    return resolveSelector('aria_Insert an emoji', '[aria-label="Insert an emoji"]');
  },

  /** GIF button in comment box */
  get COMMENT_GIF() {
    return resolveSelector('aria_Comment with a GIF', '[aria-label="Comment with a GIF"]');
  },

  // ── Reactions ────────────────────────────────────────────────────────────

  /** Like button on a post */
  get LIKE_BUTTON() {
    return resolveSelector('aria_Like',
      '[aria-label="Like"], [data-testid="like-button"]');
  },

  /** Reaction picker (hover target) */
  get REACTION_PICKER() {
    return resolveSelector('aria_React',
      '[aria-label="React"], [data-testid="reaction-button"]');
  },

  // ── Groups ───────────────────────────────────────────────────────────────

  /** Join Group button */
  get JOIN_GROUP() {
    return resolveSelector('fb_join_group_button',
      '[data-testid="join-button"], button[aria-label*="Join"], a[aria-label*="Join Group"]');
  },

  /** Group post composer "Write something..." */
  get GROUP_POST_COMPOSER() {
    return resolveSelector('fb_group_post_composer',
      '[data-testid="status-attachment-mentions-input"], [placeholder*="Write something"], [aria-label*="Write something"]');
  },

  /** Group post submit button */
  get GROUP_POST_SUBMIT() {
    return resolveSelector('fb_group_post_submit',
      '[data-testid="react-composer-post-button"], button[aria-label="Post"]');
  },

  /** Group list item link */
  get GROUP_LIST_LINK() {
    return resolveSelector('fb_group_list_item_link', 'a[href*="/groups/"]');
  },

  // ── Pages ────────────────────────────────────────────────────────────────

  /** Page name input on /pages/create */
  get PAGE_NAME_INPUT() {
    return resolveSelector('fb_page_name_input',
      '[placeholder*="Page name"], [name="name"]');
  },

  /** Page category input */
  get PAGE_CATEGORY_INPUT() {
    return resolveSelector('fb_page_category_input',
      '[placeholder*="category"], [aria-label*="category"]');
  },

  /** Create Page submit button */
  get CREATE_PAGE_BUTTON() {
    return resolveSelector('fb_create_page_button',
      '[data-testid="create-page-button"], button[type="submit"]');
  },

  /** Page bio/description input */
  get PAGE_BIO_INPUT() {
    return resolveSelector('fb_page_bio_input',
      '[placeholder*="bio"], [placeholder*="description"], textarea[name="description"]');
  },

  /** Page role/admin input */
  get PAGE_ROLE_INPUT() {
    return resolveSelector('fb_page_role_input',
      '[placeholder*="name or email"], [data-testid="page-role-input"]');
  },

  /** Add role button on page settings */
  get ADD_ROLE_BUTTON() {
    return resolveSelector('fb_add_role_button',
      '[data-testid="add-role-button"], button[type="submit"]');
  },

  /** Remove self from page admins */
  get REMOVE_SELF_ADMIN() {
    return resolveSelector('fb_remove_self_admin',
      '[data-testid="remove-role-button"], button[aria-label*="Remove"]');
  },

  /** Pages list item link */
  get PAGES_LIST_LINK() {
    return resolveSelector('fb_pages_list_item_link', 'a[href*="/pages/"]');
  },

  // ── Business Manager ─────────────────────────────────────────────────────

  /** Create BM button on business.facebook.com */
  get CREATE_BM_BUTTON() {
    return resolveSelector('fb_create_bm_button',
      '[data-testid="create-business-button"], button[aria-label*="Create"], a[href*="create"]');
  },

  /** BM name input */
  get BM_NAME_INPUT() {
    return resolveSelector('fb_bm_name_input',
      '[placeholder*="Business name"], [name="name"], input[type="text"]:first-of-type');
  },

  /** BM email input */
  get BM_EMAIL_INPUT() {
    return resolveSelector('fb_bm_email_input',
      '[placeholder*="email"], [name="email"], input[type="email"]');
  },

  /** BM form submit button */
  get BM_SUBMIT_BUTTON() {
    return resolveSelector('fb_bm_submit_button',
      'button[type="submit"], [data-testid="submit-button"]');
  },

  /** BM Add People button */
  get BM_ADD_PEOPLE() {
    return resolveSelector('fb_bm_add_people_button',
      '[data-testid="add-people-button"], button[aria-label*="Add people"]');
  },

  /** BM invite email input */
  get BM_INVITE_EMAIL() {
    return resolveSelector('fb_bm_invite_email_input',
      '[placeholder*="email"], [name="email"], input[type="email"]');
  },

  /** BM Admin role option */
  get BM_ADMIN_ROLE() {
    return resolveSelector('fb_bm_admin_role_option',
      '[data-testid="admin-role"], input[value="ADMIN"], [aria-label*="Admin"]');
  },

  /** BM invite/send button */
  get BM_INVITE_BUTTON() {
    return resolveSelector('fb_bm_invite_button',
      '[data-testid="invite-button"], button[type="submit"]');
  },

  /** BM selector item in overview */
  get BM_SELECTOR_ITEM() {
    return resolveSelector('fb_bm_selector_item',
      '[data-testid="business-selector-item"]');
  },

  // ── Profile / Scraping ───────────────────────────────────────────────────

  /** Profile name h1 */
  get PROFILE_NAME() {
    return resolveSelector('fb_profile_name_h1',
      'h1[data-testid="profile-name"], h1.x1heor9g, h1');
  },

  /** Friends count badge */
  get FRIENDS_COUNT() {
    return resolveSelector('fb_friends_count_badge',
      '[data-testid="friends_count"], a[href*="/friends"] span');
  },

  /** Professional mode toggle */
  get PROFESSIONAL_MODE_TOGGLE() {
    return resolveSelector('class_xdmh292 x15dsfln x140p0ai',
      'span.xdmh292.x15dsfln.x140p0ai');
  },

  // ── Navigation ───────────────────────────────────────────────────────────

  /** Reels nav item */
  get REELS_NAV() {
    return resolveSelector('aria_Reels', '[aria-label="Reels"]');
  },

  /** Close button (modals, panels) */
  get CLOSE_BUTTON() {
    return resolveSelector('aria_Close', '[aria-label="Close"]');
  },

  // ── 2FA ──────────────────────────────────────────────────────────────────

  /** 2FA code input */
  get TWO_FA_INPUT() {
    return resolveSelector('fb_2fa_input_approvals',
      '[name="approvals_code"], [name="mfa_code"], input[type="text"]');
  },
};
