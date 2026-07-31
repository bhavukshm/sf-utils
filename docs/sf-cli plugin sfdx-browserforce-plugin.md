# SF CLI Plugin: sfdx-browserforce-plugin

## 1. Header & Overview

- **Category:** Org Configuration Automation (UI-Layer Settings)
- **Primary Purpose:** Automates Salesforce Setup UI configuration screens that have **no Metadata API or Tooling API exposure at all** — settings Salesforce genuinely never gave developers a metadata type for. Standard `sf project deploy start` can only move metadata that Salesforce chose to expose through the Metadata API; a meaningful slice of org configuration (auth provider wiring, several security/session settings, certificate & key management import, CPQ calculation-service config, Slack integration setup, and more) can _only_ be set by a human clicking through Setup. `sfdx-browserforce-plugin` closes that gap by driving a real browser through those screens on your behalf, from a version-controlled config file.
- **Installation Command:**
    ```bash
    sf plugins install sfdx-browserforce-plugin
    ```
    Unsigned third-party plugin — expect and accept the CLI's authenticity-warning prompt.

---

## 2. Deep Dive: What It Does & Key Capabilities

**The underlying mechanic — Playwright, not the Metadata API.** (Older write-ups describe this plugin as Puppeteer-based; the current release drives **Playwright** against a Chromium/Chrome binary.) The plugin authenticates into the target org using your existing `sf`/`sfdx` auth session — no separate interactive browser login required — then navigates the actual Setup UI pages, filling in fields and clicking through save flows exactly as a human admin would, driven by a declarative JSON settings file instead of manual clicks.

**Supported setting categories** (validated against the plugin's own JSON Schema) span a wide surface: `companyInformation`, `authProviders`, `userAccessPolicies`, `salesforceCpqConfig`, `opportunitySplits`, `relateContactToMultipleAccounts`, `highVelocitySalesSettings`, `recordTypes`, `picklists`, `emailDeliverability`, `lightningExperienceSettings`, `listViewCustomButtons`, `activitySettings`, `customerPortal`, `densitySettings`, `historyTracking`, `homePageLayouts`, `omniChannelSettings`, `permissionSets`, `salesforceToSalesforce`, `security` (including certificate/key management and auth configuration), `serviceChannels`, and `slack`.

**Why it's necessary despite the obvious fragility of UI automation:** the alternative is a human manually re-clicking through dozens of Setup screens every time a new sandbox or scratch org is provisioned — slow, inconsistent between environments, and impossible to code-review or diff. Encoding those settings as JSON makes org configuration reproducible and auditable the same way `force-app/` source makes metadata reproducible, even though the underlying transport (browser automation) is inherently more brittle than an API call. This tradeoff is explicit and load-bearing: because Playwright is clicking real DOM elements, a Salesforce Setup UI redesign can and does break the plugin until a patch release catches up (recent maintainer fixes include handling Salesforce's "scheduled maintenance" interstitial page and a broken CPQ calculation-service selector) — this is not a "set and forget" tool the way a pure Metadata API plugin is.

---

## 3. Practical Usage Scenarios & Commands

**`browserforce.json` — the settings file** (validated against the plugin's published schema):

```json
{
    "$schema": "https://raw.githubusercontent.com/amtrack/sfdx-browserforce-plugin/main/src/plugins/schema.json",
    "settings": {
        "companyInformation": {
            "defaultCurrencyIsoCode": "English (South Africa) - ZAR"
        },
        "emailDeliverability": {
            "accessLevel": "AllEmail"
        }
    }
}
```

- `$schema` — points editors (VS Code, etc.) at the JSON Schema for autocomplete/validation while authoring the file.
- `settings` — a single object whose keys are the setting-category names listed in §2; only include the categories you actually want this run to touch.

**Command 1 — One-time browser binary setup (prerequisite, run once per machine/CI image):**

```bash
sf browserforce playwright -- install chromium
```

The plugin passes through to the underlying Playwright CLI to download a matching Chromium build — Playwright does not bundle a browser by default. Alternatively, point at an already-installed Chrome via the `BROWSERFORCE_BROWSER_EXECUTABLE_PATH` or `CHROME_BIN` environment variable to skip this download entirely (useful in CI images that already ship Chrome).

**Command 2 — Basic apply to a target org:**

```bash
sf browserforce apply --definitionfile browserforce.json --target-org my-scratch-org
```

`apply` (`-f`/`--definitionfile`, `-o`/`--target-org`) reads the settings file and drives the browser through every listed category against the specified org.

**Command 3 — Dry-run to preview changes before applying (`--dry-run`):**

```bash
sf browserforce apply -f browserforce.json -o my-sandbox --dry-run
```

`-d/--dry-run` reports what _would_ change without actually submitting any Setup form — the safest way to validate a new/edited `browserforce.json` against an unfamiliar org before committing to it.

**Command 4 — Debugging a failing automation (non-headless, slowed down):**

```bash
sf browserforce apply -f browserforce.json -o my-sandbox --no-headless --slow-mo 250 --trace
```

- `--no-headless` — pops an actual visible browser window so you can watch what the automation is doing, instead of running invisibly.
- `--slow-mo <ms>` — inserts an artificial delay (in milliseconds) between every browser action, making a fast automated flow observable to a human eye; invaluable when a selector fails and you need to see exactly which screen/state it broke on.
- `--trace` — records a full Playwright trace file for post-mortem debugging of a failed run.

**Command 5 — CI/automation invocation with retry tuning:**

```bash
sf browserforce apply -f browserforce.json -o "$TARGET_ORG" \
  --headless --timeout 120000 --max-retries 8 --retry-timeout 5000 --json
```

- `--timeout <ms>` (default `90000`) — raised here to `120000` for a slower CI network path.
- `--max-retries <n>` (default `6`) / `--retry-timeout <ms>` (default `4000`) — Setup pages can be slow to render under CI load; these tune how aggressively the plugin retries a selector/navigation before failing outright, trading run time for resilience.
- `--json` — standard `sf` machine-readable output for the calling pipeline to inspect.

---

## 4. Developer Workflow Integration

- **When to run it:** almost always a **post-scratch-org / post-sandbox-refresh provisioning step**, immediately after metadata deploy — analogous to how `sfdmu` seeds data, `browserforce` seeds the org-level settings that metadata deploy can't touch. It is not something you run per-commit or on every deploy; it's an environment-bootstrap tool.
    ```bash
    sf org create scratch -f config/project-scratch-def.json -a my-scratch-org
    sf project deploy start --target-org my-scratch-org
    sf browserforce apply -f config/browserforce.json -o my-scratch-org
    ```
- **Keep `browserforce.json` in version control alongside your scratch-org definition** — treat it as part of the org's "definition of done" for provisioning, reviewed in PRs the same way a `project-scratch-def.json` change would be.
- **Flags/behavior to be careful with:**
    - **Expect occasional breakage after a Salesforce Setup UI change.** Because this plugin depends on DOM structure, not an API contract, a Salesforce release can silently break a specific settings category until the maintainers ship a fix — pin a known-good plugin version in CI rather than always pulling `latest`, and re-validate after major Salesforce release windows (Spring/Summer/Winter).
    - **Headless CI environments need a real browser dependency chain.** If `sf browserforce playwright -- install chromium` isn't run (or an equivalent Chrome isn't pointed to via env var) as part of image setup, every `apply` invocation fails before it even reaches the org.
    - **`--dry-run` first, always, on a config you haven't run against that specific org before** — some settings categories (certificate/key import, auth provider wiring) are awkward or destructive to reverse by hand if applied incorrectly.
    - **This plugin authenticates using your existing `sf` org auth session** (via `--target-org`), so standard `sf org login web`/JWT auth setup must already be in place for the target — there's no separate browserforce-specific login flow to configure.
