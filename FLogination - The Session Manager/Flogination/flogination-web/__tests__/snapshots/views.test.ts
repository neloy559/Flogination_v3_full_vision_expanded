/**
 * View-Level Render Tests — Module Import and Export Verification
 *
 * For each redesigned view, verifies that:
 *   1. The component module can be imported without errors
 *   2. The module exports the expected named function
 *   3. The exported value is a function (callable React component)
 *
 * Since @testing-library/react is not available, these tests validate
 * the module contract (importability + export shape) rather than DOM rendering.
 * They serve as a regression baseline ensuring no view is accidentally broken
 * by a missing export or a module-level error.
 *
 * Satisfies: Requirement 16.1
 */

// ─── Dashboard ────────────────────────────────────────────────────────────────

describe('Dashboard — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/Dashboard')).not.toThrow();
  });

  test('exports a named function "Dashboard"', () => {
    const mod = require('../../app/components/views/Dashboard');
    expect(typeof mod.Dashboard).toBe('function');
  });

  test('Dashboard export is named (not default)', () => {
    const mod = require('../../app/components/views/Dashboard');
    expect(mod.Dashboard).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── AccountsView ─────────────────────────────────────────────────────────────

describe('AccountsView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/AccountsView')).not.toThrow();
  });

  test('exports a named function "AccountsView"', () => {
    const mod = require('../../app/components/views/AccountsView');
    expect(typeof mod.AccountsView).toBe('function');
  });

  test('AccountsView export is named (not default)', () => {
    const mod = require('../../app/components/views/AccountsView');
    expect(mod.AccountsView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── InboxView ────────────────────────────────────────────────────────────────

describe('InboxView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/InboxView')).not.toThrow();
  });

  test('exports a named function "InboxView"', () => {
    const mod = require('../../app/components/views/InboxView');
    expect(typeof mod.InboxView).toBe('function');
  });

  test('InboxView export is named (not default)', () => {
    const mod = require('../../app/components/views/InboxView');
    expect(mod.InboxView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── CampaignsView ────────────────────────────────────────────────────────────

describe('CampaignsView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/CampaignsView')).not.toThrow();
  });

  test('exports a named function "CampaignsView"', () => {
    const mod = require('../../app/components/views/CampaignsView');
    expect(typeof mod.CampaignsView).toBe('function');
  });

  test('CampaignsView export is named (not default)', () => {
    const mod = require('../../app/components/views/CampaignsView');
    expect(mod.CampaignsView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── ProxiesView ──────────────────────────────────────────────────────────────

describe('ProxiesView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/ProxiesView')).not.toThrow();
  });

  test('exports a named function "ProxiesView"', () => {
    const mod = require('../../app/components/views/ProxiesView');
    expect(typeof mod.ProxiesView).toBe('function');
  });

  test('ProxiesView export is named (not default)', () => {
    const mod = require('../../app/components/views/ProxiesView');
    expect(mod.ProxiesView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── SettingsView ─────────────────────────────────────────────────────────────

describe('SettingsView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/SettingsView')).not.toThrow();
  });

  test('exports a named function "SettingsView"', () => {
    const mod = require('../../app/components/views/SettingsView');
    expect(typeof mod.SettingsView).toBe('function');
  });

  test('SettingsView export is named (not default)', () => {
    const mod = require('../../app/components/views/SettingsView');
    expect(mod.SettingsView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── GroupHunterView ──────────────────────────────────────────────────────────

describe('GroupHunterView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/tools/GroupHunterView')).not.toThrow();
  });

  test('exports a named function "GroupHunterView"', () => {
    const mod = require('../../app/components/views/tools/GroupHunterView');
    expect(typeof mod.GroupHunterView).toBe('function');
  });

  test('GroupHunterView export is named (not default)', () => {
    const mod = require('../../app/components/views/tools/GroupHunterView');
    expect(mod.GroupHunterView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── PageFactoryView ──────────────────────────────────────────────────────────

describe('PageFactoryView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/tools/PageFactoryView')).not.toThrow();
  });

  test('exports a named function "PageFactoryView"', () => {
    const mod = require('../../app/components/views/tools/PageFactoryView');
    expect(typeof mod.PageFactoryView).toBe('function');
  });

  test('PageFactoryView export is named (not default)', () => {
    const mod = require('../../app/components/views/tools/PageFactoryView');
    expect(mod.PageFactoryView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── BMFactoryView ────────────────────────────────────────────────────────────

describe('BMFactoryView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/tools/BMFactoryView')).not.toThrow();
  });

  test('exports a named function "BMFactoryView"', () => {
    const mod = require('../../app/components/views/tools/BMFactoryView');
    expect(typeof mod.BMFactoryView).toBe('function');
  });

  test('BMFactoryView export is named (not default)', () => {
    const mod = require('../../app/components/views/tools/BMFactoryView');
    expect(mod.BMFactoryView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── CommentMarketingView ─────────────────────────────────────────────────────

describe('CommentMarketingView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/tools/CommentMarketingView')).not.toThrow();
  });

  test('exports a named function "CommentMarketingView"', () => {
    const mod = require('../../app/components/views/tools/CommentMarketingView');
    expect(typeof mod.CommentMarketingView).toBe('function');
  });

  test('CommentMarketingView export is named (not default)', () => {
    const mod = require('../../app/components/views/tools/CommentMarketingView');
    expect(mod.CommentMarketingView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── ContentAmplifierView ─────────────────────────────────────────────────────

describe('ContentAmplifierView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/tools/ContentAmplifierView')).not.toThrow();
  });

  test('exports a named function "ContentAmplifierView"', () => {
    const mod = require('../../app/components/views/tools/ContentAmplifierView');
    expect(typeof mod.ContentAmplifierView).toBe('function');
  });

  test('ContentAmplifierView export is named (not default)', () => {
    const mod = require('../../app/components/views/tools/ContentAmplifierView');
    expect(mod.ContentAmplifierView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});

// ─── FunnelBuilderView ────────────────────────────────────────────────────────

describe('FunnelBuilderView — module import and export', () => {
  test('can be imported without errors', () => {
    expect(() => require('../../app/components/views/tools/FunnelBuilderView')).not.toThrow();
  });

  test('exports a named function "FunnelBuilderView"', () => {
    const mod = require('../../app/components/views/tools/FunnelBuilderView');
    expect(typeof mod.FunnelBuilderView).toBe('function');
  });

  test('FunnelBuilderView export is named (not default)', () => {
    const mod = require('../../app/components/views/tools/FunnelBuilderView');
    expect(mod.FunnelBuilderView).toBeDefined();
    expect(mod.default).toBeUndefined();
  });
});
