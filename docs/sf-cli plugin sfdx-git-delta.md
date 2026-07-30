# SF CLI Plugin: sfdx-git-delta

## 1. Header & Overview

- **Category:** Incremental Deployment (CI/CD)
- **Primary Purpose:** Diffs two Git references and emits Salesforce-ready `package.xml` / `destructiveChanges.xml` manifests — turning "what changed between these two commits" into "exactly what to deploy and exactly what to delete." Without it, the only alternatives are deploying the *entire* `force-app` tree on every pipeline run (slow, and risky — it can silently redeploy or overwrite unrelated components) or hand-maintaining a manifest by memory (error-prone and unscalable). `sfdx-git-delta` (SGD) is what makes true incremental deployment practical.
- **Installation Command:**
  ```bash
  sf plugins install sfdx-git-delta
  ```
  Unsigned third-party plugin (maintainer: `scolladon`) — the README is explicit that this is **not an officially Salesforce-supported tool**, though it's widely used in production pipelines, including as the delta engine underneath `sfdx-hardis`.

---

## 2. Deep Dive: What It Does & Key Capabilities

**The underlying mechanic — Git diff mapped through the metadata registry, not text parsing.** SGD runs a `git diff` between a `--from` (base/older) and `--to` (target/newer, defaults to `HEAD`) ref, then maps every changed file path to a Salesforce metadata type using the same folder/suffix conventions the source format itself follows (an internal metadata registry, extensible via `--additional-metadata-registry`). Added/modified files become entries in `package/package.xml`; deleted or renamed files become entries in `destructiveChanges/destructiveChanges.xml`, alongside a companion minimal `package.xml` SGD always generates next to it (required because the Metadata API's destructive-changes deploy operation needs *some* `package.xml` present even for a pure-deletion deploy).
- **Why this beats a full-tree deploy:** a full deploy of `force-app` every time is slow at scale and carries real risk — it can re-trigger validation rules/flows tied to unrelated metadata, extend deploy windows unnecessarily, and makes "what did this deployment actually change" impossible to answer from the deploy log alone. A delta-based deploy only touches what the Git history says actually changed between two specific points.
- **Rename detection:** the `--changes-manifest` flag accepts a JSON file grouping changes explicitly by add/modify/delete/rename — enabling proper Git rename detection instead of SGD seeing a rename as an unrelated delete+add pair.
- **`--generate-delta` (`-d`) goes a step further than manifests:** because manifest-based deploy (`-x package.xml`) still deploys the **entire containing folder** for some metadata types (a Custom Object's whole folder redeploys even for a single changed field), `-d` additionally copies just the actual changed physical files into `--output-dir`, giving you a real, deployable source tree containing only what changed — for deploy modes where that surgical precision matters more than manifest simplicity.

---

## 3. Practical Usage Scenarios & Commands

**Command 1 — Feature branch vs. `origin/main` (the most common CI pattern):**
```bash
sf sgd source delta --to "HEAD" --from "origin/main" --output-dir .
```
Generates `./package/package.xml` and `./destructiveChanges/destructiveChanges.xml` (+ companion `package.xml`) for everything that differs between the current branch tip and `main`. **Use `origin/main`, not bare `main`**, in CI — a pipeline checkout typically only has the current branch checked out locally; other branches exist only as remote-tracking refs.

**Command 2 — Between two explicit commit SHAs:**
```bash
sf sgd source delta --from 61f235b1 --to fbc3ade6 --output-dir delta-output
```
`--from`/`--to` (`-f`/`-t`) accept any Git-resolvable pointer — a SHA, branch, tag, or relative expression (`HEAD~1`). Useful for reconstructing exactly what a specific past deployment contained, independent of any branch pointer's current position.

**Command 3 — Surgical file-level delta output (`--generate-delta`):**
```bash
mkdir changed-sources
sf sgd source delta --to "HEAD" --from "HEAD~1" --output-dir changed-sources/ --generate-delta
```
`-d/--generate-delta` is designed for `--to` being `HEAD` (i.e., your current working tree) — if you need it against a non-`HEAD` commit, `git checkout` that commit first and omit `--to` rather than passing an arbitrary value directly.

**Command 4 — Excluding paths with an ignore file:**
```bash
sf sgd source delta --to "HEAD" --from "origin/main" --output-dir . --ignore-file .deltaignore
```
`-i/--ignore-file` points at a plain gitignore-glob-syntax file (there is **no fixed required filename** — `.sgdignore` is just a common convention, not a hardcoded expectation; name it anything). A separate `-D/--ignore-destructive-file` lets you apply a *different* ignore list specifically to destructive-changes generation — e.g. to prevent SGD from ever generating a delete for a component your pipeline manages separately.

**Command 5 — Force-including paths regardless of the diff (`--include-file`):**
```bash
sf sgd source delta --to "HEAD" --from "origin/main" --output-dir . --include-file always-deploy.txt
```
`-n/--include-file` (and its destructive-only counterpart `-N/--include-destructive-file`) forces specific paths into the manifest even if Git's diff wouldn't otherwise flag them changed — useful for a component that must always redeploy alongside any change (e.g. a metadata type with cross-dependencies SGD's registry can't infer).

**Command 6 — CI/CD pipeline integration end-to-end:**
```bash
sf plugins install "sfdx-git-delta@${SGD_VERSION}"
sf sgd source delta --to "HEAD" --from "origin/main" --output-dir . --ignore-whitespace
sf project deploy start -x package/package.xml --post-destructive-changes destructiveChanges/destructiveChanges.xml
```
- Pin the installed version via a pipeline variable (`${SGD_VERSION}`) rather than always installing latest, for reproducible CI runs.
- `-W/--ignore-whitespace` excludes pure whitespace/EOL-only diffs from being treated as real changes — useful if your repo has had a line-ending normalization commit that would otherwise falsely flag a huge swath of files as "changed."
- The final `sf project deploy start` call is the actual incremental deploy, consuming exactly the manifests SGD generated.

---

## 4. Developer Workflow Integration

- **When to trigger it:** almost exclusively as a **CI/CD pipeline step**, immediately before the deploy step, comparing the branch under test/merge against its target branch — not something an individual developer runs interactively as part of normal local work (unlike, say, `sfdx-hardis`'s guided commands). It's the delta-generation engine a pipeline calls right before `sf project deploy start`/`sf project deploy validate`.
- **CI-specific setup requirements, easy to get wrong:**
  - **Shallow checkouts break it.** Most CI systems default to a shallow clone; SGD needs full history to diff correctly — configure a full fetch (e.g., GitHub Actions `fetch-depth: 0`).
  - **Reference remote branches with the `origin/` prefix** — a bare branch name like `main` typically only resolves for the currently-checked-out branch in a CI runner.
  - **Windows shell caveat:** avoid `HEAD^` — `^` is the Windows escape character and gets misinterpreted; use `HEAD~1` instead, which Git treats identically but which has no special meaning to `cmd.exe`/PowerShell.
  - **Git LFS:** SGD reads LFS content that's already present locally but will **not** fetch it from the LFS server itself — ensure LFS objects are pulled as part of checkout, before SGD runs, if your repo uses LFS.
- **Configuration files:** the ignore/include files (`-i`, `-D`, `-n`, `-N`) are the primary configuration surface — standard gitignore glob syntax, always Unix `/` path separators even on Windows runners. Keep them in the repo root and version-controlled alongside the pipeline definition that references them, since a change to what should be ignored is a deploy-behavior change worth reviewing in a PR.
- **Known edge cases / flags to be careful with:**
  - **`--generate-delta` and a non-`HEAD` `--to` don't mix** — `git checkout` first, then run with `--to` omitted, rather than fighting the tool's expectations.
  - **It's an unsigned, community-maintained (not Salesforce-supported) tool** — pin a known-good version in your pipeline, and always keep a working full-deploy fallback path available in case the incremental path misbehaves on an edge case (e.g. an unusual rename, or a metadata type not yet in its registry).
  - **`--changes-manifest` is the correct tool specifically for rename detection** — without it, a file rename is diffed as an unrelated delete+add pair, which can produce a spurious destructive-changes entry for a component that was never actually deleted.
