# SFDX-Git-Delta (SGD) Mastery Guide for Salesforce CI/CD

A production-grade reference for `sfdx-git-delta` — the community `sf` CLI plugin that diffs two Git references and emits Salesforce-ready `package.xml`/`destructiveChanges.xml` manifests (and optionally the changed source files themselves). Where a full-`force-app` deploy pushes everything every time, SGD is what makes **incremental deployment** possible: deploy only what actually changed, and destroy only what was actually removed.

> **Note on command form:** this guide reflects the current plugin's supported invocation, `sf sgd source delta` (installed via `sf plugins install sfdx-git-delta`). You may see older tutorials reference a different invocation style (e.g., a standalone `sgd` binary or legacy `sfdx sgd:` namespace) — those predate the current `sf`-plugin packaging and are not covered here.

---

## 0. Prerequisites & Honest Disclaimers

- **Install:** `sf plugins install sfdx-git-delta` — this is an **unsigned** third-party plugin, so the CLI will prompt "This plugin is not digitally signed and its authenticity cannot be verified"; answering `y` is expected and required to proceed. In non-interactive CI shells, pre-answer it: `echo y | sf plugins install sfdx-git-delta`.
- **Requirements:** the `git` CLI must be present on the running environment, and **Node v22 or above** is required (verify with `sf --version`).
- **⚠️ Not an officially supported Salesforce tool.** It's a well-maintained community plugin used widely in production pipelines (including by `sfdx-hardis`), but treat it accordingly: test thoroughly before wiring it into a production pipeline, and always keep a working "full deploy" fallback path in case the incremental path misbehaves.
- **Git LFS:** SGD reads LFS content locally but will **not** fetch it from the LFS server itself — ensure LFS objects are already pulled before running SGD if your repo uses LFS.
- Throughout this guide, `--from` is always the **base/older** commit and `--to` is always the **target/newer** commit (defaults to `HEAD` if omitted). For a PR/MR check, `--from` is the base branch being merged into, and `--to` is the feature branch's tip.

---

## 1. Feature Branch vs. `origin/main`

**DevOps Context:** The most common use case — before merging a feature branch, generate exactly the delta between it and the target branch, to preview (or deploy to) only what that branch actually changes.

**Exact Command & Flags:**
```bash
sf sgd source delta --to "HEAD" --from "origin/main" --output-dir .
```

**Explanation of Outputs:**
- `./package/package.xml` — every added or modified metadata component between the two refs, ready for a standard deploy.
- `./destructiveChanges/destructiveChanges.xml` — every deleted or renamed component.
- `./destructiveChanges/package.xml` — a companion **minimal package.xml** SGD always generates alongside `destructiveChanges.xml`. This exists because the Metadata API deploy operation requires *some* `package.xml` to accompany a destructive-changes deployment, even when the intent is pure deletion.

**Integration with `sf project deploy start`:**
```bash
sf project deploy start -x package/package.xml --post-destructive-changes destructiveChanges/destructiveChanges.xml
```
- **Why `origin/main`, not `main`:** in CI, branches other than the one actually checked out typically don't exist as local branches — only as remote-tracking refs. Using the bare name `main` will fail to resolve; `origin/main` (or whatever remote alias your pipeline configures) is required.

---

## 2. Between Two Git Commit Hashes

**DevOps Context:** Auditing or replaying exactly what changed between two specific, already-known commits — e.g., reconstructing what a specific past release actually deployed, independent of any branch pointer.

**Exact Command & Flags:**
```bash
sf sgd source delta --from 61f235b1 --to fbc3ade6 --output-dir delta-output
```

**Explanation of Outputs:**
- Identical structure to Scenario 1 (`delta-output/package/package.xml`, `delta-output/destructiveChanges/destructiveChanges.xml` + companion `package.xml`), just rooted under the `delta-output` directory instead of `.`.
- Any valid Git pointer works for `--from`/`--to`: a commit SHA, a branch name, a tag, or a relative expression (`HEAD~1`, `HEAD^`, etc.) — SGD doesn't care which form you use as long as `git` can resolve it.

**Integration with `sf project deploy start`:**
```bash
sf project deploy start -x delta-output/package/package.xml \
  --post-destructive-changes delta-output/destructiveChanges/destructiveChanges.xml
```
- **Windows caveat:** avoid `HEAD^` on Windows shells — `^` is the Windows escape character and will be misinterpreted. Use `HEAD~1` instead, which means the same thing to Git but has no special meaning to `cmd.exe`/PowerShell.

---

## 3. Generating a Copy-Source Folder (`-d` / `--generate-delta`)

**DevOps Context:** Manifest-based deployment (`-x package.xml`) deploys the **entire containing folder** for certain metadata types (notably custom objects — the whole `objects/Account/` folder deploys even if only one field changed). For faster, more surgical deploys, you instead want an output folder containing *only the actual changed physical files*.

**Exact Command & Flags:**
```bash
mkdir changed-sources
sf sgd source delta --to "HEAD" --from "HEAD~1" --output-dir changed-sources/ --generate-delta
```

**Explanation of Outputs:**
- The usual `package/` and `destructiveChanges/` manifest folders are still generated.
- **Additionally**, because of `--generate-delta` (`-d`), SGD copies every added/modified source file into `changed-sources/`, preserving the original `force-app/...` directory structure — a real, deployable source tree containing only what changed, not manifest references to it.
- **Critical constraint:** `--generate-delta` is designed to be used when `--to` is `HEAD` (the default) — i.e., comparing against your *current* working tree state. If you need `--to` to point at some other, non-`HEAD` commit, you must `git checkout` that commit first, then run SGD with `--to` omitted (defaulting to `HEAD`), rather than passing an arbitrary `--to` value directly.

**Integration with `sf project deploy start`:**
```bash
sf project deploy start -p changed-sources
```
- Note the flag switch: this is **`-p`/`--source-dir`** (path-based deploy of an actual source folder), not `-x`/`--manifest` — you're deploying real files now, not a manifest reference.

---

## 4. Handling Deleted Metadata (Destructive Changes)

**DevOps Context:** A commit range includes a deleted Apex class, custom field, or component (e.g., `AnotherTriggerFramework.cls` removed as part of a framework migration) — this needs to become an actual deletion in the target org, not just an absence.

**Exact Command & Flags:**
```bash
sf sgd source delta --to "HEAD" --from "HEAD~1" --output-dir .
cat destructiveChanges/destructiveChanges.xml
```

**Explanation of Outputs:**
- `destructiveChanges/destructiveChanges.xml` lists every removed (or renamed-away-from) component, grouped by metadata type, exactly like a `package.xml` but semantically meaning "delete these."
- `destructiveChanges/package.xml` — again, the mandatory minimal companion manifest (can even be effectively empty) that the deploy API requires to accept a destructive-changes payload.

**Integration with `sf project deploy start` — two valid patterns:**
```bash
# Pattern A: single combined deploy, deletions applied AFTER the main deploy succeeds
sf project deploy start -x package/package.xml \
  --post-destructive-changes destructiveChanges/destructiveChanges.xml

# Pattern B: destructive changes run as their own standalone deploy
sf project deploy start --pre-destructive-changes destructiveChanges/destructiveChanges.xml \
  --manifest destructiveChanges/package.xml --ignore-warnings
```
- `--post-destructive-changes` deletes **after** the additive deploy completes — the common case, since new/replacement metadata is usually in place before the old metadata is safely removable.
- `--pre-destructive-changes` deletes **before** a deploy — needed when the old metadata must be gone *first* (e.g., a field being replaced by a same-named field of a different type). Getting this ordering wrong is a classic incremental-deployment failure mode — if Pattern A's single combined deploy fails because deletion actually needed to happen first, split into two deploys instead.
- `--ignore-warnings` in Pattern B is often necessary because a destructive-only deploy paired with a near-empty manifest can otherwise raise non-fatal warnings that would halt the operation.

---

## 5. Ignoring Specific Metadata Types (`.sgdignore` via `--ignore-file`)

**DevOps Context:** Profiles and Permission Sets churn constantly (every developer's local Setup click-through can touch them) and are frequently excluded from automated incremental deploys to avoid noisy, unreviewed permission drift reaching production.

**Exact Command & Flags:**
```bash
# .sgdignore (filename is a convention, not a magic auto-detected name — it's passed explicitly)
**/profiles/**
**/permissionsets/**

sf sgd source delta --from "origin/main" --ignore-file .sgdignore --output-dir .
```

**Explanation of Outputs:**
- `--ignore-file` (`-i`) accepts any filename you choose — `.sgdignore` is simply the community-adopted convention, mirroring `.gitignore`/`.forceignore` naming. SGD does **not** auto-discover a file with this name; it must be passed explicitly via `-i`.
- Patterns follow standard [gitignore glob syntax](https://git-scm.com/docs/gitignore). Every diff line matching a pattern is excluded from **both** `package.xml` and `destructiveChanges.xml` generation, and from the `--generate-delta` copy step.
- **Split-policy option:** if profiles/permission sets should be excluded from *deletions* only (but still tracked as additions/modifications), use the separate `--ignore-destructive-file` (`-D`) flag instead — it overrides `--ignore-file` specifically for the destructive-changes side. This matters in the real edge case where the same component is modified in one package directory and deleted in another within the same commit range — without a distinct destructive-ignore policy, that component can end up listed in *both* manifests simultaneously, which fails deployment.

**Integration with `sf project deploy start`:** unchanged from Scenarios 1/4 — the ignore filtering happens entirely at manifest-generation time, before deploy ever runs.

---

## 6. Deploying Delta Packages via SF CLI (Full Pipeline Example)

**DevOps Context:** The complete, minimal happy-path pipeline: generate the delta, then deploy exactly what it produced — the core loop every other scenario in this guide builds on.

**Exact Command & Flags:**
```bash
sf sgd source delta --from "origin/main" --to "HEAD" --output-dir .

# Guard against deploying an empty package.xml (SGD may legitimately produce one
# if the whole commit range only touched ignored/irrelevant files)
if grep -q '<types>' ./package/package.xml; then
  echo "---- Deploying added and modified metadata ----"
  sf project deploy start -x package/package.xml
else
  echo "---- No changes to deploy ----"
fi
```

**Explanation of Outputs:** same `package/package.xml` structure as prior scenarios — this scenario is about the *deploy step*, not new manifest content.

**Integration with `sf project deploy start`:**
- `-x` is the short flag for `--manifest`, pointing the deploy command at SGD's generated `package.xml`.
- The `grep -q '<types>'` guard matters in production: an empty `<Package>` manifest (no `<types>` blocks at all) can cause `sf project deploy start` to error out rather than gracefully no-op — always branch on manifest content before invoking deploy in an automated pipeline.

---

## 7. Destructive Deployment Execution

**DevOps Context:** Running the deletion half of an incremental deploy as its own explicit, auditable step — useful when your pipeline wants a distinct "delete" stage with its own approval gate or logging, separate from the additive deploy.

**Exact Command & Flags:**
```bash
echo "--- destructiveChanges.xml generated with deleted metadata ---"
cat destructiveChanges/destructiveChanges.xml
echo "--- Deleting removed metadata ---"
sf project deploy start --pre-destructive-changes destructiveChanges/destructiveChanges.xml \
  --manifest destructiveChanges/package.xml --ignore-warnings
```

**Explanation of Outputs:** reuses the `destructiveChanges/` folder from Scenario 4 — this scenario focuses purely on the deploy-side invocation.

**Integration with `sf project deploy start`:**
- Note that a **standalone** destructive deploy still requires `--manifest destructiveChanges/package.xml` — the deploy API has no "manifest-less" mode, which is exactly why SGD always generates that companion (near-empty) `package.xml` alongside `destructiveChanges.xml`.
- `--pre-destructive-changes` here (rather than `--post-`) reflects that this is being run as its own isolated step, logically "before" whatever additive deploy step follows it in the pipeline — choose `--pre-` vs. `--post-` based on your pipeline's actual stage ordering, not by habit.

---

## 8. CI/CD Integration (GitHub Actions / GitLab CI)

**DevOps Context:** Wiring the whole delta-generate-then-deploy flow into an automated pull-request/merge-request validation job — the actual production home for everything in this guide.

**GitHub Actions example:**
```yaml
jobs:
  validate-delta:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0   # full history required — sgd must resolve refs beyond the last commit

      - run: npm install @salesforce/cli --global
      - run: echo y | sf plugins install "sfdx-git-delta@${{ vars.SGD_VERSION }}"

      - run: |
          sf sgd source delta \
            --to "HEAD" \
            --from "origin/${{ github.event.pull_request.base.ref }}" \
            --output-dir .

      - run: |
          if grep -q '<types>' ./package/package.xml; then
            sf project deploy start -x package/package.xml \
              --post-destructive-changes destructiveChanges/destructiveChanges.xml \
              --target-org ci-validation-org --dry-run --test-level RunLocalTests
          fi
```

**GitLab CI example:**
```yaml
validate-delta:
  variables:
    GIT_DEPTH: 0   # equivalent full-history requirement for GitLab's shallow-clone default
  script:
    - npm install @salesforce/cli --global
    - echo y | sf plugins install sfdx-git-delta
    - sf sgd source delta --to "HEAD" --from "origin/$CI_MERGE_REQUEST_TARGET_BRANCH_NAME" --output-dir .
    - >
      if grep -q '<types>' ./package/package.xml; then
        sf project deploy start -x package/package.xml
          --post-destructive-changes destructiveChanges/destructiveChanges.xml
          --target-org ci-validation-org --dry-run --test-level RunLocalTests
      fi
```

**Explanation of Outputs:** identical manifest structure to prior scenarios — this scenario is entirely about the *pipeline scaffolding* around it.

**Integration with `sf project deploy start`:** shown inline above (`--dry-run` for PR/MR validation jobs; drop `--dry-run` for an actual merge-triggered deployment job).

**Deep CI-specific notes:**
- **`fetch-depth: 0` / `GIT_DEPTH: 0` is not optional.** Most CI providers shallow-clone by default (fetching only the tip of the checked-out branch), which leaves SGD unable to resolve the `--from` ref at all.
- **Always prefix the remote** (`origin/...`) for any ref that isn't the branch actually checked out in the runner — CI checkouts don't create local tracking branches for other branches the way a developer's local clone does.
- **Pin the plugin version** via a CI variable (`SGD_VERSION`, shown above) rather than hardcoding it in the pipeline YAML — this lets you bump or roll back the plugin version without touching pipeline definitions.

---

## 9. Handling Repo-Root Subdirectories (`-r` / `--repo-dir`)

**DevOps Context:** A monorepo where the actual `.git` root sits *above* the Salesforce DX project — e.g., `repo-root/salesforce/force-app/...` with other non-Salesforce projects as siblings under `repo-root/`. SGD needs to know where the real Git repository boundary is, independent of where the SFDX metadata lives.

**Exact Command & Flags:**
```bash
# Run from anywhere; explicitly point SGD at the actual git root
sf sgd source delta --repo-dir ../.. --source-dir salesforce/force-app \
  --from "origin/main" --to "HEAD" --output-dir .
```

**Explanation of Outputs:** same manifest structure as prior scenarios, but delta computation is scoped correctly to the `salesforce/force-app` subtree of the larger monorepo rather than misresolving Git state relative to the wrong directory.

**Integration with `sf project deploy start`:** unchanged — deploy commands still run from wherever your SFDX project root (`sfdx-project.json`) actually is, independent of where `--repo-dir` pointed.

**Deep flag distinction — don't confuse `-r` with `-s`:**
- **`-r`/`--repo-dir`** (default `./`) answers *"where is the `.git` directory?"* — it's about Git repository location.
- **`-s`/`--source-dir`** (default `./`, repeatable) answers *"which folders should delta analysis actually focus on?"*, and is always **relative to `--repo-dir`**, not to your current working directory.
- These solve two genuinely different problems: `-r` fixes "SGD can't find the Git repo," while `-s` fixes "SGD found the repo but is looking at too much (or the wrong) source." A monorepo commonly needs both together, as shown above.

---

## 10. API Version Override

**DevOps Context:** Forcing every generated manifest to declare a specific Salesforce API version — e.g., to keep a delta pipeline pinned to a known-good API version independent of what an individual package directory's `sourceApiVersion` happens to say, or ahead of a coordinated org-wide version bump.

> **Flag correction:** despite the intuitive assumption that "version" would map to `-v`, SGD's actual short flag for this is **`-a`** (for `--api-version`). There is no `-v` flag on this command — always verify against `sf sgd source delta --help` rather than assuming CLI flag conventions carry over from other tools.

**Exact Command & Flags:**
```bash
sf sgd source delta --from "origin/main" --to "HEAD" --output-dir . --api-version 61.0
```

**Explanation of Outputs:** identical manifest structure as prior scenarios, except every generated `<version>` element inside `package.xml` and `destructiveChanges/package.xml` now reads `61.0` regardless of what any individual metadata file or `sfdx-project.json` specifies.

**Integration with `sf project deploy start`:** no special handling needed — `sf project deploy start` simply respects whatever API version the manifest declares.

**Deep default-resolution note:** without `-a`, SGD resolves the API version in this priority order: your `sfdx-project.json`'s `sourceApiVersion` attribute first, falling back to the latest available API version if that attribute is absent. Passing `-a` explicitly always wins over both.

---

## Bonus Scenarios

### A. Grouping Changes by Kind for Release Review (`-c` / `--changes-manifest`)

**DevOps Context:** Package release reviewers (1GP/managed/unlocked package maintainers) need to distinguish **newly added** components from **modified** ones — adding a brand-new component to a managed package is a one-way door affecting every subscriber, while a modification to an existing one is comparatively lower-risk. SGD's `package.xml` bundles both together (correctly, since deployment doesn't care about the distinction) — `--changes-manifest` produces a *separate* JSON report that does.

```bash
sf sgd source delta --from "origin/main" --to "HEAD" --output-dir . --changes-manifest
```
Produces `./changes.manifest.json`:
```json
{
  "add":    { "ApexClass": ["BrandNewClass"], "CustomObject": ["NewObject__c"] },
  "modify": { "ApexClass": ["ExistingClass"] },
  "delete": { "ApexTrigger": ["OldTrigger"] },
  "rename": { "ApexClass": [{ "from": "OldName", "to": "NewName" }] }
}
```
- Enabling `--changes-manifest` also turns on Git's rename detection for that run, so a file-level rename shows up as its own `rename` entry instead of being split into a fake delete-and-add pair in the underlying manifests.

### B. Scoping Delta to `sfdx-project.json` Package Directories

**DevOps Context:** SGD deliberately has no awareness of `sfdx-project.json` and treats the entire repository as in-scope by default — meaning unrelated tooling/config directories that happen to change are picked up too. Feed the declared `packageDirectories` in explicitly to constrain it:

```bash
sf sgd source delta --from "origin/main" --to "HEAD" --output-dir ./delta --generate-delta \
  $(jq -r '.packageDirectories[] | "--source-dir", .path' sfdx-project.json)
```
- `jq` expands each `packageDirectories[].path` entry from `sfdx-project.json` into a repeated `--source-dir` argument — a clean way to keep delta scope in lockstep with your actual project configuration rather than hardcoding paths.
- Prefer plain `--ignore-file` instead when you just need to skip a handful of known non-package paths without fully coupling the command to `sfdx-project.json`.

### C. Testing Uncommitted Local Changes Safely

**DevOps Context:** You want to preview the delta for changes you haven't committed yet — SGD only diffs commits, so this requires a disposable temporary commit.

```bash
git add '<files>'
git commit -m 'temp: testing changes'
sf sgd source delta --from <known-good-sha>
git reset --soft HEAD~1   # undo the temp commit, keep the changes staged
```
- `--soft` reset removes the commit from history while leaving the file changes intact in the working tree/index — for extra safety, do this on a disposable branch rather than directly on your feature branch.

### D. The Flow-Deletion Trap

**DevOps Context:** The single most common "why didn't my destructive deploy work" surprise with SGD: **committing a Flow's deletion to the repo and running SGD does not actually delete the Flow.** The Metadata API has a known limitation where Flow deletion via `destructiveChanges.xml` is not supported at all.

**The correct workaround** requires the `FlowDefinition` metadata type (available up to API `v44` — check your target org's supported range) and a specific sequence:
1. Set the Flow's `FlowDefinition` `activeVersionNumber` to `0`.
2. List that `FlowDefinition` in a `package.xml` (a normal deploy, not destructive).
3. List **every existing version** of the Flow in a `destructiveChangesPost.xml`, using: `SELECT FlowDefinitionView.ApiName, VersionNumber, Status FROM FlowVersionView WHERE FlowDefinitionView.ApiName='<FLOW_API_NAME>'`.
4. Deploy the `FlowDefinition` change and post-delete all Flow versions in one operation:
   ```bash
   sf project deploy start -x package.xml --post-destructive-changes destructiveChangesPost.xml --ignore-warnings
   ```
- This is not something SGD generates for you automatically — treat any Flow deletion in a commit range as a manual-process flag in your pipeline, not something safe to let an automated destructive deploy handle unattended.

---

## Summary Cheat Sheet

| Scenario | Command | Key Flag |
|---|---|---|
| Branch vs. main | `sf sgd source delta --to HEAD --from origin/main -o .` | `--from`/`--to` |
| Between two commits | `sf sgd source delta --from <shaA> --to <shaB> -o .` | `--from`/`--to` (any git ref) |
| Copy-source folder | `sf sgd source delta --to HEAD --from HEAD~1 -o out/ -d` | `-d`/`--generate-delta` |
| Destructive changes | `sf sgd source delta --from HEAD~1 -o .` then inspect `destructiveChanges/` | (automatic output) |
| `.sgdignore` exclusions | `sf sgd source delta --from origin/main -i .sgdignore -o .` | `-i`/`--ignore-file` |
| Deploy via manifest | `sf project deploy start -x package/package.xml` | `-x`/`--manifest` |
| Destructive-only deploy | `sf project deploy start --pre-destructive-changes d.xml --manifest destructiveChanges/package.xml --ignore-warnings` | `--pre-`/`--post-destructive-changes` |
| CI/CD checkout | `actions/checkout@v4` with `fetch-depth: 0` | full history required |
| Nested repo root | `sf sgd source delta -r ../.. -s salesforce/force-app` | `-r`/`--repo-dir` vs `-s`/`--source-dir` |
| API version override | `sf sgd source delta --api-version 61.0` | `-a`/`--api-version` (not `-v`) |

---

## External Resources

- [sfdx-git-delta on GitHub](https://github.com/scolladon/sfdx-git-delta) — source, full flag reference (`sf sgd source delta --help`), and advanced use-cases.
- [Optimizing Unpackaged Deployments Using a Delta Generation Tool](https://developer.salesforce.com/blogs/2021/01/optimizing-unpackaged-deployments-using-a-delta-generation-tool) — Salesforce Developers Blog background on the delta-deployment pattern this tool implements.
