# SF CLI Plugin: sfdmu

## 1. Header & Overview

- **Category:** Data Migration / ETL
- **Primary Purpose:** SFDMU (Salesforce Data Move Utility) moves *record data* — not metadata — between two orgs, between an org and CSV files, or between two CSV sets, while automatically preserving the relationships (lookups, master-detail, self-relationships) between the records it moves. It solves the problem every Salesforce team eventually hits with Data Loader/Workbench: those tools can insert records into a target org, but they cannot resolve a lookup field that points at a record whose `Id` only exists in the *source* org — you're left hand-building ID-mapping spreadsheets. SFDMU does that remapping for you, keyed off an `externalId` you designate per object.
- **Installation Command:**
  ```bash
  sf plugins install sfdmu
  ```
  (The legacy `sfdx plugins install sfdmu` invocation is explicitly marked deprecated by the maintainers — install and run it through `sf`.)
- **Maintainer:** published under the official `forcedotcom` GitHub org (BSD-3-Clause license) — one of the few community-originated plugins that graduated to being maintained directly by Salesforce.

---

## 2. Deep Dive: What It Does & Key Capabilities

**The core mechanic — relationship-aware ETL, not record-by-record insert:**
SFDMU doesn't just copy rows. For each object in your migration set, it runs a SOQL `query` you supply (so you control exactly which records move, via a normal `WHERE` clause), then on write it cross-references every relationship field against an `externalId` you've declared for the *related* object — a field guaranteed to identify "the same real-world record" in both orgs (commonly `Name`, a custom `Legacy_Id__c`, or the standard record `Id` if you're doing an org-to-org clone where source IDs happen to be stable). When it inserts a Contact whose `AccountId` pointed at Account `001` in the source org, SFDMU has already inserted/matched that Account in the target and substitutes the *target* org's `Id` automatically. This is the entire reason the tool exists: Data Loader and Workbench have no concept of "this lookup needs remapping," so any multi-object hierarchy (Account → Contact → Opportunity → OpportunityLineItem) done through them requires manual, error-prone ID bookkeeping. SFDMU's `master: false` flag on dependent objects also drives *load ordering* — parents are inserted before the children that reference them, automatically.
- Supports three migration directions from the same config shape: **org → org**, **org → CSV** (export), and **CSV → org** (import) — by setting `--sourceusername`/`--targetusername` to either a real org alias or the literal keyword `csvfile`.
- Per-object `operation` (`Insert`, `Update`, `Upsert`, `Delete`, `Readonly`, `Merge`) gives fine-grained control per object in the *same* run — e.g. `Upsert` Accounts but `Readonly` a reference object you only need for relationship resolution, not to actually write.
- **Why it's superior to the standard `sf` CLI / UI:** `sf data query`/`sf data import` operate on one object at a time with no relationship resolution at all; the Setup UI's Data Import Wizard supports only a handful of standard objects. Neither approach scales past a two-or-three-object hierarchy without hand-built mapping. SFDMU is purpose-built for exactly this multi-object, cross-org relationship problem.

---

## 3. Practical Usage Scenarios & Commands

**`export.json` — the config file that drives every run** (lives in the directory passed via `--path`):
```json
{
  "objects": [
    {
      "query": "SELECT Id, Name, Industry FROM Account WHERE Industry = 'Technology'",
      "operation": "Upsert",
      "externalId": "Name"
    },
    {
      "query": "SELECT Id, LastName, Email, AccountId FROM Contact",
      "operation": "Upsert",
      "externalId": "Email",
      "master": false
    }
  ]
}
```
- `query` — SOQL that scopes exactly which source records participate; standard `WHERE`/`ORDER BY`/relationship-field syntax all works.
- `operation` — `Upsert` is the most common default; use `Insert` for a guaranteed-empty target, `Delete` for cleanup runs, `Readonly` when an object is only needed to resolve a relationship but shouldn't itself be written.
- `externalId` — the matching key used both for upsert de-duplication *and* for cross-org relationship remapping. Must be unique per record in practice (a formula/text field, or the standard `Id` for a same-org-lineage clone).
- `master: false` — marks this object as a **dependent/child**; SFDMU sequences the whole run so parents (`master: true`, the default) load first.

**Command 1 — Basic org-to-org migration:**
```bash
sf sfdmu run --sourceusername my-sandbox --targetusername my-scratch-org --path ./dataset
```
Runs the `export.json` found in `./dataset`, reading from `my-sandbox` and writing to `my-scratch-org`.

**Command 2 — Dry-run before touching a real target (`--simulation`):**
```bash
sf sfdmu run -s my-sandbox -u my-uat-org -p ./dataset --simulation
```
`-m/--simulation` executes the *entire* query/relationship-resolution/matching pipeline exactly as a real run would, but performs zero DML against the target — the safest way to validate an `export.json` change before it touches any org.

**Command 3 — Export an org's data to CSV (no target org at all):**
```bash
sf sfdmu run --sourceusername my-prod-org --targetusername csvfile --path ./csv-export
```
Setting `--targetusername` to the literal keyword `csvfile` writes every queried object out as CSV in `./csv-export` instead of writing to any org — useful for point-in-time snapshots or handing data to a non-Salesforce system.

**Command 4 — Import from CSV into an org:**
```bash
sf sfdmu run -s csvfile -u my-target-org -p ./dataset
```
The inverse of Command 3 — `-s/--sourceusername csvfile` reads from CSVs in `./dataset` instead of querying a source org.

**Command 5 — Guarded write to a production target (`--canmodify`):**
```bash
sf sfdmu run -s my-uat-org -u my-prod-org -p ./dataset --canmodify my-prod-org.my.salesforce.com
```
Without `-c/--canmodify`, SFDMU detects that the target is a production org and interactively prompts for confirmation before writing anything — a deliberate speed bump against migrating into prod by mistake. Passing `--canmodify <target-instance-url>` pre-authorizes that specific org for non-interactive/CI execution; the value must match the target's actual instance URL, so it can't be blindly copy-pasted across orgs.

**Command 6 — CI/automation-safe invocation:**
```bash
sf sfdmu run -s my-sandbox -u my-uat-org -p ./dataset \
  --noprompt --silent --failonwarning --json > sfdmu-result.json
```
- `-n/--noprompt` — suppresses all interactive prompts (required for any non-interactive CI runner).
- `--silent` — suppresses console output beyond what's captured in logs.
- `--failonwarning` — escalates any warning (e.g. a partially-matched relationship) to a hard failure with a non-zero/CI-detectable exit code, rather than letting the run report "success with warnings."
- `--json` — machine-readable result envelope, consistent with every other `sf` command's `--json` convention, for a CI step to parse and gate on.

---

## 4. Developer Workflow Integration

- **When to run it:** almost always a *manual or scheduled* step, not a per-commit hook — SFDMU moves records, not source metadata, so it has no natural place in a pre-commit/pre-deploy pipeline the way `sfdx-git-delta` does. Typical triggers: seeding a fresh scratch org with a realistic reference dataset right after `sf org create scratch` + `sf project deploy start`, refreshing a UAT/staging sandbox with a curated slice of production data (with PII scrubbed via `excludedFields` or a masking add-on), or a scheduled nightly job that mirrors reference/config data (price books, custom metadata-backed records) from a "source of truth" org out to several downstream sandboxes.
- **Standard post-scratch-org pattern:**
  ```bash
  sf org create scratch -f config/project-scratch-def.json -a my-scratch-org
  sf project deploy start --target-org my-scratch-org
  sf sfdmu run -s my-data-seed-org -u my-scratch-org -p ./dataset/seed-data
  ```
  This gives every new scratch org the same relationally-consistent baseline data (Accounts → Contacts → Opportunities, all correctly linked) instead of an empty org or hand-maintained static resources.
- **Config setup — `export.json` is per-directory, and directories are meant to be composed.** Keep one `export.json`-containing folder per logical dataset (`./dataset/core-accounts`, `./dataset/pricebooks`, `./dataset/qa-fixtures`) rather than one giant object list — it keeps each `--path` invocation scoped, reviewable in PRs, and independently re-runnable.
- **Edge cases and flags to be careful with:**
  - **`--canmodify` is a safety rail, not a formality** — never hardcode it into a shared script pointed at a variable target without re-verifying the instance URL matches; the entire point is to force a deliberate, explicit acknowledgment before writing to prod.
  - **Always dry-run a new or edited `export.json` with `--simulation` first**, especially after changing an `externalId` — a poorly chosen `externalId` (one that isn't actually unique in the target) silently produces incorrect upserts/merges rather than an obvious error.
  - **`allOrNone` batch semantics matter for partial-failure behavior:** decide deliberately whether a bad record in a batch should abort the whole batch (`true`) or let the rest load while that one record is skipped/reported (`false`) — the wrong default for your use case can mean either an incomplete dataset or an all-or-nothing migration that's needlessly fragile to one bad row.
  - **`--anonymise`** is worth defaulting to `on` whenever migration logs might be shared outside the immediate team (e.g. attached to a support ticket) — it hashes sensitive field values in the log output before they leave the machine.
  - Version note: the maintainers ship a "new v5" rebuilt on the current `sf`-plugin architecture; if you hit a regression, the documented fallback is pinning to the older `v4.39.0` release rather than working around it in your `export.json`.
