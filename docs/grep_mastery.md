# Grep & Ripgrep Mastery Guide for Salesforce Codebases

A production-grade reference for searching code and XML *content* across a Salesforce DX codebase — as opposed to locating files by name (see `find_mastery.md`). Whether you're tracing every reference to a custom field before a deprecation, auditing sharing-model declarations, or sweeping for hardcoded secrets, fast and precise content search across thousands of Apex classes and metadata XML files is essential for impact analysis, security review, and code cleanup.

---

## 0. Prerequisites

- **`grep`** ships out of the box on macOS, Linux, WSL, and Git Bash on Windows — no install needed. Note: macOS ships **BSD grep** by default, which lacks GNU-only flags like `-P` (PCRE). Installing GNU grep via `brew install grep` (aliased as `ggrep`) closes that gap.
- **`ripgrep`** (`rg`) is a modern, dramatically faster alternative that recursively searches by default, automatically respects `.gitignore`, and ships with full regex engine support (including `-P`/PCRE2 on all platforms). Install it with:
  ```bash
  # macOS
  brew install ripgrep

  # Windows (Chocolatey)
  choco install ripgrep

  # Windows (Scoop)
  scoop install ripgrep

  # Debian/Ubuntu
  sudo apt install ripgrep
  ```
- All examples assume you're running from the repository root, with `force-app/` as the metadata source directory using the standard SFDX package layout.

---

## 1. API Name Lookup (Custom Field References)

**SFDX Context:** Before renaming or deleting a custom field like `My_Field__c`, you need every reference to it — across Apex, triggers, Flow XML, layout XML, validation rules, and report/list-view filters — or the deploy/refactor will break something silently.

**Standard Command (`grep`):**
```bash
grep -rn "My_Field__c" force-app
```

**Modern Alternative (`rg`):**
```bash
rg -n "My_Field__c" force-app
```

**Syntax Breakdown:**
- `-r` — recursive: descend into subdirectories instead of only searching files passed explicitly. (`rg` is recursive by default, so no flag is needed.)
- `-n` — prefix each matching line with its line number, essential for jumping straight to the reference in an editor.
- Passing `force-app` as the final argument scopes the search to that directory tree only.

---

## 2. Annotation Search (`@AuraEnabled`, `@InvocableMethod`)

**SFDX Context:** Auditing which Apex methods are exposed to Lightning components (`@AuraEnabled`) or Flow (`@InvocableMethod`) is a common security and API-surface review task.

**Standard Command (`grep`):**
```bash
grep -rnE "@AuraEnabled|@InvocableMethod" force-app --include="*.cls"
```

**Modern Alternative (`rg`):**
```bash
rg -n "@AuraEnabled|@InvocableMethod" force-app -g "*.cls"
```

**Syntax Breakdown:**
- `-E` — enables **extended regex** (ERE), which allows `|` (alternation) and `+`/`?`/`{}` quantifiers without backslash-escaping. Without `-E`, plain `grep` (BRE) would require `\|` for alternation.
- `|` — regex alternation: matches either side of the pipe.
- `--include="*.cls"` — restrict the recursive search to files matching this glob (see Scenario 8 for a full treatment).
- `-g "*.cls"` — `rg`'s equivalent glob filter (can be repeated or negated with `!`).

---

## 3. Hardcoded IDs / URLs

**SFDX Context:** Hardcoded Salesforce record IDs (`001...` for Account, `003...` for Contact, etc.) or hardcoded instance URLs (`mycompany.my.salesforce.com`) are anti-patterns — they break across sandboxes/orgs and are a common code-review flag.

**Standard Command (`grep`):**
```bash
# 15 or 18-character Salesforce IDs starting with common object prefixes
grep -rnE "\b(001|003|00Q|500)[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?\b" force-app

# Hardcoded Salesforce instance URLs
grep -rnE "https?://[a-zA-Z0-9.-]+\.salesforce\.com" force-app
```

**Modern Alternative (`rg`):**
```bash
rg -n "\b(001|003|00Q|500)[a-zA-Z0-9]{12}([a-zA-Z0-9]{3})?\b" force-app
rg -n "https?://[a-zA-Z0-9.-]+\.salesforce\.com" force-app
```

**Syntax Breakdown:**
- `\b` — word boundary; prevents matching the ID pattern in the middle of a longer alphanumeric string.
- `(001|003|00Q|500)` — alternation group for known object key prefixes (`001`=Account, `003`=Contact, `00Q`=Lead, `500`=Case).
- `[a-zA-Z0-9]{12}` — matches the next 12 alphanumeric characters (completing a 15-char ID).
- `([a-zA-Z0-9]{3})?` — optional group matching the extra 3-character case-safe suffix on an 18-char ID.
- `-E` is required for `grep` here because `{}` interval quantifiers and `?`/`|` are ERE syntax; `rg` uses Rust's regex crate, which supports this syntax without any extra flag.

---

## 4. List Only Matching Files (`-l`)

**SFDX Context:** You need a clean list of every file that references a given permission or component name — e.g., every Permission Set that grants `Modify_All_Data__c` — to feed into a script or a PR description, without the noise of matched line content.

**Standard Command (`grep`):**
```bash
grep -rl "Modify_All_Data__c" force-app/main/default/permissionsets
```

**Modern Alternative (`rg`):**
```bash
rg -l "Modify_All_Data__c" force-app/main/default/permissionsets
```

**Syntax Breakdown:**
- `-l` (`--files-with-matches`) — print only the path of each file containing at least one match, one path per line; suppresses line content and line numbers entirely.
- Pairs well with `xargs` for follow-up batch actions: `grep -rl "..." force-app | xargs code` opens every matching file in your editor.

---

## 5. Inverse Match — Filtering Out (`-v`)

**SFDX Context:** You want to review Apex lines that reference logging-adjacent code but explicitly are *not* `System.debug` calls (e.g., custom logging framework calls) — or conversely, audit every Apex file for logic that *lacks* debug statements before a refactor.

**Standard Command (`grep`):**
```bash
grep -rn "log\." force-app --include="*.cls" | grep -v "System.debug"
```

**Modern Alternative (`rg`):**
```bash
rg -n "log\." force-app -g "*.cls" | rg -v "System.debug"
```

**Syntax Breakdown:**
- `-v` (`--invert-match`) — print lines that **do not** match the given pattern, inverting normal grep behavior.
- Chaining two greps (first find candidate lines, then invert-filter out the noise pattern) is a common idiom for "A but not B" searches that a single regex can't cleanly express.

---

## 6. Contextual Search (`-C 3`)

**SFDX Context:** When investigating a match — e.g., a suspicious `insert` DML statement — you want to see the surrounding logic (was it wrapped in a `try/catch`? inside a loop?) without opening the full file.

**Standard Command (`grep`):**
```bash
grep -rn -C 3 "insert newAccount" force-app --include="*.cls"
```

**Modern Alternative (`rg`):**
```bash
rg -n -C 3 "insert newAccount" force-app -g "*.cls"
```

**Syntax Breakdown:**
- `-C N` (`--context=N`) — show N lines of context both **before and after** each match.
- `-A N` (`--after-context`) — show only N lines *after* the match.
- `-B N` (`--before-context`) — show only N lines *before* the match.
- Both `grep` and `rg` support identical `-A`/`-B`/`-C` semantics.

---

## 7. Regex Matching — Deprecated API Versions (`-E`)

**SFDX Context:** Salesforce periodically deprecates old API versions. You want to flag every metadata XML file still declaring an old `<apiVersion>` — say, anything below 56.0 — to prioritize an API version bump project.

**Standard Command (`grep`):**
```bash
# Single digit major versions (e.g., <apiVersion>4</apiVersion> — malformed/ancient)
grep -rnE "<apiVersion>[0-9]</apiVersion>" force-app --include="*.xml"

# Versions in the 50.0 through 55.0 range specifically
grep -rnE "<apiVersion>5[0-5]\.0</apiVersion>" force-app --include="*.xml"
```

**Modern Alternative (`rg`):**
```bash
rg -n "<apiVersion>[0-9]</apiVersion>" force-app -g "*.xml"
rg -n "<apiVersion>5[0-5]\.0</apiVersion>" force-app -g "*.xml"
```

**Syntax Breakdown:**
- `-E` — required by `grep` to interpret `[0-5]` character-class ranges and keep the pattern readable; `rg` needs no extra flag.
- `[0-5]` — character class matching a single digit 0 through 5, so `5[0-5]\.0` matches `50.0` through `55.0`.
- `\.` — escapes the literal dot (an unescaped `.` matches *any* character in regex).
- This pattern is exact-match only; for a true numeric *range* comparison (e.g., "anything less than 56.0" regardless of digit count), a regex alone is insufficient — pipe results through `awk`/`sort -V` for genuine numeric comparison across differing digit lengths.

---

## 8. Restricting File Types (`--include`)

**SFDX Context:** You only care about matches inside Permission Set metadata — not Profiles, not Apex, not anything else — e.g., auditing every `<field>` permission grant across all Permission Sets.

**Standard Command (`grep`):**
```bash
grep -rn "editable>true" force-app --include="*.permissionset-meta.xml"
```

**Modern Alternative (`rg`):**
```bash
rg -n "editable>true" force-app -g "*.permissionset-meta.xml"
```

**Syntax Breakdown:**
- `--include="<glob>"` — restricts a recursive `grep` to only search files whose name matches the glob; can be repeated for multiple patterns (`--include="*.cls" --include="*.trigger"`).
- `-g "<glob>"` — `rg`'s equivalent; prefix with `!` to exclude instead (`-g "!*.xml"`), which `grep`'s `--include` cannot do directly (that requires `--exclude`, see below).

---

## 9. Excluding Noise Folders (`--exclude-dir`)

**SFDX Context:** Local Salesforce CLI scratch/config directories (`.sfdx/`, `.sf/`), version control internals (`.git/`), and test coverage reports (`coverage/`) should never pollute search results, especially in scripted/CI contexts.

**Standard Command (`grep`):**
```bash
grep -rn "My_Field__c" . --exclude-dir=".sfdx" --exclude-dir=".sf" --exclude-dir=".git" --exclude-dir="coverage"
```

**Modern Alternative (`rg`):**
```bash
rg -n "My_Field__c" . --glob '!.sfdx' --glob '!.sf' --glob '!.git' --glob '!coverage'
```

**Syntax Breakdown:**
- `--exclude-dir=<name>` — skip any directory matching `<name>` entirely during the recursive walk; repeatable for multiple directories.
- `rg` auto-excludes `.git` and anything listed in `.gitignore` by default, so in practice only `.sfdx`, `.sf`, and non-gitignored noise dirs typically need explicit `--glob '!...'` exclusions.
- `--glob '!<pattern>'` — the `!` prefix negates the glob, telling `rg` to exclude matching paths.

---

## 10. Case-Insensitive Logic (`-i`)

**SFDX Context:** Auditing sharing model declarations (`with sharing`, `without sharing`, `inherited sharing`) across Apex classes — developers are inconsistent about casing, and a security review can't afford to miss a match due to `With Sharing` vs `with sharing`.

**Standard Command (`grep`):**
```bash
grep -rniE "with sharing|without sharing|inherited sharing" force-app --include="*.cls"
```

**Modern Alternative (`rg`):**
```bash
rg -ni "with sharing|without sharing|inherited sharing" force-app -g "*.cls"
```

**Syntax Breakdown:**
- `-i` (`--ignore-case`) — matches regardless of letter casing.
- Combining `-n` (line numbers) with `-i` and `-E` (alternation) is a common trio for compliance-style audits.
- `rg` is "smart case" by default (case-sensitive only if the pattern contains an uppercase letter) — passing `-i` forces case-insensitivity explicitly regardless of pattern casing.

---

## 11. Count Matches (`-c`)

**SFDX Context:** Quantifying technical debt — e.g., "how many `System.debug` calls exist across the codebase" (a cleanup metric before a performance push) or "how many `@IsTest` classes do we have" (a coverage/test-count sanity check).

**Standard Command (`grep`):**
```bash
# Per-file match counts
grep -rc "System.debug" force-app --include="*.cls"

# Grand total across the entire project
grep -ro "System.debug" force-app --include="*.cls" | wc -l
```

**Modern Alternative (`rg`):**
```bash
rg -c "System.debug" force-app -g "*.cls"

# Grand total with rg's built-in stats mode
rg --stats "System.debug" force-app -g "*.cls" | tail -5
```

**Syntax Breakdown:**
- `-c` (`--count`) — **important nuance:** this prints the number of *matching lines per file*, not a project-wide total, and not the number of matches per line. A file with `System.debug` appearing twice on one line still counts as `1` under `-c`.
- `-o` (`--only-matching`) — prints only the matched text itself (one per line, including multiple matches per line), which is why piping `-ro ... | wc -l` gives a true total occurrence count rather than a matching-line count.
- `rg --stats` — appends a summary block (total matches, matched lines, files searched) after normal output; `tail -5` trims to just that summary.

---

## 12. SOQL Search (Inline Queries)

**SFDX Context:** Finding every inline SOQL query in Apex — e.g., to audit for queries inside loops (a classic governor-limit anti-pattern) or to inventory which objects/fields are queried before a schema change.

**Standard Command (`grep`):**
```bash
grep -rniE "SELECT .* FROM [A-Za-z_]+" force-app --include="*.cls"
```

**Modern Alternative (`rg`):**
```bash
rg -ni "SELECT .* FROM [A-Za-z_]+" force-app -g "*.cls"

# Multiline queries that span several lines (formatted SOQL) need PCRE2 + dot-matches-newline
rg -niU --multiline-dotall "SELECT[\s\S]*?FROM\s+[A-Za-z_]+" force-app -g "*.cls"
```

**Syntax Breakdown:**
- `SELECT .* FROM [A-Za-z_]+` — a pragmatic (not fully SOQL-grammar-correct) pattern: `.*` greedily matches everything between `SELECT` and `FROM` on the same line, then `[A-Za-z_]+` captures the object name.
- `-i` — SOQL keywords are case-insensitive in Salesforce (`select`/`SELECT`/`Select` are all valid), so this flag is essential, not optional, here.
- **Caveat:** plain line-based `grep`/`rg` matching cannot see across line breaks. A SOQL query formatted across multiple lines (common with long field lists) will only partially match or be missed entirely with the basic pattern above.
- `-U` (`--multiline`) — enables `rg`'s multiline mode, allowing a pattern to span multiple lines.
- `--multiline-dotall` — makes `.` match newlines too (otherwise even in multiline mode, `.` still stops at line boundaries).
- `[\s\S]*?` — a non-greedy "match anything including newlines" idiom, used instead of `.*?` specifically because it works even without dotall mode enabled, and the `?` keeps it from over-matching into a *second* query further down the file.
- Standard POSIX `grep` has no multiline mode at all — this capability is unique to `rg` (or requires piping through `perl`/`pcregrep`).

---

## Bonus Scenarios

### A. Search Only Within Git-Changed Files

**SFDX Context:** During code review or a pre-deploy check, restrict a content search to just the files changed on the current branch — not the entire codebase — e.g., confirming no new `System.debug` calls were introduced.

```bash
git diff --name-only origin/main...HEAD -- force-app | xargs grep -n "System.debug"
```
```bash
git diff --name-only origin/main...HEAD -- force-app | xargs rg -n "System.debug"
```
- `xargs` feeds the list of changed file paths from `git diff` directly as arguments to `grep`/`rg`, scoping the content search to exactly what changed.

### B. Code-Hygiene Sweep (TODO/FIXME/Secret Smells)

**SFDX Context:** A lightweight pre-release sweep for leftover TODO markers or accidentally committed credentials.

```bash
grep -rniE "TODO|FIXME|password\s*=|api[_-]?key\s*=" force-app --include="*.cls"
```
```bash
rg -ni "TODO|FIXME|password\s*=|api[_-]?key\s*=" force-app -g "*.cls"
```
- `password\s*=` and `api[_-]?key\s*=` are heuristic patterns catching common hardcoded-secret assignment styles (`password=`, `password =`, `api_key=`, `apiKey =`) — not a substitute for a dedicated secret scanner, but a fast first pass.

### C. Whole-Word Matching (`-w`)

**SFDX Context:** Searching for the object `Account` without also matching `AccountTrigger`, `AccountService`, or `ParentAccount__c` — i.e., only the exact standalone token.

```bash
grep -rnw "Account" force-app --include="*.cls"
```
```bash
rg -nw "Account" force-app -g "*.cls"
```
- `-w` (`--word-regexp`) — wraps the pattern in implicit word boundaries, equivalent to `\bAccount\b`, so only the exact token matches, not substrings inside longer identifiers.

### D. Match Hotspot Report (Files Ranked by Match Frequency)

**SFDX Context:** Before refactoring a heavily-used utility method, identify which files reference it most, to prioritize review order.

```bash
grep -rno "MyUtilityClass\." force-app --include="*.cls" | cut -d: -f1 | sort | uniq -c | sort -rn
```
- `cut -d: -f1` — extracts just the filename portion from `grep -n` output (`file:line:match` → `file`).
- `sort | uniq -c` — counts occurrences per unique filename; the final `sort -rn` ranks files by descending match count, producing a quick "hotspot" list.

### E. Multiline / PCRE2 Search for Cross-Line Patterns

**SFDX Context:** Beyond SOQL (Scenario 12), any pattern that might span line breaks — e.g., a multi-line `@InvocableMethod` annotation with parameters on the next line, or a multi-line comment block containing a flagged keyword.

```bash
rg -U --multiline-dotall "@InvocableMethod[\s\S]*?\)" force-app -g "*.cls"
```
- Plain `grep` (even GNU grep with `-P`) has no true multiline mode — this is a `rg`-exclusive capability (`-U`) and is the primary reason to reach for `rg` over `grep` when a pattern isn't guaranteed to sit on a single line.

---

## Summary Cheat Sheet

| Scenario | `grep` | `rg` |
|---|---|---|
| API name lookup | `grep -rn "My_Field__c" force-app` | `rg -n "My_Field__c" force-app` |
| Annotation search | `grep -rnE "@AuraEnabled\|@InvocableMethod" force-app` | `rg -n "@AuraEnabled\|@InvocableMethod" force-app` |
| Hardcoded IDs/URLs | `grep -rnE "\b00[13Q][a-zA-Z0-9]{12,15}\b" force-app` | `rg -n "\b00[13Q][a-zA-Z0-9]{12,15}\b" force-app` |
| List matching files | `grep -rl "term" force-app` | `rg -l "term" force-app` |
| Inverse match | `grep -v "System.debug"` | `rg -v "System.debug"` |
| Contextual search | `grep -C 3 "term" force-app` | `rg -C 3 "term" force-app` |
| Regex matching | `grep -E "5[0-5]\.0" force-app` | `rg "5[0-5]\.0" force-app` |
| Restrict file types | `grep -r "term" --include="*.permissionset-meta.xml"` | `rg "term" -g "*.permissionset-meta.xml"` |
| Exclude noise folders | `grep -r "term" --exclude-dir=.sfdx --exclude-dir=.git` | `rg "term" --glob '!.sfdx' --glob '!.git'` |
| Case-insensitive | `grep -i "with sharing"` | `rg -i "with sharing"` |
| Count matches | `grep -c "System.debug"` | `rg -c "System.debug"` |
| SOQL search | `grep -niE "SELECT .* FROM [A-Za-z_]+"` | `rg -niU --multiline-dotall "SELECT[\s\S]*?FROM\s+[A-Za-z_]+"` |

---

## External Resources

- [ripgrep on GitHub](https://github.com/BurntSushi/ripgrep) — source, install instructions, full flag and regex-syntax reference.
- [GNU grep manual](https://www.gnu.org/software/grep/manual/grep.html) — authoritative `grep` documentation, including BRE/ERE regex syntax differences.
