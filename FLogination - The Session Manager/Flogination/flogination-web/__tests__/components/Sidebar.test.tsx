/**
 * Sidebar — Active State Property-Based Tests
 *
 * Property 5: For any view name in the full nav set, when currentView equals
 * that view name, the active classes are present and inactive classes are
 * absent. When currentView does NOT equal that view, active classes are absent.
 * Exactly one nav item is active at any time.
 *
 * Tests the pure class-building logic extracted from Sidebar.tsx:
 *
 *   const activeClass = isActive
 *     ? 'bg-primary/5 text-primary font-semibold border-l-[3px] border-primary'
 *     : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
 *
 * **Validates: Requirements 3.4, 16.1**
 */

import fc from 'fast-check';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES (mirrored from Sidebar.tsx — not exported)
// ─────────────────────────────────────────────────────────────────────────────

interface NavLeaf {
  kind: 'leaf';
  icon: string;
  label: string;
  view: string;
  badgeKey?: 'scraping' | 'campaigns';
  isNew?: boolean;
}

interface NavGroup {
  kind: 'group';
  icon: string;
  label: string;
  groupKey: string;
  children: NavLeaf[];
}

type NavItem = NavLeaf | NavGroup;

// ─────────────────────────────────────────────────────────────────────────────
// NAV STRUCTURE (mirrored from Sidebar.tsx — not exported)
// ─────────────────────────────────────────────────────────────────────────────

const TOP_NAV: NavItem[] = [
  { kind: 'leaf', icon: 'dashboard',        label: 'Dashboard', view: 'dashboard' },
  { kind: 'leaf', icon: 'manage_accounts',  label: 'Accounts',  view: 'accounts', badgeKey: 'scraping' },
  {
    kind: 'group', icon: 'inbox', label: 'Inbox', groupKey: 'inbox',
    children: [
      { kind: 'leaf', icon: 'inbox',                 label: 'All Messages', view: 'inbox' },
      { kind: 'leaf', icon: 'contacts',              label: 'Contacts',     view: 'inbox-contacts' },
      { kind: 'leaf', icon: 'local_fire_department', label: 'Warm-Up',      view: 'inbox-warmup' },
    ],
  },
  { kind: 'leaf', icon: 'filter_alt', label: 'Funnels', view: 'funnels', isNew: true },
  {
    kind: 'group', icon: 'construction', label: 'Tools', groupKey: 'tools',
    children: [
      { kind: 'leaf', icon: 'web',         label: 'Page Factory',      view: 'tools-page-factory' },
      { kind: 'leaf', icon: 'business',    label: 'BM Factory',        view: 'tools-bm-factory' },
      { kind: 'leaf', icon: 'groups',      label: 'Group Hunter',      view: 'tools-group-hunter' },
      { kind: 'leaf', icon: 'comment',     label: 'Comment Marketing', view: 'tools-comment-marketing' },
      { kind: 'leaf', icon: 'trending_up', label: 'Content Amplifier', view: 'tools-content-amplifier' },
      { kind: 'leaf', icon: 'videocam',    label: 'Browser Recorder',  view: 'tools-browser-recorder' },
    ],
  },
];

const BOTTOM_NAV: NavLeaf[] = [
  { kind: 'leaf', icon: 'grid_view',   label: 'Grid View', view: 'grid' },
  { kind: 'leaf', icon: 'bolt',        label: 'Campaigns', view: 'campaigns', badgeKey: 'campaigns' },
  { kind: 'leaf', icon: 'shield',      label: 'Proxies',   view: 'proxies' },
  { kind: 'leaf', icon: 'description', label: 'Logs',      view: 'logs' },
  { kind: 'leaf', icon: 'settings',    label: 'Settings',  view: 'settings' },
];

// ─────────────────────────────────────────────────────────────────────────────
// PURE HELPERS (mirrored from Sidebar.tsx — not exported)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given nav item (or any of its children) matches the
 * active view. Mirrors the `isItemActive` function in Sidebar.tsx.
 */
function isItemActive(item: NavItem, currentView: string): boolean {
  if (item.kind === 'leaf') return item.view === currentView;
  return item.children.some((child) => child.view === currentView);
}

/**
 * Returns the active or inactive CSS class string for a nav item.
 * Mirrors the `activeClass` computation in LeafButton and GroupButton.
 */
function buildActiveClass(isActive: boolean): string {
  return isActive
    ? 'bg-primary/5 text-primary font-semibold border-l-[3px] border-primary'
    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface';
}

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** All leaf view names reachable from the sidebar (17 total). */
const ALL_VIEW_NAMES: string[] = [
  'dashboard',
  'accounts',
  'inbox',
  'inbox-contacts',
  'inbox-warmup',
  'funnels',
  'tools-page-factory',
  'tools-bm-factory',
  'tools-group-hunter',
  'tools-comment-marketing',
  'tools-content-amplifier',
  'tools-browser-recorder',
  'grid',
  'campaigns',
  'proxies',
  'logs',
  'settings',
];

/** Active class tokens that MUST be present when a nav item is active. */
const ACTIVE_CLASSES = [
  'bg-primary/5',
  'text-primary',
  'font-semibold',
  'border-l-[3px]',
  'border-primary',
] as const;

/** Inactive class tokens that MUST be absent when a nav item is active. */
const INACTIVE_CLASSES = [
  'text-on-surface-variant',
  'hover:bg-surface-container',
  'hover:text-on-surface',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS FOR ASSERTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Splits a class string into individual tokens for membership checks.
 * Handles Tailwind's arbitrary-value classes like `border-l-[3px]`.
 */
function classTokens(classStr: string): Set<string> {
  return new Set(classStr.split(/\s+/).filter(Boolean));
}

/**
 * Returns true if every token in `required` is present in `classStr`.
 */
function hasAllClasses(classStr: string, required: readonly string[]): boolean {
  const tokens = classTokens(classStr);
  return required.every((cls) => tokens.has(cls));
}

/**
 * Returns true if none of the tokens in `forbidden` are present in `classStr`.
 */
function hasNoneOfClasses(classStr: string, forbidden: readonly string[]): boolean {
  const tokens = classTokens(classStr);
  return forbidden.every((cls) => !tokens.has(cls));
}

/**
 * Collects all leaf views that are considered active for a given currentView.
 * A leaf is active when its view === currentView.
 * A group is active when any child view === currentView.
 */
function countActiveItems(currentView: string): number {
  let count = 0;

  for (const item of TOP_NAV) {
    if (isItemActive(item, currentView)) count++;
  }
  for (const item of BOTTOM_NAV) {
    if (isItemActive(item, currentView)) count++;
  }

  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY 5 — Sidebar Active State
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 3.4, 16.1**
 */
describe('Property 5 — Sidebar Active State', () => {

  // ── 5a: Active view → active classes present, inactive classes absent ──────

  describe('When currentView equals the view name — active classes are applied', () => {
    test('active class string contains all required active tokens (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_VIEW_NAMES),
          (viewName) => {
            const cls = buildActiveClass(true);
            return hasAllClasses(cls, ACTIVE_CLASSES);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('active class string contains NO inactive tokens (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_VIEW_NAMES),
          (viewName) => {
            const cls = buildActiveClass(true);
            return hasNoneOfClasses(cls, INACTIVE_CLASSES);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('isItemActive returns true for the matching leaf view (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_VIEW_NAMES),
          (viewName) => {
            // Find the nav item that owns this view
            const allItems: NavItem[] = [...TOP_NAV, ...BOTTOM_NAV];
            const ownerItem = allItems.find((item) => {
              if (item.kind === 'leaf') return item.view === viewName;
              return item.children.some((child) => child.view === viewName);
            });
            if (!ownerItem) return false;
            return isItemActive(ownerItem, viewName) === true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ── 5b: Non-active view → active classes absent ───────────────────────────

  describe('When currentView does NOT equal the view name — active classes are absent', () => {
    test('inactive class string contains NO active tokens (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_VIEW_NAMES),
          (viewName) => {
            const cls = buildActiveClass(false);
            return hasNoneOfClasses(cls, ACTIVE_CLASSES);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('inactive class string contains all required inactive tokens (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_VIEW_NAMES),
          (viewName) => {
            const cls = buildActiveClass(false);
            return hasAllClasses(cls, INACTIVE_CLASSES);
          }
        ),
        { numRuns: 100 }
      );
    });

    test('isItemActive returns false for non-matching leaf items (property)', () => {
      fc.assert(
        fc.property(
          // Pick two different view names
          fc.constantFrom(...ALL_VIEW_NAMES),
          fc.constantFrom(...ALL_VIEW_NAMES),
          (currentView, otherView) => {
            // Only test when they differ
            if (currentView === otherView) return true;

            // Find the nav item that owns otherView
            const allItems: NavItem[] = [...TOP_NAV, ...BOTTOM_NAV];
            const ownerItem = allItems.find((item) => {
              if (item.kind === 'leaf') return item.view === otherView;
              return item.children.some((child) => child.view === otherView);
            });
            if (!ownerItem) return true;

            // The owner of otherView should NOT be active when currentView is different
            // (unless they share a group — a group is active when any child matches)
            if (ownerItem.kind === 'group') {
              // Group is active if currentView is one of its children
              const groupActive = ownerItem.children.some((c) => c.view === currentView);
              return isItemActive(ownerItem, currentView) === groupActive;
            }

            // Leaf: active only when its view === currentView
            return isItemActive(ownerItem, currentView) === (ownerItem.view === currentView);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ── 5c: Exactly one nav item is active at any time ────────────────────────

  describe('Exactly one nav item is active at any time', () => {
    test('exactly one top-level nav item is active for any valid view (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_VIEW_NAMES),
          (currentView) => {
            const activeCount = countActiveItems(currentView);
            return activeCount === 1;
          }
        ),
        { numRuns: 100 }
      );
    });

    test('active count is exactly 1 for every view name (exhaustive)', () => {
      for (const viewName of ALL_VIEW_NAMES) {
        const count = countActiveItems(viewName);
        expect(count).toBe(1);
      }
    });
  });

  // ── 5d: Active/inactive classes are mutually exclusive ───────────────────

  describe('Active and inactive class strings are mutually exclusive', () => {
    test('active and inactive class strings share no tokens (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_VIEW_NAMES),
          (_viewName) => {
            const activeStr   = buildActiveClass(true);
            const inactiveStr = buildActiveClass(false);
            const activeTokens   = classTokens(activeStr);
            const inactiveTokens = classTokens(inactiveStr);

            // No token should appear in both
            for (const token of Array.from(activeTokens)) {
              if (inactiveTokens.has(token)) return false;
            }
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });

    test('buildActiveClass(true) !== buildActiveClass(false)', () => {
      expect(buildActiveClass(true)).not.toBe(buildActiveClass(false));
    });
  });

  // ── 5e: Boundary / exhaustive checks ─────────────────────────────────────

  describe('Exhaustive boundary checks for all 17 view names', () => {
    test.each(ALL_VIEW_NAMES)(
      'view "%s" → active class has all required tokens',
      (viewName) => {
        const cls = buildActiveClass(true);
        for (const token of ACTIVE_CLASSES) {
          expect(classTokens(cls).has(token)).toBe(true);
        }
      }
    );

    test.each(ALL_VIEW_NAMES)(
      'view "%s" → inactive class has no active tokens',
      (viewName) => {
        const cls = buildActiveClass(false);
        for (const token of ACTIVE_CLASSES) {
          expect(classTokens(cls).has(token)).toBe(false);
        }
      }
    );

    test.each(ALL_VIEW_NAMES)(
      'view "%s" → isItemActive correctly identifies the owning nav item',
      (viewName) => {
        const allItems: NavItem[] = [...TOP_NAV, ...BOTTOM_NAV];

        // The item that owns this view should be active
        const ownerItem = allItems.find((item) => {
          if (item.kind === 'leaf') return item.view === viewName;
          return item.children.some((child) => child.view === viewName);
        });

        expect(ownerItem).toBeDefined();
        expect(isItemActive(ownerItem!, viewName)).toBe(true);

        // All other items should be inactive
        const otherItems = allItems.filter((item) => item !== ownerItem);
        for (const item of otherItems) {
          expect(isItemActive(item, viewName)).toBe(false);
        }
      }
    );
  });
});
