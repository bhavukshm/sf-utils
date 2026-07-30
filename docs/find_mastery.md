# Find & `fd` Mastery Guide for Salesforce DX Repositories

A production-grade reference for locating files and directories inside a Salesforce DX metadata tree (`force-app/`). As orgs grow, `force-app/main/default/` can accumulate thousands of classes, triggers, flows, layouts, and LWC/Aura bundles — knowing how to slice through that tree with `find` (and its faster modern cousin, `fd`) is a core DevOps skill for CI scripts, pre-commit hooks, and everyday cleanup.

---

## 0. Prerequisites

- **`find`** ships out of the box on macOS, Linux, WSL, and Git Bash on Windows — no install needed.
- **`fd`** (a.k.a. `fd-find`) is a modern, friendlier alternative with sane defaults (ignores `.git` and respects `.gitignore` automatically, colorized output, simpler flags). Install it with:
  ```bash
  # macOS
  brew install fd

  # Windows (Chocolatey)
  choco install fd

  # Windows (Scoop)
  scoop install fd

  # Debian/Ubuntu
  sudo apt install fd-find
  ```
- All examples below assume you are running commands from the repository root, with `force-app/` as the metadata source directory. Paths shown (e.g., `force-app/main/default/classes`) are the standard SFDX package directory layout.

---

## 1. Find Files By Extension (Apex Classes, Triggers, Flows)

**SFDX Context:** The most common lookup — pulling every Apex class, trigger, or Flow definition regardless of which folder it lives in.

**Standard Command (`find`):**
```bash
# All Apex classes
find force-app -type f -name "*.cls"

# All Apex triggers
find force-app -type f -name "*.trigger"

# All Flow metadata definitions
find force-app -type f -name "*.flow-meta.xml"
```

**Modern Alternative (`fd`):**
```bash
fd -e cls . force-app
fd -e trigger . force-app
fd '.*\.flow-meta\.xml$' force-app
```

**Syntax Breakdown:**
- `-type f` — restrict matches to regular files (excludes directories).
- `-name "*.cls"` — glob-style match against the filename only (case-sensitive).
- `fd -e cls` — `-e`/`--extension` filters by file extension; simpler than a glob for the common case.
- `fd '.*\.flow-meta\.xml$'` — for compound extensions like `.flow-meta.xml`, a regex pattern is more reliable than `-e` since `fd` treats extension as "the last dot segment" by default.

---

## 2. Case-Insensitive Search

**SFDX Context:** Metadata naming isn't always consistent — `Account`, `account`, and `ACCOUNT_Trigger` might all be valid targets when you're auditing everything related to a given object.

**Standard Command (`find`):**
```bash
find force-app -iname "*account*"
```

**Modern Alternative (`fd`):**
```bash
fd -i 'account' force-app
```

**Syntax Breakdown:**
- `-iname` — identical to `-name` but matches case-insensitively (`Account`, `ACCOUNT`, `account` all match).
- `fd -i` / `--ignore-case` — forces case-insensitive matching (by default `fd` is "smart case": case-insensitive unless your pattern contains an uppercase letter).

---

## 3. Find Files In a Specific Subdirectory

**SFDX Context:** You only want Page Layout metadata, and only from the layouts directory — not layout references that might appear elsewhere (e.g., inside profile XML).

**Standard Command (`find`):**
```bash
find force-app/main/default/layouts -type f -name "*.layout-meta.xml"
```

**Modern Alternative (`fd`):**
```bash
fd -e xml . force-app/main/default/layouts
```

**Syntax Breakdown:**
- Passing the target directory as `find`'s first positional argument scopes the entire search — `find` never looks outside it.
- `fd` behaves the same way: the search path is a positional argument after the pattern (`fd <pattern> <path>`).

---

## 4. Limit Search By Depth (`-maxdepth`)

**SFDX Context:** You want to see only the top-level metadata *type* folders (`classes/`, `objects/`, `triggers/`, `layouts/`, …) without descending into their contents — useful for a quick inventory of what metadata types exist in the package.

**Standard Command (`find`):**
```bash
find force-app/main/default -maxdepth 1 -type d
```

**Modern Alternative (`fd`):**
```bash
fd --max-depth 1 --type d . force-app/main/default
```

**Syntax Breakdown:**
- `-maxdepth 1` — limits recursion to N levels below the starting directory. `-maxdepth 1` means "only direct children," `-maxdepth 0` means "only the starting path itself."
- `-type d` — restrict matches to directories (use `-type f` for files, `-type l` for symlinks).
- `fd --max-depth 1 --type d` — same semantics; `fd` also supports `--min-depth` for the inverse (skip shallow results).

---

## 5. Find Recently Modified Metadata

**SFDX Context:** Before a deploy or PR, you want to double-check exactly which metadata files you (or a teammate) touched in the last couple hours, day, or week.

**Standard Command (`find`):**
```bash
# Modified in the last 2 hours (120 minutes)
find force-app -type f -mmin -120

# Modified in the last 24 hours
find force-app -type f -mtime -1

# Modified in the last 7 days
find force-app -type f -mtime -7
```

**Modern Alternative (`fd`):**
```bash
fd --changed-within 2h --type f . force-app
fd --changed-within 1d --type f . force-app
fd --changed-within 7d --type f . force-app
```

**Syntax Breakdown:**
- `-mmin -N` — modified within the last N *minutes*. The leading `-` means "less than N minutes ago" (use `+N` for "more than N minutes ago," bare `N` for "exactly N").
- `-mtime -N` — modified within the last N *days* (24-hour blocks), same `-`/`+`/bare convention.
- `fd --changed-within` — accepts human-friendly durations directly (`2h`, `1d`, `7d`, or an absolute date like `2026-07-01`), avoiding the minute/day unit-juggling `find` requires.

---

## 6. Find Large Metadata Files (By Size)

**SFDX Context:** Bloated `*.labels-meta.xml` files or Profile XMLs (which can balloon past several MB with every field/object permission) slow down deploys and retrievals — worth flagging for cleanup or splitting.

**Standard Command (`find`):**
```bash
# Files larger than 1MB anywhere in force-app
find force-app -type f -size +1M

# Specifically large profiles
find force-app/main/default/profiles -type f -name "*.profile-meta.xml" -size +1M
```

**Modern Alternative (`fd`):**
```bash
fd --type f --size +1m . force-app
```

**Syntax Breakdown:**
- `-size +1M` — matches files larger than 1 megabyte. Suffixes: `c` (bytes), `k` (kilobytes), `M` (megabytes), `G` (gigabytes). `+` means "greater than," `-` means "less than."
- `fd --size +1m` — same idea; `fd` lowercases the unit but accepts the same `+`/`-` prefixes.

---

## 7. Find Empty Files or Directories

**SFDX Context:** Bad refactors or half-finished metadata deletions often leave behind zero-byte `.cls` files or empty folders (e.g., an `aura/` bundle folder with all its files removed but the directory left dangling).

**Standard Command (`find`):**
```bash
# Empty Apex class files
find force-app -type f -name "*.cls" -empty

# Empty directories anywhere in the metadata tree
find force-app -type d -empty
```

**Modern Alternative (`fd`):**
```bash
fd -e cls --type empty . force-app
fd --type empty --type directory . force-app
```

**Syntax Breakdown:**
- `-empty` — matches files with zero bytes, or directories with zero entries.
- `fd --type empty` — matches empty files *or* directories; combine with `--type directory`/`--type file` to narrow to one kind.

---

## 8. Find Files By Multiple Extensions

**SFDX Context:** A single sweep for both Apex classes and triggers — e.g., feeding a linter or a bulk formatter that handles both.

**Standard Command (`find`):**
```bash
find force-app -type f \( -name "*.cls" -o -name "*.trigger" \)
```

**Modern Alternative (`fd`):**
```bash
fd -e cls -e trigger . force-app
```

**Syntax Breakdown:**
- `\( ... -o ... \)` — groups an OR (`-o`) expression; the escaped parentheses are required so the shell doesn't interpret them, and grouping is required because `find`'s expression evaluates left-to-right without implicit precedence.
- `fd -e cls -e trigger` — each `-e` adds another extension to match; far more readable than the `find` equivalent.

---

## 9. Exclude Folders (`.sfdx`, `.sf`, `.git`, `node_modules`)

**SFDX Context:** Local CLI scratch/config directories (`.sfdx/`, `.sf/`) and dependency folders (`node_modules/`) are not real metadata and should never appear in search results, especially when scripting.

**Standard Command (`find`):**
```bash
find . \( -path "*/.sfdx" -o -path "*/.sf" -o -path "*/.git" -o -path "*/node_modules" \) -prune -o -type f -name "*.cls" -print
```

**Modern Alternative (`fd`):**
```bash
fd -e cls --exclude .sfdx --exclude .sf --exclude .git --exclude node_modules .
```

**Syntax Breakdown:**
- `-prune` — tells `find` to not descend into a matched directory at all (far more efficient than filtering results afterward with `-not -path`, since pruned directories are skipped entirely rather than walked and discarded).
- `-o` between the prune clause and the real search — reads as "if it matches an excluded path, prune it; **otherwise**, apply the real filter and print."
- `fd --exclude <glob>` — much simpler; `fd` also auto-respects `.gitignore`/`.fdignore` by default, so `node_modules` is typically already excluded without any flag if it's gitignored.

---

## 10. Execute Actions On Found Files

**SFDX Context:** Batch-inspecting or reformatting every metadata sidecar file — e.g., listing details for every `*-meta.xml` file, or running Prettier across all Apex/XML in one pass.

**Standard Command (`find`):**
```bash
# Long-listing every *-meta.xml file
find force-app -type f -name "*-meta.xml" -exec ls -la {} \;

# Format every matched file with Prettier
find force-app -type f \( -name "*.cls" -o -name "*.xml" \) -exec npx prettier --write {} \;
```

**Modern Alternative (`fd`):**
```bash
fd '.*-meta\.xml$' force-app -x ls -la {}
fd -e cls -e xml . force-app -x npx prettier --write {}
```

**Syntax Breakdown:**
- `-exec <command> {} \;` — runs `<command>` once *per matched file*, with `{}` substituted for the file path; the escaped `;` terminates the command. Slower for large trees since a new process launches per file.
- `-exec <command> {} +` — the `+` variant batches as many matches as possible into a single command invocation (like `xargs`), which is significantly faster for bulk operations.
- `fd -x <command> {}` — `fd`'s equivalent of `-exec ... \;` (one process per match); use `-X` instead of `-x` for the batched/`+`-style behavior.

---

## 11. Find Orphaned Metadata (Apex Test Classes Missing Their `-meta.xml`)

**SFDX Context:** Every `.cls` file needs a matching `.cls-meta.xml` sidecar to deploy correctly. A bad merge or manual file copy can leave a `*Test.cls` without its meta XML, which will fail deployment. This scenario needs a *diff* between two file listings, not a single `find` filter.

**Standard Command (`find` + shell):**
```bash
find force-app -type f -name "*Test.cls" | while read -r cls; do
  meta="${cls}-meta.xml"
  [ -f "$meta" ] || echo "Missing meta XML: $cls"
done
```

**Modern Alternative (`fd` + shell):**
```bash
fd '.*Test\.cls$' force-app | while read -r cls; do
  [ -f "${cls}-meta.xml" ] || echo "Missing meta XML: $cls"
done
```

**Syntax Breakdown:**
- Neither `find` nor `fd` can natively express "file A exists but its counterpart file B does not" — that requires iterating matches and testing for the paired file, so both commands are piped into a shell loop.
- `[ -f "$meta" ]` — POSIX test for "is this a regular file"; `||` triggers the `echo` only when the test fails (i.e., the sidecar is missing).
- This same pattern inverts cleanly for orphaned meta files (see Bonus Scenario B below).

---

## 12. Find Files Changed Relative to Git

**SFDX Context:** In a CI pipeline or pre-deploy check, you want exactly the metadata files that changed on this branch vs. `main` — not the entire tree — filtered to deployable extensions.

**Standard Command (`git` + `find -newer` fallback):**
```bash
# Preferred: ask Git directly for changed files, filtered to metadata extensions
git diff --name-only origin/main...HEAD -- force-app | grep -E '\.(cls|trigger|xml)$'

# Non-git fallback: files newer than a reference file/timestamp (e.g., last deploy marker)
find force-app -type f -newer .last_deploy_marker \( -name "*.cls" -o -name "*.trigger" \)
```

**Modern Alternative (`fd` for local uncommitted changes):**
```bash
# Uncommitted/staged changes only, cross-referenced with fd's extension filter
git status --porcelain -- force-app | awk '{print $2}' | fd -e cls -e trigger -e xml --exec-batch echo
```

**Syntax Breakdown:**
- `git diff --name-only A...B` — lists only file paths that differ between two refs; `...` (triple-dot) compares against the merge-base rather than `B`'s tip, which is what you want for "what did this branch add since it diverged from main."
- `-newer <reference_file>` — matches files modified more recently than the reference file's mtime; useful when there's no Git history to compare against (e.g., comparing to a deployment timestamp file).
- Piping `git status`/`git diff` output through `grep`/`fd` lets you reuse the same extension-filtering logic from Scenario 8 on top of Git's authoritative change list — Git knows *what changed*, `find`/`fd` filters *which of those matter*.

---

## Bonus Scenarios

### A. Find Duplicate-Named Metadata Across Folders

**SFDX Context:** The same Apex class name appearing in two different package directories (common in multi-package SFDX projects) causes ambiguous deploys.

```bash
find force-app -type f -name "*.cls" -exec basename {} \; | sort | uniq -d
```
- `-exec basename {} \;` strips each match down to just its filename; `sort | uniq -d` then reports any filename that appears more than once.

### B. Find Orphaned Meta-XML Files (Reverse of Scenario 11)

**SFDX Context:** A `.cls-meta.xml` left behind after its `.cls` was deleted — the mirror-image problem of Scenario 11.

```bash
find force-app -type f -name "*.cls-meta.xml" | while read -r meta; do
  cls="${meta%-meta.xml}"
  [ -f "$cls" ] || echo "Orphaned meta file: $meta"
done
```
- `${meta%-meta.xml}` — shell parameter expansion that strips the trailing `-meta.xml` suffix to reconstruct the expected base filename.

### C. Find LWC/Aura Bundles By Component Name Pattern

**SFDX Context:** Locating every Lightning Web Component or Aura bundle whose name matches a pattern (e.g., everything prefixed `qa` during a QA-tooling audit).

```bash
find force-app/main/default/lwc -maxdepth 1 -type d -iname "qa*"
```
```bash
fd --max-depth 1 --type d -i '^qa' force-app/main/default/lwc
```
- LWC/Aura components are directories (bundles), so `-type d` at `-maxdepth 1` under `lwc/` or `aura/` lists bundle names directly rather than their internal files.

### D. Quick Metadata Inventory (Count Files Per Type)

**SFDX Context:** A fast sanity check of how much metadata of each type exists before planning a large refactor or migration.

```bash
for dir in force-app/main/default/*/; do
  echo "$(find "$dir" -type f | wc -l)  $dir"
done | sort -rn
```
- Loops each top-level metadata folder, counts its files, and sorts descending — an instant "where's most of the metadata concentrated" view.

### E. Parallelize Bulk Operations with `xargs`

**SFDX Context:** Running an expensive per-file operation (e.g., XML validation or a linter) across thousands of metadata files benefits heavily from parallel execution.

```bash
find force-app -type f -name "*.xml" -print0 | xargs -0 -P 8 -I{} xmllint --noout {}
```
```bash
fd -e xml . force-app -j 8 -x xmllint --noout {}
```
- `-print0` / `xargs -0` — null-delimits filenames so paths containing spaces are handled safely (plain newline-delimited output can break on such paths).
- `xargs -P 8` — runs up to 8 processes concurrently. `fd -j 8` (`--threads`) achieves the same parallelism natively without piping through `xargs`.

---

## Summary Cheat Sheet

| Scenario | `find` | `fd` |
|---|---|---|
| By extension | `find force-app -name "*.cls"` | `fd -e cls . force-app` |
| Case-insensitive | `find force-app -iname "*account*"` | `fd -i account force-app` |
| Specific subdirectory | `find force-app/.../layouts -name "*.xml"` | `fd . force-app/.../layouts` |
| Limit depth | `find force-app/main/default -maxdepth 1 -type d` | `fd --max-depth 1 --type d . force-app/main/default` |
| Modified recently | `find force-app -mtime -1` | `fd --changed-within 1d force-app` |
| By size | `find force-app -size +1M` | `fd --size +1m force-app` |
| Empty files/dirs | `find force-app -empty` | `fd --type empty force-app` |
| Multiple extensions | `find force-app \( -name "*.cls" -o -name "*.trigger" \)` | `fd -e cls -e trigger . force-app` |
| Exclude folders | `find . -path "*/node_modules" -prune -o -print` | `fd --exclude node_modules --exclude .sfdx .` |
| Exec action | `find force-app -name "*-meta.xml" -exec ls -la {} \;` | `fd -e xml force-app -x ls -la {}` |
| Orphaned test classes | `find ... \| while read; do [ -f meta ] \|\| echo; done` | same pattern with `fd` |
| Git-relative changes | `git diff --name-only origin/main...HEAD -- force-app` | pipe through `fd`/`grep` for extension filtering |

---

## External Resources

- [`fd` on GitHub](https://github.com/sharkdp/fd) — source, install instructions, full flag reference.
- [GNU findutils manual](https://www.gnu.org/software/findutils/manual/html_mono/find.html) — authoritative `find` documentation.
