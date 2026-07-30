# SF CLI Plugin: plugin-code-analyzer

## 1. Header & Overview

- **Category:** Static Code Analysis (Multi-Engine)
- **Primary Purpose:** `@salesforce/plugin-code-analyzer` is Salesforce's own **official** static-analysis CLI, unifying multiple independent analysis engines — PMD/CPD (Apex, Visualforce, Java), ESLint (JavaScript/TypeScript, e.g. LWC), RetireJS (known-vulnerable JS library detection), Salesforce Graph Engine/SFGE (Apex data-flow analysis, e.g. detecting a field missing FLS/CRUD checks across method boundaries), a Regex engine (config-defined custom pattern rules), and a Flow/Flowtest engine (Flow metadata analysis) — behind one consistent command surface and one consistent rule-selection syntax. This is version 5 (**Code Analyzer v5**), the successor to the older `@salesforce/sfdx-scanner` plugin (topic `scanner`), which reached end-of-life in August 2025.
- **Installation Command:**
  ```bash
  sf plugins install code-analyzer
  ```
  It's a **JIT (just-in-time) plugin** — running any `sf code-analyzer ...` command auto-installs it on first use, so an explicit install step is optional but recommended for reproducible CI images.

---

## 2. Deep Dive: What It Does & Key Capabilities

**The underlying mechanic — one CLI orchestrating several independent analysis engines.** Each engine (PMD, CPD, ESLint, RetireJS, SFGE, Regex, Flowtest) is a separate analysis technology with its own rule set and its own runtime requirements (PMD/CPD/SFGE need a JDK 11+; the Flow engine needs Python 3.10+; ESLint/RetireJS run on Node). `plugin-code-analyzer` normalizes all of them behind one `--rule-selector` syntax and one output format, so a developer or CI pipeline doesn't need to separately invoke PMD for Apex and ESLint for LWC and remember different flag conventions for each.
- **Rule selection is unified via `engine:severity:tag:name` syntax**, colon-joined terms ANDed together, comma-joined terms ORed — e.g. `pmd:(Security,Performance):2` selects PMD rules tagged either `Security` or `Performance` at severity `2`; `eslint:3` selects all ESLint rules at severity 3. This single syntax replaced v4's separate, engine-specific category/ruleset/engine flags — a significant simplification.
- **SFGE (Salesforce Graph Engine)** performs actual data-flow analysis across Apex method boundaries — it can trace whether a field access several calls deep lacks a CRUD/FLS check, something a single-file, single-pass linter structurally cannot do. In v5 it runs as just another engine through the same `run` command, rather than needing its own dedicated commands as in v4.
- **Why this beats manual code review or no static analysis at all:** each of these engines individually catches a class of defect a human reviewer reliably misses at scale — RetireJS flags a vulnerable JS library version by exact match against a CVE database; SFGE's cross-method data-flow tracing is not something a line-by-line PR review reliably reconstructs; PMD's Apex ruleset encodes years of accumulated known Apex anti-patterns. Consolidating them into one CLI with one severity-gating mechanism (`--severity-threshold`) makes it realistic to wire all of this into a CI gate, rather than each engine being a separate, easy-to-skip manual step.

---

## 3. Practical Usage Scenarios & Commands

**`code-analyzer.yml`** — the config file, auto-detected at the workspace root if present:
```yaml
log_folder: ./logs
rules:
  pmd:
    ApexSharingViolations:
      severity: high
engines:
  cpd:
    disable_engine: true
  flow:
    disable_engine: false
ignores:
  - "**/*Test.cls"
```
- `rules` — override severity/tags on existing rules, or define custom Regex-engine rules.
- `engines` — per-engine configuration blocks, including disabling an entire engine (e.g. turning off CPD copy-paste detection if it's too noisy for your codebase).
- `ignores` — exclude specific files/paths from analysis entirely (e.g. test classes).
- Referencing a custom PMD ruleset file here **adds** those rules to the selectable pool rather than replacing the built-in set — an important v4→v5 behavior change to be aware of if migrating.

**Command 1 — List available rules matching a selector (before running anything):**
```bash
sf code-analyzer rules --rule-selector "pmd:(Security,Performance):2"
```
`-r/--rule-selector` (repeatable, default `["Recommended"]`) is the same selector syntax used by `run` — using `rules` first to preview exactly which rules a selector matches, before spending analysis time actually running them, is a good habit when tuning a new selector.

**Command 2 — Basic run against a workspace:**
```bash
sf code-analyzer run --workspace ./force-app --view detail
```
`-w/--workspace` (repeatable, default `['.']`) defines the full set of files Code Analyzer has *context* on (needed for cross-file analysis like SFGE's data-flow tracing); `-v/--view detail` shows every violation location instead of just the primary one (`table`, the default, shows only the primary location per violation).

**Command 3 — Scoping analysis to a subset of the workspace (`--target`):**
```bash
sf code-analyzer run --workspace . --target force-app/main/default/classes/MyNewClass.cls
```
`-t/--target` (repeatable) narrows *what's actually analyzed* to a subset, while `--workspace` still supplies full project context — the right combination for a PR-scoped scan that still lets SFGE reason about how the changed file interacts with the rest of the codebase.

**Command 4 — Engine-specific run with a severity gate for CI:**
```bash
sf code-analyzer run --rule-selector eslint --severity-threshold 3
```
`-s/--severity-threshold` accepts a named level (`critical`/`high`/`moderate`/`low`/`info`) or numeric `1`–`5`; the command exits non-zero if any violation meets or exceeds it — this is the flag that actually turns a scan into a CI gate, rather than a report nobody acts on.

**Command 5 — Multiple output formats in one run:**
```bash
sf code-analyzer run --workspace ./force-app --output-file results.sarif --output-file results.html
```
`-f/--output-file` is repeatable and infers format from each file's extension (`.sarif`, `.html`, `.json`, `.csv`, `.xml` all supported) — one run can produce a SARIF file for a code-scanning dashboard *and* an HTML file for a human-readable artifact, simultaneously.

**Command 6 — CI integration via the official GitHub Action:**
```yaml
- uses: forcedotcom/run-code-analyzer@v2
  with:
    run-command: run
    run-arguments: --workspace . --view detail --output-file sfca_results.json
    github-token: ${{ secrets.GITHUB_TOKEN }}
```
The official `forcedotcom/run-code-analyzer` action wraps `code-analyzer run`, uploads a results artifact, and — given a `github-token` — posts violations as PR review comments. It exposes outputs (`num-violations`, per-severity counts, `exit-code`) that your workflow gates on explicitly; the action itself does not automatically fail the build, so add that gating step deliberately.

---

## 4. Developer Workflow Integration

- **When to trigger it:**
  - **Locally, before committing** — a quick `sf code-analyzer run --target <changed-files>` scoped to just-edited files, catching obvious violations before they ever reach a PR.
  - **CI, on every pull request** — the primary intended use, via the official GitHub Action or an equivalent pipeline step, gated with `--severity-threshold` to fail the build on anything above your team's tolerance.
  - **Periodic full-codebase scan** (not per-PR) — a scheduled run against the whole workspace to catch accumulated debt in code nobody has recently touched, since PR-scoped `--target` runs only ever see actively-changed files.
- **Runtime prerequisites matter for CI images:** PMD/CPD/SFGE require a JDK 11+, the Flow/Flowtest engine requires Python 3.10+, and ESLint/RetireJS need Node 20.9+ — a CI runner missing any of these silently loses that engine's coverage (or fails outright) rather than gracefully degrading; verify your CI image has all three runtimes before assuming full coverage is active.
- **Config setup:** commit `code-analyzer.yml` at the workspace root so local runs and CI runs resolve the identical rule/engine configuration — remember that referencing a custom ruleset file **adds** to the built-in rule pool rather than replacing it, a common point of confusion when migrating from v4's `pmd-ruleset` behavior.
- **Known edge cases / flags to be careful with:**
  - **`--workspace` vs `--target` is the most common point of confusion** — `--workspace` gives engines like SFGE the *context* they need for cross-file analysis, while `--target` is what's actually scored/reported on. Setting `--target` without a broader `--workspace` can silently degrade SFGE's cross-method data-flow analysis for files that reference code outside the target set.
  - **`--severity-threshold` is what makes this a gate, not a report** — a CI step that runs `code-analyzer run` without ever checking/gating on severity produces output nobody is forced to act on.
  - **Migrating from `@salesforce/sfdx-scanner` (v4)?** The command topic changed (`scanner` → `code-analyzer`), the six v4 commands collapsed into three (`run`, `rules`, `config`), category/ruleset/engine flags were unified into the single `--rule-selector` syntax, and SFGE lost its dedicated commands — budget real migration time rather than assuming a drop-in flag rename.
  - Given this plugin is JIT-installed, pin an explicit version in CI (`sf plugins install code-analyzer@<version>`) if you need build-to-build reproducibility rather than always picking up whatever is currently latest.
