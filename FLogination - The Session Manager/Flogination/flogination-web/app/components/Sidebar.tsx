'use client';
import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../../../src/store';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// NAV STRUCTURE
// ─────────────────────────────────────────────

const MANAGEMENT_NAV: NavItem[] = [
  { kind: 'leaf', icon: 'dashboard',       label: 'Dashboard', view: 'dashboard' },
  { kind: 'leaf', icon: 'manage_accounts', label: 'Accounts',  view: 'accounts', badgeKey: 'scraping' },
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

const OPERATIONS_NAV: NavLeaf[] = [
  { kind: 'leaf', icon: 'grid_view',   label: 'Grid View', view: 'grid' },
  { kind: 'leaf', icon: 'bolt',        label: 'Campaigns', view: 'campaigns', badgeKey: 'campaigns' },
  { kind: 'leaf', icon: 'shield',      label: 'Proxies',   view: 'proxies' },
  { kind: 'leaf', icon: 'description', label: 'Logs',      view: 'logs' },
  { kind: 'leaf', icon: 'settings',    label: 'Settings',  view: 'settings' },
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function isItemActive(item: NavItem, currentView: string): boolean {
  if (item.kind === 'leaf') return item.view === currentView;
  return item.children.some((child) => child.view === currentView);
}

function isGroupExpanded(group: NavGroup, currentView: string): boolean {
  return group.children.some((child) => child.view === currentView);
}

// ─────────────────────────────────────────────
// FLYOUT PANEL — shown in collapsed mode on group hover
// ─────────────────────────────────────────────

interface FlyoutProps {
  group: NavGroup;
  currentView: string;
  topOffset: number;
  onNavigate: (view: string) => void;
  onClose: () => void;
}

/**
 * Floating flyout panel that appears to the right of the collapsed sidebar
 * when hovering over a group icon. Allows navigating sub-items without
 * expanding the sidebar.
 */
function FlyoutPanel({ group, currentView, topOffset, onNavigate, onClose }: FlyoutProps) {
  return (
    <div
      className="fixed z-50 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-elevated py-2 min-w-[180px]"
      style={{ left: '60px', top: topOffset }}
      onMouseLeave={onClose}
    >
      {/* Group label header */}
      <div className="px-4 pb-1.5 pt-0.5 border-b border-outline-variant mb-1">
        <span className="text-[11px] font-semibold text-outline uppercase tracking-widest">
          {group.label}
        </span>
      </div>
      {group.children.map((child) => {
        const isActive = child.view === currentView;
        return (
          <button
            key={child.view}
            onClick={() => { onNavigate(child.view); onClose(); }}
            className={`flex items-center gap-2.5 w-full px-4 h-8 text-left transition-colors ${
              isActive
                ? 'bg-primary-container/20 text-primary font-semibold'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            <span className="material-symbols-outlined text-[16px] shrink-0">{child.icon}</span>
            <span className="text-[13px] font-medium truncate">{child.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// LEAF BUTTON
// ─────────────────────────────────────────────

interface LeafButtonProps {
  item: NavLeaf;
  isActive: boolean;
  collapsed: boolean;
  scrapingCount: number;
  runningCampaigns: number;
  onClick: () => void;
  indent?: boolean;
}

function LeafButton({
  item,
  isActive,
  collapsed,
  scrapingCount,
  runningCampaigns,
  onClick,
  indent = false,
}: LeafButtonProps) {
  const badge =
    item.badgeKey === 'scraping'    ? scrapingCount
    : item.badgeKey === 'campaigns' ? runningCampaigns
    : 0;

  const activeClass = isActive
    ? 'bg-primary-container/20 text-primary font-semibold rounded-lg'
    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface rounded-lg';

  const heightClass  = indent ? 'h-7'        : 'h-8';
  const iconSize     = indent ? 'text-[14px]' : 'text-[18px]';
  const labelSize    = indent ? 'text-[11px]' : 'text-[13px]';
  const paddingClass = indent ? 'px-3'        : 'px-3';

  return (
    <button
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={`flex items-center ${collapsed ? 'justify-center w-full' : 'w-[calc(100%-8px)] mx-1'} ${paddingClass} py-1.5 ${heightClass} transition-all duration-150 ${activeClass}`}
    >
      <span className={`material-symbols-outlined ${iconSize} shrink-0 ${collapsed ? '' : 'mr-2.5'}`}>
        {item.icon}
      </span>
      {!collapsed && (
        <>
          <span className={`${labelSize} font-medium flex-1 text-left truncate`}>{item.label}</span>
          {item.isNew && (
            <span className="ml-auto bg-secondary-container text-secondary text-[9px] font-bold px-1.5 py-0.5 rounded-full">
              NEW
            </span>
          )}
          {badge > 0 && (
            <span className="ml-auto bg-tertiary/20 text-tertiary rounded-full text-[11px] px-1.5 py-0.5 font-bold leading-none">
              {badge}
            </span>
          )}
        </>
      )}
      {collapsed && badge > 0 && (
        <span className="absolute right-2 top-1 w-1.5 h-1.5 rounded-full bg-tertiary" />
      )}
    </button>
  );
}

// ─────────────────────────────────────────────
// GROUP BUTTON
// ─────────────────────────────────────────────

interface GroupButtonProps {
  group: NavGroup;
  isActive: boolean;
  isExpanded: boolean;
  collapsed: boolean;
  onToggle: () => void;
}

function GroupButton({ group, isActive, isExpanded, collapsed, onToggle }: GroupButtonProps) {
  const activeClass = isActive
    ? 'bg-primary-container/20 text-primary font-semibold rounded-lg'
    : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface rounded-lg';

  return (
    <button
      onClick={onToggle}
      title={collapsed ? group.label : undefined}
      className={`flex items-center ${collapsed ? 'justify-center w-full' : 'w-[calc(100%-8px)] mx-1'} px-3 py-1.5 h-8 transition-all duration-150 ${activeClass}`}
    >
      <span className={`material-symbols-outlined text-[18px] shrink-0 ${collapsed ? '' : 'mr-2.5'}`}>
        {group.icon}
      </span>
      {!collapsed && (
        <>
          <span className="text-[13px] font-medium flex-1 text-left truncate">{group.label}</span>
          <span
            className="material-symbols-outlined text-[14px] text-on-surface-variant transition-transform duration-200"
            style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            expand_more
          </span>
        </>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────

export function Sidebar() {
  const {
    currentView,
    setView,
    sidebarCollapsed,
    setSidebarCollapsed,
    sessions,
    campaigns,
  } = useStore();

  const scrapingCount    = sessions.filter((s) => s.scrapingStatus === 'scraping').length;
  const runningCampaigns = campaigns.filter((c) => c.status === 'running').length;

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => ({
    inbox: MANAGEMENT_NAV.some(
      (item) => item.kind === 'group' && item.groupKey === 'inbox' && isGroupExpanded(item, currentView)
    ),
    tools: MANAGEMENT_NAV.some(
      (item) => item.kind === 'group' && item.groupKey === 'tools' && isGroupExpanded(item, currentView)
    ),
  }));

  // Flyout state — which group's flyout is open and where
  const [flyout, setFlyout] = useState<{ groupKey: string; topOffset: number } | null>(null);

  // Refs to measure group button position for flyout placement
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [mounted, setMounted] = useState(false);
  const collapsed = mounted ? sidebarCollapsed : false;

  useEffect(() => { setMounted(true); }, []);

  // Close flyout when sidebar expands
  useEffect(() => {
    if (!sidebarCollapsed) setFlyout(null);
  }, [sidebarCollapsed]);

  function handleToggleCollapse() {
    setSidebarCollapsed(!sidebarCollapsed);
  }

  function handleToggleGroup(groupKey: string) {
    // Collapsed mode: toggle flyout instead of expanding sidebar
    if (sidebarCollapsed) {
      if (flyout?.groupKey === groupKey) {
        setFlyout(null);
      } else {
        const el = groupRefs.current[groupKey];
        const top = el ? el.getBoundingClientRect().top : 100;
        setFlyout({ groupKey, topOffset: top });
      }
      return;
    }
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
  }

  function handleGroupHover(groupKey: string) {
    if (sidebarCollapsed) {
      // In collapsed mode: show flyout on hover
      const el = groupRefs.current[groupKey];
      const top = el ? el.getBoundingClientRect().top : 100;
      setFlyout({ groupKey, topOffset: top });
    } else {
      // In expanded mode: open the group inline
      setExpandedGroups((prev) => ({ ...prev, [groupKey]: true }));
    }
  }

  function handleGroupLeave(groupKey: string, isActive: boolean) {
    if (!sidebarCollapsed && !isActive) {
      // In expanded mode: close only if no child is active
      setExpandedGroups((prev) => ({ ...prev, [groupKey]: false }));
    }
    // In collapsed mode: flyout stays open until user moves to flyout or away
  }

  // Find the group object for the active flyout
  const flyoutGroup = flyout
    ? (MANAGEMENT_NAV.find(
        (item): item is NavGroup =>
          item.kind === 'group' && item.groupKey === flyout.groupKey
      ) ?? null)
    : null;

  return (
    <>
      <nav
        className={`
          bg-surface h-screen fixed left-0 top-0
          border-r border-outline-variant flex flex-col z-40
          transition-all duration-300 ease-in-out
          ${collapsed ? 'w-[52px]' : 'w-[240px]'}
        `}
      >
        {/* ── Logo ──────────────────────────────────────────────── */}
        <div className="h-[48px] px-3 flex items-center gap-2.5 border-b border-outline-variant shrink-0">
          <div className="bg-primary rounded-lg p-1.5 shrink-0">
            <span
              className="material-symbols-outlined text-[16px] text-on-primary"
              style={{ fontVariationSettings: "'FILL' 1" }}
            >
              dataset
            </span>
          </div>
          {!collapsed && (
            <div className="overflow-hidden min-w-0">
              <div className="text-[14px] font-bold text-primary leading-tight truncate">Flogination</div>
              <div className="text-[9px] font-semibold text-on-surface-variant tracking-widest uppercase truncate leading-tight">
                Session Manager
              </div>
            </div>
          )}
        </div>

        {/* ── Scrollable nav body ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto scrollbar-hide flex flex-col py-3 px-0 gap-0">

          {/* MANAGEMENT label */}
          {!collapsed && (
            <span className="px-4 text-[10px] font-semibold text-outline/70 uppercase tracking-widest mb-1">
              Management
            </span>
          )}

          {/* MANAGEMENT items */}
          <div className="flex flex-col gap-0.5 mb-2">
            {MANAGEMENT_NAV.map((item) => {
              if (item.kind === 'leaf') {
                return (
                  <LeafButton
                    key={item.view}
                    item={item}
                    isActive={isItemActive(item, currentView)}
                    collapsed={collapsed}
                    scrapingCount={scrapingCount}
                    runningCampaigns={runningCampaigns}
                    onClick={() => setView(item.view)}
                  />
                );
              }

              const active   = isItemActive(item, currentView);
              const expanded = expandedGroups[item.groupKey] ?? false;

              return (
                <div
                  key={item.groupKey}
                  ref={(el) => { groupRefs.current[item.groupKey] = el; }}
                  onMouseEnter={() => handleGroupHover(item.groupKey)}
                  onMouseLeave={() => handleGroupLeave(item.groupKey, active)}
                >
                  <GroupButton
                    group={item}
                    isActive={active}
                    isExpanded={expanded || (collapsed && flyout?.groupKey === item.groupKey)}
                    collapsed={collapsed}
                    onToggle={() => handleToggleGroup(item.groupKey)}
                  />
                  {/* Inline expand — only in non-collapsed mode */}
                  {expanded && !collapsed && (
                    <div className="ml-4 border-l border-outline-variant">
                      {item.children.map((child) => (
                        <LeafButton
                          key={child.view}
                          item={child}
                          isActive={child.view === currentView}
                          collapsed={false}
                          scrapingCount={scrapingCount}
                          runningCampaigns={runningCampaigns}
                          onClick={() => setView(child.view)}
                          indent
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Divider */}
          <div className={`${collapsed ? 'mx-2' : 'mx-3'} border-t border-outline-variant opacity-50 my-1`} />

          {/* OPERATIONS label */}
          {!collapsed && (
            <span className="px-4 text-[10px] font-semibold text-outline/70 uppercase tracking-widest mt-2 mb-1">
              Operations
            </span>
          )}

          {/* OPERATIONS items */}
          <div className="flex flex-col gap-0.5">
            {OPERATIONS_NAV.map((item) => (
              <LeafButton
                key={item.view}
                item={item}
                isActive={isItemActive(item, currentView)}
                collapsed={collapsed}
                scrapingCount={scrapingCount}
                runningCampaigns={runningCampaigns}
                onClick={() => setView(item.view)}
              />
            ))}
          </div>
        </div>

        {/* ── Collapse Toggle ────────────────────────────────────── */}
        <div className="px-3 py-2 border-t border-outline-variant flex items-center justify-between">
          {!collapsed && (
            <span className="text-[12px] text-on-surface-variant">Collapse</span>
          )}
          <button
            onClick={handleToggleCollapse}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-7 h-7 flex items-center justify-center rounded text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">
              {collapsed ? 'keyboard_double_arrow_right' : 'keyboard_double_arrow_left'}
            </span>
          </button>
        </div>
      </nav>

      {/* ── Flyout panel — rendered outside nav to avoid clipping ── */}
      {collapsed && flyoutGroup && flyout && (
        <FlyoutPanel
          group={flyoutGroup}
          currentView={currentView}
          topOffset={flyout.topOffset}
          onNavigate={(view) => setView(view)}
          onClose={() => setFlyout(null)}
        />
      )}
    </>
  );
}
