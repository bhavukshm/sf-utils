# SF CLI Plugin: lightning-flow-scanner

## 1. Header & Overview

- **Category:** Static Analysis / Linting (Flow Metadata)
- **Primary Purpose:** Lints Salesforce Flow metadata XML for anti-patterns before they reach an org — DML/SOQL inside loops, missing fault paths, hardcoded IDs, unused variables, inactive flows, naming-convention violations, and more — the same role ESLint plays for JavaScript or PMD plays for Apex, but purpose-built for Flow's declarative XML structure, which text/regex tooling has no reliable way to reason about (a `<connector>` element's target, a loop boundary, or a fault-path branch are structural relationships, not string patterns).
- **Installation Command:**
    ```bash
    sf plugins install lightning-flow-scanner
    ```
    (A standalone, non-`sf`-integrated CLI is also installable via `npm install -g lightning-flow-scanner` if you need to run it outside a Salesforce CLI context.)

---

## 2. Deep Dive: What It Does & Key Capabilities

**The underlying mechanic:** the scanner parses Flow XML into a structured object model (via its separately-published core engine, `lightning-flow-scanner-core`) and runs a configurable set of rules against that model — each rule inspects structural relationships (element ordering inside a loop, presence/absence of a fault connector on a DML element, whether a variable is referenced anywhere else in the flow) rather than matching text patterns. This is why it catches things `grep`/manual XML review reliably miss: "is this Get Records element inside a loop" is a graph-traversal question, not a string search.

**Rule coverage spans three categories** (30+ rules total):

- **Problem** (correctness/reliability risks) — DML or SOQL inside a loop, duplicate DML on the same object, hardcoded IDs/URLs/secrets, Process Builder detection (flagging legacy automation that should be migrated), unsafe running-context configuration, missing fault path on a risky element, missing null-value handling.
- **Suggestion** (efficiency/best-practice) — action calls inside a loop, "Get Records" queries pulling all fields instead of specific ones, inactive flows left enabled, invalid/outdated API version, missing explicit trigger order, excessive cyclomatic/cognitive complexity, redundant same-record field updates.
- **Layout** (maintainability) — flow naming convention violations, missing flow/element descriptions, unclear API names, unreachable elements, unused variables, missing auto-layout formatting.

**Why it's superior to manual UI review or native `sf` commands:** Flow Builder's UI has no built-in linter — a reviewer has to manually click through every element of every flow to spot a missing fault path or a DML-in-loop, which doesn't scale past a handful of flows and is inconsistent between reviewers. Native `sf` commands have no flow-quality-analysis capability at all. This plugin turns flow quality into something checkable in CI on every PR, with a configurable severity threshold that can actually fail a build — the same discipline Apex teams already expect from a static analyzer, extended to declarative automation.

---

## 3. Practical Usage Scenarios & Commands

**`.flow-scanner.yml`** (or `.flow-scanner.json`, or a `"flowScanner"` key inside `package.json` — resolved via `cosmiconfig`, so any of these locations works):

```yaml
rules:
    FlowFaultsRule:
        enabled: true
        severity: error
    APIVersionRule:
        enabled: true
        expression: '>= 58'
        severity: warning
exceptions:
    My_Legacy_Flow:
        - DMLStatementInLoopRule
threshold: error
categories:
    - Problem
    - Suggestion
```

- `rules` — per-rule overrides: `enabled`, `severity` (`error`/`warning`), and rule-specific `expression`/`message` tuning where applicable.
- `exceptions` — per-flow, per-rule ignore list, for a specific flow you've deliberately accepted a violation on (e.g. a known legacy flow slated for a later rewrite) without disabling that rule project-wide.
- `threshold` — the minimum severity that causes the command to exit non-zero, i.e. what actually fails a CI build.

**Command 1 — Basic scan of the project's flows:**

```bash
sf flow scan --directory force-app
```

`-d/--directory` scopes the scan to a specific source tree; without it, the scanner looks for flows under the current project's default package directories.

**Command 2 — Scan specific flow files only:**

```bash
sf flow scan --files force-app/main/default/flows/Lead_Conversion.flow-meta.xml
```

`-p/--files` targets one or more explicit flow files — useful for a pre-commit hook that only wants to check the flows actually staged in this commit, not the whole tree.

**Command 3 — CI-ready SARIF output with a fail threshold:**

```bash
sf flow scan -d force-app -c .flow-scanner.yml --sarif > flow-scan.sarif --threshold error
```

`--sarif` emits SARIF-format output, the standard static-analysis-results format GitHub code scanning and most CI security/quality dashboards natively ingest; `--threshold error` makes the command's exit code non-zero (failing the CI step) only when an `error`-severity violation is found, letting `warning`-level findings surface without blocking the pipeline.

**Command 4 — JSON output for custom pipeline parsing:**

```bash
sf flow scan -d force-app --json > flow-scan.json
```

Standard `sf` machine-readable output, for a CI step that wants to parse and post its own custom PR comment or dashboard entry instead of relying on SARIF ingestion.

**Command 5 — Auto-fix supported violations (dry-run first):**

```bash
sf flow fix -d force-app --dry-run
sf flow fix -d force-app -r FlowDescriptionRule,UnusedVariableRule
```

`sf flow fix` applies automated remediation for the subset of rules that support it (e.g. adding a missing description). `--dry-run` previews the changes without writing them; `-r/--rules` scopes the fix to specific rules rather than every fixable violation at once — important since not every auto-fix is safe to apply blindly across an entire flow library in one pass.

**Command 6 — Generate flow documentation:**

```bash
sf flow doc -d force-app --output docs/flows --separate
```

Not a lint command — generates Markdown documentation describing each flow's structure, one file per flow (`--separate`) into the given `--output` directory; useful for keeping human-readable flow documentation in sync with the actual metadata as part of the same tooling investment.

---

## 4. Developer Workflow Integration

- **When to run it:**
    - **Pre-commit / pre-push hook**, scoped to just the flows touched in the change (`sf flow scan --files <changed-flow-paths>`) — catches obvious issues (missing fault path, DML in loop) before they even reach a PR, at a cost low enough to run on every commit.
    - **CI, on every pull request touching `**/flows/**`** — the primary intended use. Run with `--sarif`/`--json` and a `--threshold` that matches your team's risk tolerance (commonly: fail on `error`, comment-only on `warning`).
    - **Periodic full-repo audit** (not per-commit) — run against the entire flow library on a schedule to catch drift/accumulated debt in flows nobody has touched recently, since a pre-commit hook only ever sees flows someone is actively editing.
- **Config setup:** commit `.flow-scanner.yml` to the repo root so every developer's local run and every CI run resolve the identical rule set — a scanner whose rules differ between a laptop and CI produces exactly the "why did this pass locally" confusion static analysis is supposed to eliminate.
- **Known edge cases / flags to be careful with:**
    - **Use `exceptions` for legitimate one-off exclusions, not `rules.<Rule>.enabled: false` project-wide**, unless you've deliberately decided a rule category doesn't apply to your team at all — disabling a rule globally to silence one legacy flow's violation quietly reopens that rule's blind spot for every _new_ flow going forward too.
    - **`sf flow fix` is not universally safe to run unattended** — always `--dry-run` first, especially the first time you run it against an unfamiliar flow library, and scope `-r/--rules` deliberately rather than accepting every auto-fixable change in one pass; some categories of fix (renames, description insertion) are low-risk, but review the diff regardless before committing.
    - **`--threshold` choice directly determines whether this tool has teeth in CI** — a scan step that runs but never sets a threshold that can actually fail the build is documentation, not a gate; decide explicitly which severities block a merge.
    - **The CLI is oclif-based and answers to both `sf flow scan` and colon-form `sf flow:scan`** — either works, but standardize on one form in your documented team commands to avoid confusing copy-pasted examples.
