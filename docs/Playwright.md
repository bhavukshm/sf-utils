## Tasks
1. Sometimes playwright won't be able to parse the shadow elements, for that write a script that will create a shadow path for the element.

# Playwright Reference Guide (Salesforce Testing)

A quick-reference setup guide for using Playwright to automate repetitive UI testing.

---

## 1. Setting Up a Project

### Quickest way — guided setup
```bash
npm init playwright@latest
```
Scaffolds a complete project: installs `@playwright/test`, downloads browser binaries (Chromium, Firefox, WebKit), and creates example tests + a config file.

During setup it will ask you a few questions:
- **TypeScript or JavaScript** — pick whichever you're comfortable with (JS is fine to start).
- **Tests folder name** — default `tests` is fine.
- **Add a GitHub Actions workflow?** — say No if you're just running locally.
- **Install Playwright browsers now?** — say Yes.

### Manual setup (if you want more control)
```bash
npm init -y
```
Creates a basic `package.json` for the project.

```bash
npm install -D @playwright/test
```
Installs Playwright's test runner as a dev dependency.

```bash
npx playwright install
```
Downloads the actual browser binaries (Chromium, Firefox, WebKit) that Playwright drives.

---

## 2. Config File (`playwright.config.js`)

This file controls how your tests run by default.

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',        // where your test files live
  timeout: 30000,             // max time (ms) a single test can run before failing
  retries: 0,                 // how many times to retry a failed test

  use: {
    headless: false,          // false = browser window is visible while running
    viewport: { width: 1280, height: 720 },
    baseURL: 'https://yourorg.my.salesforce.com', // lets you use relative URLs in tests
    trace: 'on-first-retry',  // captures a debuggable trace when a test fails and retries
    launchOptions: {
      slowMo: 500,            // adds a 500ms pause between each action (easier to watch/follow)
    },
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
  ],
});
```

**Key settings to know:**
| Setting | Purpose |
|---|---|
| `headless` | `true` = runs invisibly (fast, good for CI). `false` = opens a real browser window so you can watch it. |
| `slowMo` | Delays every action by X ms. Useful when `headless: false` and things move too fast to follow. |
| `viewport` | Sets the browser window size — useful if a Salesforce layout behaves differently at certain widths. |
| `trace` | Records a step-by-step trace (DOM snapshots + network) you can replay later with the trace viewer. |
| `projects` | Defines which browsers to run against. Remove entries you don't need. |

---

## 3. Useful Commands While Testing

### Running tests
```bash
npx playwright test
```
Runs all tests headlessly, using whatever `playwright.config.js` says.

```bash
npx playwright test --headed
```
Forces a visible browser window for this run, regardless of config.

```bash
npx playwright test --ui
```
Opens **UI Mode** — an interactive panel showing each test step, DOM snapshots, and lets you time-travel through a run. Best option for actually watching what happened during a test.

### Choosing which browser(s) to run
```bash
npx playwright test --project=chromium
```
Runs only on the browser named `chromium` in your config (single browser).

```bash
npx playwright test --project=chromium --project=webkit
```
Runs on multiple named browsers in one command (repeat the flag).

Leaving `--project` off runs against **every** project listed in your config.

### Recording actions (turns your clicks into code)
```bash
npx playwright codegen https://yourorg.my.salesforce.com
```
Opens a browser + an Inspector window side by side. Every click/type you do gets turned into Playwright code you can copy into a test file.

### Debugging / pausing mid-test
```bash
npx playwright test --debug
```
Opens the Playwright Inspector and pauses at the very start of the test, letting you step through action-by-action.

**Pause at a specific point in your script** (most useful for checking "did this record actually get created/updated"):
```js
await page.pause();
```
Drop this line anywhere in your test. Execution freezes right there, opens the Inspector, and you can manually inspect the page/record state. Click **Resume** in the Inspector to continue.

**Add a fixed wait (e.g. wait 3 seconds):**
```js
await page.waitForTimeout(3000);
```
Pauses execution for 3000ms. Handy for visually confirming something (like a toast or animation), but prefer explicit waits below for anything that affects test reliability.

**Better than a fixed wait — wait for an actual condition:**
```js
await page.waitForSelector('.toastMessage');
// or
await expect(page.locator('.slds-notify')).toBeVisible();
```
These auto-retry until the condition is true (or timeout), so they're more reliable than guessing a delay.

### Viewing results
```bash
npx playwright show-report
```
Opens the HTML report from your last test run.

```bash
npx playwright show-trace trace.zip
```
Opens the trace viewer for a specific saved trace — lets you scrub through every action, screenshot, and network call from that run.

---

## 4. Reusing an Existing Login Session

There are three ways to avoid re-logging in every time, depending on what you need.

### Option A — Save & reuse session (recommended for most cases)
Record a session once and save the login state to a file:
```bash
npx playwright codegen --save-storage=auth.json https://yourorg.my.salesforce.com
```
Log in manually in the window that opens. When you close it, your cookies + localStorage are saved to `auth.json`.

Then reference that file in your config or test:
```js
use: {
  storageState: 'auth.json',
}
```
Every test that uses this config now starts **already logged in** — no login steps needed in the test itself.

> Session files can expire (Salesforce session timeout settings apply), so you may need to re-run the `codegen --save-storage` step occasionally.

### Option B — Persistent browser profile (keeps a real Chrome profile across runs)
```js
const { chromium } = require('playwright');

const context = await chromium.launchPersistentContext('./user-data-dir', {
  headless: false,
});
const page = await context.newPage();
```
This uses an actual folder on disk as a Chrome user profile. Cookies and session data persist across script runs, just like a normal browser profile you keep reopening.

### Option C — Attach to a browser window that's already open (CDP)
Start Chrome manually with remote debugging enabled, then log in to Salesforce normally in that window:
```bash
chrome.exe --remote-debugging-port=9222
```

Then connect Playwright to that *same* running browser instance instead of launching a new one:
```js
const { chromium } = require('playwright');

const browser = await chromium.connectOverCDP('http://localhost:9222');
const context = browser.contexts()[0];
const page = context.pages()[0];

// page is now the tab you already had open and logged into
```
No new browser is launched — Playwright literally attaches to the window you already have open, session and all.

