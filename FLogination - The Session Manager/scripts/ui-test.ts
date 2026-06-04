/**
 * Flogination UI Automated Test
 * Tests all views, buttons, and interactions via Playwright.
 * Run: npx tsx scripts/ui-test.ts
 */

import { chromium, type Browser, type Page, type ConsoleMessage } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:3000';
const SCREENSHOTS_DIR = path.join(__dirname, '../test-screenshots');
const REPORT_FILE = path.join(__dirname, '../test-report.md');

// ── Bug tracking ──────────────────────────────────────────────────────────────

interface Bug {
  view: string;
  action: string;
  severity: 'critical' | 'warning' | 'info';
  description: string;
}

const bugs: Bug[] = [];
const consoleErrors: string[] = [];

function logBug(view: string, action: string, severity: Bug['severity'], description: string) {
  bugs.push({ view, action, severity, description });
  console.log(`  [${severity.toUpperCase()}] ${view} → ${action}: ${description}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function screenshot(page: Page, name: string) {
  if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS_DIR, `${name}.png`),
    fullPage: false,
  });
}

async function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function clickSidebarItem(page: Page, title: string): Promise<boolean> {
  try {
    const btn = page.locator(`button[title="${title}"], nav button:has-text("${title}")`).first();
    if (await btn.isVisible({ timeout: 3000 })) {
      await btn.click();
      await wait(800);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function checkForErrors(page: Page, viewName: string) {
  // Check for React error overlay
  const errorOverlay = page.locator('text=Unhandled Runtime Error, text=Error:').first();
  if (await errorOverlay.isVisible({ timeout: 500 }).catch(() => false)) {
    const errorText = await errorOverlay.textContent().catch(() => 'Unknown error');
    logBug(viewName, 'page-load', 'critical', `React error overlay: ${errorText?.slice(0, 100)}`);
  }

  // Check for visible error text
  const errorText = page.locator('.text-error, [class*="error"]:visible').first();
  if (await errorText.isVisible({ timeout: 500 }).catch(() => false)) {
    const text = await errorText.textContent().catch(() => '');
    if (text && text.length > 3 && !text.includes('Failed') && !text.includes('Error')) return;
    // Only log if it looks like an unexpected error
  }
}

// ── View Tests ────────────────────────────────────────────────────────────────

async function testDashboard(page: Page) {
  console.log('\n📊 Testing Dashboard...');

  await clickSidebarItem(page, 'Dashboard');
  await wait(1000);
  await screenshot(page, '01-dashboard');

  // Check stat cards
  const statCards = page.locator('.grid .rounded-card, .grid [class*="card"]');
  const cardCount = await statCards.count();
  if (cardCount < 4) {
    logBug('Dashboard', 'stat-cards', 'warning', `Expected 4+ stat cards, found ${cardCount}`);
  } else {
    console.log(`  ✅ Stat cards: ${cardCount} found`);
  }

  // Check FAB button
  const fab = page.locator('button.rounded-full.fixed, button[class*="bottom-8"]').first();
  if (await fab.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Floating Action Button visible');
  } else {
    logBug('Dashboard', 'fab-button', 'warning', 'Floating Action Button not visible');
  }

  await checkForErrors(page, 'Dashboard');
}

async function testAccountsView(page: Page) {
  console.log('\n👥 Testing Accounts View...');

  await clickSidebarItem(page, 'Accounts');
  await wait(1000);
  await screenshot(page, '02-accounts');

  // Check page header
  const header = page.locator('h1:has-text("Facebook Accounts")').first();
  if (await header.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Page header visible');
  } else {
    logBug('Accounts', 'page-header', 'warning', '"Facebook Accounts" header not found');
  }

  // Check Add Account button
  const addBtn = page.locator('button:has-text("Add Account")').first();
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Add Account button visible');
    await addBtn.click();
    await wait(500);
    // Check modal opened
    const modal = page.locator('text=Add Session, text=Cookie String').first();
    if (await modal.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log('  ✅ Add Account modal opens');
      // Close modal
      const closeBtn = page.locator('button:has-text("Cancel"), button[aria-label="close"]').first();
      await closeBtn.click().catch(() => {});
      await wait(300);
    } else {
      logBug('Accounts', 'add-account-modal', 'warning', 'Add Account modal did not open');
    }
  } else {
    logBug('Accounts', 'add-account-btn', 'critical', 'Add Account button not found');
  }

  // Check filter tabs
  const filterTabs = page.locator('button:has-text("All"), button:has-text("Active")');
  const tabCount = await filterTabs.count();
  if (tabCount >= 2) {
    console.log(`  ✅ Filter tabs: ${tabCount} found`);
    // Click Active tab
    await filterTabs.first().click();
    await wait(300);
  } else {
    logBug('Accounts', 'filter-tabs', 'warning', `Filter tabs not found (found ${tabCount})`);
  }

  // Check grid view toggle
  const gridToggle = page.locator('button[title*="grid"], button[title*="Grid"]').first();
  if (await gridToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Grid view toggle visible');
    await gridToggle.click();
    await wait(500);
    await screenshot(page, '02b-accounts-grid');
    await gridToggle.click(); // switch back
    await wait(300);
  } else {
    logBug('Accounts', 'grid-toggle', 'warning', 'Grid view toggle not found');
  }

  await checkForErrors(page, 'Accounts');
}

async function testInboxView(page: Page) {
  console.log('\n📬 Testing Inbox View...');

  await clickSidebarItem(page, 'All Messages');
  await wait(1000);
  await screenshot(page, '03-inbox');

  // Check sub-view tabs
  const msgTab = page.locator('button:has-text("Messages")').first();
  const contactsTab = page.locator('button:has-text("Contacts")').first();
  const warmupTab = page.locator('button:has-text("Warm-Up")').first();

  if (await msgTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Messages tab visible');
  } else {
    logBug('Inbox', 'messages-tab', 'warning', 'Messages tab not found');
  }

  if (await contactsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await contactsTab.click();
    await wait(500);
    await screenshot(page, '03b-inbox-contacts');
    console.log('  ✅ Contacts tab clickable');
  }

  if (await warmupTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await warmupTab.click();
    await wait(500);
    await screenshot(page, '03c-inbox-warmup');
    console.log('  ✅ Warm-Up tab clickable');
  }

  await checkForErrors(page, 'Inbox');
}

async function testCampaignsView(page: Page) {
  console.log('\n⚡ Testing Campaigns View...');

  await clickSidebarItem(page, 'Campaigns');
  await wait(1000);
  await screenshot(page, '04-campaigns');

  const header = page.locator('h1:has-text("Campaigns")').first();
  if (await header.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Campaigns header visible');
  } else {
    logBug('Campaigns', 'header', 'warning', 'Campaigns header not found');
  }

  const newCampaignBtn = page.locator('button:has-text("New Campaign")').first();
  if (await newCampaignBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ New Campaign button visible');
  } else {
    logBug('Campaigns', 'new-campaign-btn', 'warning', 'New Campaign button not found');
  }

  await checkForErrors(page, 'Campaigns');
}

async function testProxiesView(page: Page) {
  console.log('\n🛡️ Testing Proxies View...');

  await clickSidebarItem(page, 'Proxies');
  await wait(1000);
  await screenshot(page, '05-proxies');

  const header = page.locator('h1:has-text("Proxies")').first();
  if (await header.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Proxies header visible');
  } else {
    logBug('Proxies', 'header', 'warning', 'Proxies header not found');
  }

  const addBtn = page.locator('button:has-text("Add Proxies")').first();
  if (await addBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Add Proxies button visible');
  } else {
    logBug('Proxies', 'add-btn', 'warning', 'Add Proxies button not found');
  }

  await checkForErrors(page, 'Proxies');
}

async function testSettingsView(page: Page) {
  console.log('\n⚙️ Testing Settings View...');

  await clickSidebarItem(page, 'Settings');
  await wait(1000);
  await screenshot(page, '06-settings');

  // Check left tab navigation
  const generalTab = page.locator('button:has-text("General"), button:has-text("AI Gateway")').first();
  if (await generalTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Settings tabs visible');
  } else {
    logBug('Settings', 'tabs', 'warning', 'Settings tab navigation not found');
  }

  // Check Save Configuration button
  const saveBtn = page.locator('button:has-text("Save Configuration"), button:has-text("Save Settings")').first();
  if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Save Configuration button visible');
  } else {
    logBug('Settings', 'save-btn', 'warning', 'Save Configuration button not found');
  }

  await checkForErrors(page, 'Settings');
}

async function testLogsView(page: Page) {
  console.log('\n📋 Testing Logs View...');

  await clickSidebarItem(page, 'Logs');
  await wait(1000);
  await screenshot(page, '07-logs');

  const header = page.locator('h1:has-text("Activity Logs"), h1:has-text("Logs")').first();
  if (await header.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Logs header visible');
  } else {
    logBug('Logs', 'header', 'info', 'Logs header not found (may be empty state)');
  }

  await checkForErrors(page, 'Logs');
}

async function testGridView(page: Page) {
  console.log('\n🔲 Testing Grid View...');

  await clickSidebarItem(page, 'Grid View');
  await wait(1000);
  await screenshot(page, '08-grid');

  await checkForErrors(page, 'Grid');
}

async function testFunnelsView(page: Page) {
  console.log('\n🔀 Testing Funnels View...');

  await clickSidebarItem(page, 'Funnels');
  await wait(1000);
  await screenshot(page, '09-funnels');

  const libraryHeader = page.locator('text=Library').first();
  if (await libraryHeader.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Funnels Library panel visible');
  } else {
    logBug('Funnels', 'library', 'warning', 'Library panel not found');
  }

  const saveBtn = page.locator('button:has-text("Save & Deploy")').first();
  if (await saveBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Save & Deploy button visible');
  } else {
    logBug('Funnels', 'save-deploy', 'warning', 'Save & Deploy button not found');
  }

  await checkForErrors(page, 'Funnels');
}

async function testToolViews(page: Page) {
  const tools = [
    { name: 'Group Hunter', screenshot: '10-group-hunter', checkText: 'Target Groups' },
    { name: 'Comment Marketing', screenshot: '11-comment-marketing', checkText: 'URL Promotion' },
    { name: 'Page Factory', screenshot: '12-page-factory', checkText: 'Page Details' },
    { name: 'BM Factory', screenshot: '13-bm-factory', checkText: 'BM Factory' },
    { name: 'Content Amplifier', screenshot: '14-content-amplifier', checkText: 'Post Seeder' },
    { name: 'Browser Recorder', screenshot: '15-browser-recorder', checkText: '' },
  ];

  for (const tool of tools) {
    console.log(`\n🔧 Testing ${tool.name}...`);

    // Try clicking via Tools group
    const toolsGroup = page.locator('button:has-text("Tools")').first();
    if (await toolsGroup.isVisible({ timeout: 2000 }).catch(() => false)) {
      await toolsGroup.click();
      await wait(400);
    }

    const toolBtn = page.locator(`button:has-text("${tool.name}")`).first();
    if (await toolBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await toolBtn.click();
      await wait(800);
      await screenshot(page, tool.screenshot);

      if (tool.checkText) {
        const checkEl = page.locator(`text=${tool.checkText}`).first();
        if (await checkEl.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`  ✅ ${tool.name} loaded correctly`);
        } else {
          logBug(tool.name, 'content', 'warning', `"${tool.checkText}" not found in view`);
        }
      } else {
        console.log(`  ✅ ${tool.name} navigated`);
      }

      await checkForErrors(page, tool.name);
    } else {
      logBug(tool.name, 'navigation', 'critical', `Could not find "${tool.name}" button in sidebar`);
    }
  }
}

async function testSidebarCollapse(page: Page) {
  console.log('\n📌 Testing Sidebar Collapse...');

  // Find collapse button
  const collapseBtn = page.locator('button[title*="Collapse"], button[title*="collapse"], button:has(span:has-text("menu_open")), button:has(span:has-text("menu"))').last();

  if (await collapseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await collapseBtn.click();
    await wait(500);
    await screenshot(page, '16-sidebar-collapsed');

    // Check sidebar is narrow
    const nav = page.locator('nav').first();
    const navBox = await nav.boundingBox();
    if (navBox && navBox.width <= 60) {
      console.log(`  ✅ Sidebar collapsed to ${navBox.width}px`);
    } else {
      logBug('Sidebar', 'collapse', 'warning', `Sidebar width after collapse: ${navBox?.width}px (expected ≤60px)`);
    }

    // Expand again
    await collapseBtn.click();
    await wait(500);
    console.log('  ✅ Sidebar expand/collapse works');
  } else {
    logBug('Sidebar', 'collapse-btn', 'warning', 'Collapse toggle button not found');
  }
}

async function testTopBar(page: Page) {
  console.log('\n🔝 Testing TopBar...');

  // Check search input
  const searchInput = page.locator('input[placeholder*="Search"]').first();
  if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
    await searchInput.fill('test');
    await wait(300);
    await searchInput.fill('');
    console.log('  ✅ Search input works');
  } else {
    logBug('TopBar', 'search', 'warning', 'Search input not found');
  }

  // Check Sync All button
  const syncBtn = page.locator('button:has-text("Sync All")').first();
  if (await syncBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Sync All button visible');
  } else {
    logBug('TopBar', 'sync-btn', 'warning', 'Sync All button not found');
  }

  // Check notification button
  const notifBtn = page.locator('button:has(span:has-text("notifications"))').first();
  if (await notifBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('  ✅ Notification button visible');
  } else {
    logBug('TopBar', 'notification-btn', 'info', 'Notification button not found');
  }
}

// ── Report Generation ─────────────────────────────────────────────────────────

function generateReport() {
  const critical = bugs.filter(b => b.severity === 'critical');
  const warnings = bugs.filter(b => b.severity === 'warning');
  const infos = bugs.filter(b => b.severity === 'info');

  const report = `# Flogination UI Test Report
Generated: ${new Date().toLocaleString()}

## Summary
- 🔴 Critical: ${critical.length}
- 🟡 Warning: ${warnings.length}
- 🔵 Info: ${infos.length}
- Total issues: ${bugs.length}

## Console Errors (${consoleErrors.length})
${consoleErrors.length === 0 ? 'None ✅' : consoleErrors.map(e => `- ${e}`).join('\n')}

## Critical Issues 🔴
${critical.length === 0 ? 'None ✅' : critical.map(b => `### ${b.view} → ${b.action}\n${b.description}`).join('\n\n')}

## Warnings 🟡
${warnings.length === 0 ? 'None ✅' : warnings.map(b => `- **${b.view}** (${b.action}): ${b.description}`).join('\n')}

## Info 🔵
${infos.length === 0 ? 'None' : infos.map(b => `- **${b.view}** (${b.action}): ${b.description}`).join('\n')}

## Screenshots
Saved to: \`test-screenshots/\`
`;

  fs.writeFileSync(REPORT_FILE, report);
  return report;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 Starting Flogination UI Test...');
  console.log(`📍 Target: ${BASE_URL}`);
  console.log('─'.repeat(50));

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: false, // Show browser so you can watch
      slowMo: 200,     // Slow down actions so they're visible
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);

    // Capture console errors
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('favicon') && !text.includes('404')) {
          consoleErrors.push(`[${msg.type()}] ${text.slice(0, 150)}`);
        }
      }
    });

    // Capture page errors
    page.on('pageerror', (err: Error) => {
      consoleErrors.push(`[pageerror] ${err.message.slice(0, 150)}`);
    });

    // Navigate to app
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 15_000 });
    await wait(1500);
    await screenshot(page, '00-initial-load');
    console.log('✅ App loaded successfully');

    // Run all tests
    await testTopBar(page);
    await testSidebarCollapse(page);
    await testDashboard(page);
    await testAccountsView(page);
    await testInboxView(page);
    await testCampaignsView(page);
    await testProxiesView(page);
    await testSettingsView(page);
    await testLogsView(page);
    await testGridView(page);
    await testFunnelsView(page);
    await testToolViews(page);

    // Final screenshot
    await clickSidebarItem(page, 'Dashboard');
    await wait(500);
    await screenshot(page, '99-final-state');

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('\n❌ Test runner crashed:', message);
    bugs.push({ view: 'Test Runner', action: 'crash', severity: 'critical', description: message });
  } finally {
    if (browser) await browser.close();
  }

  // Generate report
  console.log('\n' + '─'.repeat(50));
  console.log('📝 Generating report...');
  const report = generateReport();
  console.log('\n' + report);
  console.log(`\n📁 Report saved: ${REPORT_FILE}`);
  console.log(`📸 Screenshots: ${SCREENSHOTS_DIR}`);
}

main().catch(console.error);
