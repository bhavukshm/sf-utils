# SF CLI Plugin: texei-sfdx-plugin

## 1. Header & Overview

- **Category:** DevOps Utility Grab-Bag (Profile Cleanup, Data Migration, Sharing Recalculation, CPQ/Org-Shape Tooling)
- **Primary Purpose:** A collection of small, independently useful commands built by the Salesforce consultancy Texei to plug specific, recurring gaps in the native `sf` CLI — most notably **Profile cleanup** (stripping the metadata nodes that duplicate what a Permission Set already covers, and generating "skinny" minimal-access profiles), **sharing-rule recalculation control**, and object **data export/import**. It is not a themed, single-purpose plugin like the others in this set — it's a toolbox, and its value is in knowing which specific command solves the specific gap you've hit.
- **Installation Command:**
    ```bash
    sf plugins install texei-sfdx-plugin
    ```
    Unsigned third-party plugin — expect the standard authenticity-warning prompt. Commands run under the `texei` topic: `sf texei <topic> <verb>`.

---

## 2. Deep Dive: What It Does & Key Capabilities

**The underlying mechanics vary by command family — this is several small tools sharing one install, not one mechanism:**

- **Profile cleanup (`sf texei profile clean`)** — parses Profile metadata XML and strips out node types you specify (e.g. `layoutAssignments`, `recordTypeVisibilities`) that are redundant once the equivalent access is granted via Permission Sets — directly supporting a "profiles for login/session settings only, Permission Sets for everything else" access-model migration, which the standard `sf` CLI has no built-in tooling to help execute.
- **Skinny profiles (`sf texei skinnyprofile check/create/retrieve`)** — audits, builds, and retrieves minimal-access profiles, addressing the common Salesforce anti-pattern of profiles ballooning to carry access that should live in Permission Sets.
- **Data export/import (`sf texei data export/import/plan generate`)** — a lighter-weight alternative to `sfdmu` for moving object records in/out of an org via CSV, including generating a Data Loader-style import plan.
- **Sharing recalculation control (`sf texei sharingcalc recalculate/suspend/resume`)** — directly manages sharing-rule recalculation jobs, useful when a bulk data operation would otherwise trigger an expensive, slow automatic recalculation mid-operation.
- **CPQ and Org Shape utilities (`sf texei cpqsettings set`, `sf texei org shape extract` [BETA])** — set Salesforce CPQ settings from a file, and extract an org's shape configuration.
- **Why reach for this instead of native `sf` commands:** none of the above have a native `sf` equivalent at all — there's no built-in command to strip redundant Profile nodes, no built-in sharing-recalculation suspend/resume control, and no built-in skinny-profile audit. This plugin exists entirely in the space the core CLI doesn't cover, rather than offering a "better" version of something `sf` already does.

---

## 3. Practical Usage Scenarios & Commands

**Command 1 — Strip redundant nodes from every Profile in the project (`profile clean`):**

```bash
sf texei profile clean -k layoutAssignments,recordTypeVisibilities
```

`-k/--keys` names which XML node types to strip from every profile in the source tree — run this after migrating the corresponding access onto Permission Sets, so the Profile metadata no longer carries duplicated, soon-to-be-stale grants.

**Command 2 — Update the current scratch-org user's fields:**

```bash
sf texei user update --target-org myScratchOrg --values "LanguageLocaleKey='fr'"
```

`--values` accepts a field=value list (SOQL-style value syntax) applied to the running user in the target org — a quick way to adjust the default scratch-org user's locale/language/timezone without a manual Setup trip after every org creation.

**Command 3 — Export object data to CSV:**

```bash
sf texei data export --objects Account,Contact,MyCustomObject__c --outputdir ./data --target-org my-source-org
```

`--objects` (comma-separated), `--outputdir`, and `--target-org` drive a straightforward CSV export — a lighter-weight option than standing up a full `sfdmu` `export.json` when you just need a flat dump of a handful of objects, with no cross-org relationship remapping required.

**Command 4 — Import that data into another org:**

```bash
sf texei data import --inputdir ./data --target-org my-target-org --allornone --ignoreerrors
```

`--allornone` controls batch atomicity (abort a batch on any record failure vs. allow partial success); `--ignoreerrors` continues past errors instead of stopping the whole import — tune these deliberately based on whether an incomplete-but-partial load is acceptable for your use case.

**Command 5 — Suspend sharing recalculation before a bulk data load, resume after:**

```bash
sf texei sharingcalc suspend --target-org my-org
# ... bulk data operation here ...
sf texei sharingcalc resume --target-org my-org
```

Wrapping a bulk insert/update in `suspend`/`resume` avoids the org triggering a full, expensive sharing-rule recalculation mid-load — then `sf texei sharingcalc recalculate --target-org my-org` can be run once, explicitly, after the load completes, instead of the org recalculating repeatedly and inefficiently during it.

**Command 6 — Extract Org Shape settings (BETA):**

```bash
sf texei org shape extract --target-org my-org --scope full
```

Captures the org's shape configuration — flagged BETA by the maintainers, so treat output as a useful reference/audit artifact rather than a guaranteed-stable contract to build automation on top of.

---

## 4. Developer Workflow Integration

- **When to trigger each command family:**
    - **`profile clean`** — as a one-time (or periodically re-run) cleanup step during/after a deliberate Profile→Permission Set access-model migration, not a routine per-deploy step; run it, review the diff carefully, then commit.
    - **`sharingcalc suspend`/`resume`** — bracketing any bulk data operation (a large `sfdmu`/`texei data import` run, a mass data-fix script) against an org with non-trivial sharing rules — this is a performance/reliability safeguard for that specific operation, not a standing configuration change.
    - **`data export`/`data import`** — ad hoc, whenever you need a quick CSV-based data move and don't need `sfdmu`'s cross-org relationship remapping; for anything involving multi-object lookup hierarchies, prefer `sfdmu` instead.
    - **`user update`** — routinely, right after `sf org create scratch`, as part of a scratch-org bootstrap script, alongside metadata deploy and data seeding.
- **No dedicated project-wide config file** — each command is self-contained and flag-driven; there's no `.texeirc` or equivalent to set up, unlike `sfdmu`'s `export.json` or the flow-scanner's `.flow-scanner.yml`.
- **Maintenance status — genuinely active, worth trusting in production:** the plugin has a steady release cadence (multiple releases a year, tracking Salesforce API/flag changes like the CLI-wide `-u` → `-o` org-flag migration) rather than being an abandoned artifact — a meaningfully different risk profile than an unmaintained community plugin, and worth checking before assuming any small utility plugin is safe to depend on long-term.
- **Known edge cases / flags to be careful with:**
    - **Verify the current command list before use — this plugin's surface has grown and shifted over time.** Some commands are explicitly marked `[DEPRECATED]` in the maintainers' own docs (e.g. `contractstatus value add`, `sharedactivities enable` — both superseded by native Metadata API support Salesforce added later) and several others are marked `[BETA]` (`org shape extract`, `picklist restrict`/`unrestrict`, `profile convert`, `profile empty`) — treat BETA-flagged commands as unstable-surface, not production-contract-stable.
    - **`profile clean` is destructive to the working tree** — always review the diff on a version-controlled profile before committing; it's straightforward to revert via Git if a `-k` node type was chosen too aggressively, but only if you check the diff before committing over it.
    - **`data import`'s `--allornone`/`--ignoreerrors` combination determines your actual failure semantics** — decide deliberately rather than defaulting, the same way you would for `sfdmu`'s `allOrNone` config key; the wrong combination can produce a silently incomplete dataset with no obvious error.
    - **This is an unsigned plugin** — expect and accept the standard third-party trust prompt on install, and pin a specific version in CI/automation scripts for reproducibility rather than always pulling latest.
