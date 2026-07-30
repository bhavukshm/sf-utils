# SF CLI Plugin: sfdx-hardis

## 1. Header & Overview

- **Category:** DevOps / CI-CD Framework (Toolbox-of-Toolboxes)
- **Primary Purpose:** `sfdx-hardis` is not a single-purpose plugin — it's a comprehensive DX/CI-CD framework layered on top of the `sf` CLI and several other community plugins (`sfdx-git-delta`, `sfdmu`, code/flow scanners), providing guided interactive wizards for the everyday developer workflow (starting a task, retrieving changes, smart incremental deploys with quality gates) plus ready-made CI/CD pipeline templates, scheduled org monitoring/backup, and AI-assisted org documentation. Its core problem statement, per the maintainers: give teams a complete, opinionated Salesforce CI/CD pipeline without every team having to hand-build one from raw `sf` commands.
- **Installation Command:**
  ```bash
  sf plugins install sfdx-hardis
  ```
  Unsigned third-party plugin — accept the authenticity-warning prompt (`echo y | sf plugins install sfdx-hardis` for non-interactive CI installs). Official Docker images (`hardisgroupcom/sfdx-hardis` and `-ubuntu` / `-with-agents` variants) are also published for CI runners that prefer a container over a plugin install step.

---

## 2. Deep Dive: What It Does & Key Capabilities

**The underlying mechanic — orchestration, not reinvention.** `sfdx-hardis` wraps and sequences existing tools rather than replacing them: it drives `sfdx-git-delta` for incremental/delta deployments, wires in code-quality gates (Apex test coverage thresholds, static-analysis scanners, flow-scanner rule checks) as automatic pre-merge steps, and layers guided interactive menus (`sf hardis:work:new`, etc.) on top of the raw `sf project`/`sf org` commands a developer would otherwise have to remember and chain manually. Running any `hardis:` command with no flags typically launches an interactive wizard; the same commands accept explicit flags for non-interactive CI execution — one command surface serves both a junior developer clicking through prompts and a CI pipeline running unattended.

**Why it's superior to raw `sf` CLI usage for a team (not necessarily for a solo scripter):** a bare `sf` CLI gives you the primitives, but a team still has to independently decide and encode: which branches map to which orgs, what constitutes a "smart" incremental deploy versus a full one, what quality gates block a merge, how to schedule org backups/monitoring, and how to onboard a new developer to all of the above. `sfdx-hardis` ships opinionated, working answers to all of those as installable pipeline templates (GitHub Actions, GitLab CI, Azure Pipelines, Bitbucket) plus the interactive tooling that makes the underlying discipline approachable without memorizing raw command sequences.

---

## 3. Practical Usage Scenarios & Commands

**Config file — `config/.sfdx-hardis.yml`**, merged across three layers so the same command behaves correctly on every machine/branch:
- **Project layer** — `config/.sfdx-hardis.yml` (committed, shared for the whole repo — e.g. `installedPackages`, `availableTargetBranches`).
- **Branch layer** — `config/branches/.sfdx-hardis.<branch>.yml` (per-environment overrides, e.g. different deploy targets for `uat` vs `main`).
- **User layer** — `config/user/.sfdx-hardis.<username>.yml` (gitignored, developer-local overrides — e.g. a personal scratch-org alias).

**Command 1 — Start a new development task (interactive wizard):**
```bash
sf hardis:work:new
```
Guides a developer through creating a feature branch and a matching scratch/dev org for a new user story — replaces manually running `git checkout -b`, `sf org create scratch`, and remembering to link them.

**Command 2 — Retrieve org changes into DX source format:**
```bash
sf hardis:org:retrieve:sources:dx
```
Pulls current org metadata into the local `force-app` source tree — the guided equivalent of `sf project retrieve start`, with `sfdx-hardis`'s metadata-cleaning conventions applied.

**Command 3 — Save/publish current work:**
```bash
sf hardis:work:save
```
Commits and pushes the current task's changes and preps the merge/pull request — bundling the "am I done with this task" ceremony into one guided command.

**Command 4 — Smart incremental deploy (the CI centerpiece):**
```bash
sf hardis:project:deploy:smart --target-org my-uat-org
```
Runs an `sfdx-git-delta`-powered incremental deployment with automatic test-level selection and quality-gate checks, rather than deploying the full `force-app` tree every time.

**Command 5 — Validate a deployment before it actually runs (CI dry-run gate):**
```bash
sf hardis:project:deploy:validate --check --target-org my-uat-org
```
`--check` runs the deploy in `checkOnly` validation mode against the target — the gate a pull-request pipeline runs before allowing a merge, without actually deploying anything.

**Command 6 — Create a scratch org for a task, non-interactively (CI form):**
```bash
sf hardis:scratch:create --target-dev-hub my-devhub --no-prompt
```
Same provisioning step as the interactive wizard, but flag-driven for automated pipeline use.

**Command 7 — Scheduled org monitoring/backup (CI cron job):**
```bash
sf hardis:org:monitor:all --target-org my-prod-org
```
Runs the full daily diagnostics suite (metadata backup, drift detection, health checks) against a monitored org — the command a nightly scheduled pipeline invokes, not something a developer runs by hand.

---

## 4. Developer Workflow Integration

- **When and how a developer should trigger it:**
  - **Start of a task** — `sf hardis:work:new` for branch + org setup, instead of manual `git`/`sf org create` steps.
  - **During development** — `sf hardis:org:retrieve:sources:dx` after making declarative changes in a scratch/sandbox org, to pull them back into source.
  - **End of a task** — `sf hardis:work:save` to commit, push, and prep the merge request.
  - **In CI, on every PR** — `sf hardis:project:deploy:validate --check` as the merge gate, and `sf hardis:project:deploy:smart` as the actual post-merge deploy step, both driven by the pipeline templates the plugin can scaffold for GitHub Actions/GitLab CI/Azure/Bitbucket.
  - **On a schedule, unattended** — `sf hardis:org:monitor:all` for nightly backup/drift-detection against long-lived org branches, independent of any developer action.
- **Configuration setup to get right early:** decide and populate `availableTargetBranches` and `installedPackages` in the project-layer `config/.sfdx-hardis.yml` **before** onboarding the whole team — these drive which branches the smart-deploy and validation commands consider valid targets, and mismatches here surface as confusing "wrong org" failures in CI rather than a clear config error.
- **Known edge cases / flags to be careful with:**
  - **This is an unsigned plugin with a large dependency surface** (it pulls in `sfdx-git-delta`, code-analyzer/flow-scanner integrations, etc.) — pin a specific version in CI images rather than always installing `latest`, since a large, actively-released framework (multiple releases per week is typical for this project) has more surface area for a breaking change to land between your last verification and your next pipeline run.
  - **Interactive-by-default is a feature in local dev, a trap in CI** — any `hardis:` command run without its CI-mode flags (`--check`, `--no-prompt`, explicit `--target-org`, etc.) can hang a pipeline waiting on a prompt that will never be answered; always audit a new pipeline step's first real run interactively before trusting it unattended.
  - **The three-layer `.sfdx-hardis.yml` merge order matters** — a setting you're certain you set in the project layer can be silently overridden by a stale branch-layer or user-layer file; when a command behaves unexpectedly, check all three layers before assuming the project config is wrong.
  - **Since it *drives* `sfdx-git-delta` under the hood for incremental deploys**, the same underlying caveats apply transitively (Git LFS objects must already be pulled locally, `HEAD^` vs `HEAD~1` shell-escaping differences on Windows) — see the dedicated `sfdx-git-delta` reference for details.
