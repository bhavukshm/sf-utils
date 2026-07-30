# Awk Mastery Guide for Salesforce Metadata & CLI Output

A production-grade reference for processing, extracting, and summarizing structured text across a Salesforce DX codebase — metadata file paths, Apex source, debug logs, CLI JSON/CSV output. Where `grep_mastery.md` finds matching lines and `sed_mastery.md` rewrites them, `awk` is the tool for the next step: parsing structure out of a line (columns, tags, paths) and aggregating it into a report — line counts, per-type tallies, coverage summaries, duplicate detection.

---

## 0. Prerequisites & Which `awk` Are You Running?

- **`awk`** ships on every Unix-like system, but — much like `sed`'s GNU/BSD split — there isn't one `awk`. Three lineages exist in practice:
  - **POSIX awk / "one true awk" (`nawk`/`bwk`)** — the baseline; what macOS ships as `/usr/bin/awk`.
  - **GNU awk (`gawk`)** — the most common on Linux; adds extensions like `ENDFILE`, `FPAT`, `asort()`, `gensub()`, and in-place editing (`-i inplace`).
  - **`mawk`** — a fast, minimal implementation sometimes used as the Debian/Ubuntu default `awk`.
  - Scripts using only `BEGIN`/`END`, `FS`/`OFS`, `NR`/`NF`/`FNR`, field variables (`$1`...`$NF`), and standard string functions (`sub`, `gsub`, `split`, `printf`) are portable across all three. This guide flags the few spots where a `gawk`-only extension is used, and gives a portable fallback.
  - Install `gawk` explicitly for full-featured scripting: `brew install gawk` / `sudo apt install gawk` / `choco install gawk`.
- **`jq`** is the correct tool for real JSON (`sf` CLI `--json` output) — `awk` is line/column-oriented and has no concept of nested JSON structure. Install with `brew install jq` / `choco install jq` / `sudo apt install jq`.
- All examples assume you're running from the repository root, with `force-app/` as the metadata source directory in the standard SFDX package layout.

---

## 1. Extracting Object Names from Metadata Paths

**SFDX Context:** Given a field metadata path like `force-app/main/default/objects/Account/fields/Type__c.field-meta.xml`, pull out just the object name (`Account`) — e.g., to build a per-object change inventory from a list of touched files.

**Standard Command (`awk`):**
```bash
echo "force-app/main/default/objects/Account/fields/Type__c.field-meta.xml" | \
  awk -F'/' '{ for (i=1; i<=NF; i++) if ($i == "objects") print $(i+1) }'
```

**Modern Alternative (`ripgrep` piped):**
```bash
echo "force-app/main/default/objects/Account/fields/Type__c.field-meta.xml" | \
  rg -o 'objects/([^/]+)/' -r '$1'
```

**Deep Syntax Breakdown:**
- `-F'/'` — sets the **field separator (`FS`)** to `/`, so `awk` splits each input line into fields at every slash. This is the awk equivalent of `-F` in other tools you've seen in this series, but here it directly controls how `$1`, `$2`, etc. are populated.
- `NF` (**Number of Fields**) — the count of fields on the *current* line after splitting; the `for` loop runs `i` from `1` to `NF` to scan every path segment.
- `$i` / `$(i+1)` — **field variables**: `$i` retrieves the *value* of the field at position `i`. Awk field references are dynamic — `$(i+1)` computes the index at runtime, letting you grab "the segment right after the one I just matched" without hardcoding a column number.
- **Why an anchor-token loop instead of a fixed `$5`:** the path prefix (`force-app/main/default/`) is stable in this repo, so `$5` would work too — but scanning for the literal `"objects"` token makes the script resilient to being run against a relative path, a `package/` directory in a different SFDX package structure, or a path with an extra leading directory. Fixed-index extraction (used in Scenario 5) is fine when the prefix is guaranteed constant; anchor-token scanning is safer when it isn't.
- `rg -o 'pattern' -r '$1'` — `-o` prints only the matched portion of each line; `-r '$1'` replaces that matched portion with capture group 1 in the *displayed* output (this does not modify the file — `rg` has no in-place edit mode, only `sed`/`sd` do).

---

## 2. Extracting Field API Names from Metadata Paths

**SFDX Context:** Same path structure as Scenario 1, but this time you need the Field API Name (`Type__c`) — e.g., to check every field touched in a PR against a list of protected/managed-package fields.

**Standard Command (`awk`):**
```bash
echo "force-app/main/default/objects/Account/fields/Type__c.field-meta.xml" | \
  awk -F'/' '{ n = $NF; sub(/\.field-meta\.xml$/, "", n); print n }'
```

**Modern Alternative (`ripgrep` piped):**
```bash
echo "force-app/main/default/objects/Account/fields/Type__c.field-meta.xml" | \
  rg -o '([^/]+)\.field-meta\.xml$' -r '$1'
```

**Deep Syntax Breakdown:**
- `$NF` — the value of the **last field** on the line. Since `NF` holds the total field count, `$NF` always refers to the final column *regardless of how many fields the line has* — far more robust than guessing an absolute index, especially since the filename is always the last path segment no matter how deep the directory nesting is.
- `sub(/\.field-meta\.xml$/, "", n)` — `sub()` performs a single (first-match-only) regex substitution *in place on a variable* (here, `n`); the three arguments are `(regex, replacement, target)`. The `$` inside the regex anchors to end-of-string, ensuring only a trailing `.field-meta.xml` is stripped, not an accidental mid-string match.
- Assigning `$NF` to a local variable `n` first (rather than calling `sub()` directly on `$NF`) is a defensive habit — mutating `$NF` in place would also silently change what `NF`/field-rebuilding logic sees for the rest of the block if the script grew more complex later.
- `gsub()` is the sibling function that replaces **all** matches instead of just the first — irrelevant here since a filename suffix only ever occurs once, but it's the one to reach for when a pattern can repeat on a line.

---

## 3. Parsing `sf` CLI JSON Output

**SFDX Context:** Pulling specific values — org usernames, record IDs, test outcomes — out of `sf org list --json` or `sf apex run test --json` for use in a shell script (e.g., feeding a username into a subsequent `sf` command).

**Standard Command (`awk`) — a fragile line-oriented workaround:**
```bash
sf org list --json | awk -F'"' '/"username"/{ print $4 }'
```

**Modern Alternative (`jq`) — the correct tool for this job:**
```bash
sf org list --json | jq -r '.result.nonScratchOrgs[].username'
sf apex run test --json | jq -r '.result.tests[] | select(.Outcome=="Fail") | .FullName'
```

**Deep Syntax Breakdown:**
- `-F'"'` — sets `FS` to a literal double-quote. This only works because `sf`'s pretty-printed JSON puts each key/value pair on its own indented line, e.g. `  "username": "test@example.com",`. Splitting that line on `"` yields fields `$1="  "`, `$2="username"`, `$3=": "`, `$4="test@example.com"`.
- `/"username"/` — a **pattern with no explicit action**. In awk, a bare `/regex/` pattern followed by `{action}` runs `action` only on lines matching `regex`; a bare pattern with **no** action at all defaults to `{ print $0 }` (print the whole matching line) — used later in Scenario 7.
- **Why this is fragile and `jq` is the right answer:** the `awk` version breaks the instant the JSON is minified (no newlines), the instant a value itself contains an escaped quote, or the instant you need a *nested* value (e.g., an object inside an array inside an object) — `awk` has no concept of JSON structure, only lines and delimiters. `jq` parses real JSON and lets you navigate it with a structural query language.
- `jq -r` — `-r` (**raw output**) strips the surrounding quotes `jq` would otherwise print around string results, giving plain text ready to pipe into another shell command.
- `.result.tests[] | select(.Outcome=="Fail") | .FullName` — `jq`'s pipe (`|`) chains a stream of values through successive filters: iterate the array, keep only failing tests, then project just the `FullName` field.
- **Rule of thumb for this whole guide:** reach for `awk` when the input is line/column-oriented (paths, logs, CSV); reach for `jq` the moment the input is JSON, no matter how tempting a quick `-F'"'` hack looks.

---

## 4. Counting Lines of Apex Code (Excluding Test Classes)

**SFDX Context:** A LOC metric for the "real" Apex codebase — total lines across every `.cls` file, deliberately excluding `*Test.cls` files, which don't represent shippable business logic.

**Standard Command (`awk`):**
```bash
find force-app -name "*.cls" ! -iname "*Test.cls" -print0 | \
  xargs -0 awk 'END { print NR }'
```

**Modern Alternative (`fd`/`ripgrep` piped):**
```bash
fd -e cls . force-app | rg -v 'Test\.cls$' | xargs wc -l | tail -1
```

**Deep Syntax Breakdown:**
- `NR` (**Number of Records**) — a running counter that increments for *every* line read, **across all input files combined** when `awk` is given multiple filename arguments (as `xargs` supplies here). Printing `NR` inside `END` (which runs once, after all input is exhausted) therefore reports the grand total line count across every matched `.cls` file in a single number.
- Contrast with **`FNR`** (**File Number of Records**) — this resets to `1` at the start of *each new file*, giving you the line count *within the current file only*. `NR` keeps climbing; `FNR` restarts. Scenario 11 below relies on this distinction to detect file boundaries.
- `-print0` / `xargs -0` — null-delimits filenames between `find` and `xargs`, safely handling filenames containing spaces (plain newline-delimited piping can misinterpret such paths).
- `! -iname "*Test.cls"` — `find`'s negation flag excluding case-insensitive matches for the test-class naming convention.

---

## 5. Summarizing Metadata Types (Count Per Category)

**SFDX Context:** A quick inventory report — "40 objects, 120 classes, 15 flows" — useful before a migration or when scoping a refactor's blast radius.

**Standard Command (`awk`):**
```bash
find force-app/main/default -mindepth 1 -maxdepth 1 -type d | while read -r dir; do
  count=$(find "$dir" -type f | wc -l)
  echo "$dir $count"
done | awk '{ printf "%-40s %d\n", $1, $2 }' | sort -k2 -rn
```

**Modern Alternative (`ripgrep` piped, single pass over all files):**
```bash
find force-app/main/default -type f | awk -F'/' '{ count[$4]++ } END { for (t in count) printf "%-15s %d\n", t, count[t] }' | sort -k2 -rn
```

**Deep Syntax Breakdown:**
- `count[$4]++` — an **associative array**: `count` is indexed by *string* (the metadata-type folder name, e.g. `"classes"`), not a fixed integer index. Every time a line's `$4` (fourth `/`-delimited field, e.g. `classes` in `force-app/main/default/classes/Foo.cls`) is seen, its counter increments — awk auto-initializes unseen keys to `0` on first reference.
- `for (t in count)` — iterates every key ever inserted into the array. **Iteration order is unspecified** in standard awk, which is why the pipeline finishes with `sort -k2 -rn` for deterministic, ranked output rather than relying on array insertion order.
- `printf "%-15s %d\n", t, count[t]` — `printf` inside awk works like C's `printf`: `%-15s` left-justifies the type name in a 15-character-wide field, `%d` prints the integer count. Using `printf` instead of `print` gives column-aligned output, which plain `print t, count[t]` cannot.
- This scenario also shows why the **fixed-index `$4`** (rather than the anchor-token loop from Scenario 1) is the right call: the prefix `force-app/main/default/` is invariant for every path fed in, so hardcoding the column is simpler and just as robust here.

---

## 6. Extracting Text Between XML Tags (Custom Labels)

**SFDX Context:** Pulling every label's display text out of `*.labels-meta.xml` — e.g., to feed into a translation export or a copywriting review, without any XML markup noise.

**Standard Command (`awk`):**
```bash
awk -F'[<>]' '/<value>/{ print $3 }' force-app/main/default/labels/CustomLabels.labels-meta.xml
```

**Modern Alternative (`ripgrep` piped):**
```bash
rg -o '<value>(.*)</value>' -r '$1' force-app/main/default/labels/CustomLabels.labels-meta.xml
```

**Deep Syntax Breakdown:**
- `-F'[<>]'` — `FS` accepts a **regular expression**, not just a literal character, when it's more than one character long. `[<>]` is a character class matching either `<` or `>`, so both tag delimiters split the line simultaneously.
- Field walkthrough for a line like `    <value>Submit Order</value>`: splitting on every `<`/`>` produces `$1="    "` (leading whitespace), `$2="value"` (the opening tag name), `$3="Submit Order"` (the text content — what we want), `$4="/value"` (the closing tag name), `$5=""` (empty, after the final `>`).
- `/<value>/` — the pattern guard ensures the `{print $3}` action only runs on lines that actually contain an opening `<value>` tag, so blank lines or unrelated tags in the same file (like `<fullName>`) don't produce garbage output at `$3`.
- **Caveat:** this assumes each `<value>...</value>` pair sits entirely on one line, which is how Salesforce metadata is typically formatted. A value wrapped across multiple lines would need a different approach (multi-record processing with a custom `RS`, or a proper XML parser like `xmlstarlet`).

---

## 7. Filtering Apex Debug Logs

**SFDX Context:** A raw Salesforce debug log can be tens of thousands of lines; you only want the signal — `USER_DEBUG` statements and `EXCEPTION_THROWN` events — while debugging a failed transaction.

**Standard Command (`awk`):**
```bash
awk '/USER_DEBUG|EXCEPTION_THROWN/' MyDebugLog.log
```

**Modern Alternative (`ripgrep`):**
```bash
rg 'USER_DEBUG|EXCEPTION_THROWN' MyDebugLog.log
```

**Deep Syntax Breakdown:**
- `/USER_DEBUG|EXCEPTION_THROWN/` with **no `{action}` block at all** — this is the terse idiom mentioned in Scenario 3: a bare pattern with no action implicitly means `{ print $0 }`, printing the entire matching line unmodified. This is the shortest possible "grep-like" awk one-liner.
- `|` inside the regex is **extended-regex alternation**, supported natively in awk's `ERE`-based pattern matching without needing an equivalent to `grep -E` — awk regexes are extended by default.
- This scenario is a good illustration of *when not to reach for awk*: since no field-splitting, counting, or transformation is happening, `rg`/`grep` alone are simpler and faster — `awk` earns its keep once you need `NR` line numbers, field extraction, or aggregation on top of the filter (see Scenario 8).

---

## 8. Calculating Test Coverage Below Threshold

**SFDX Context:** After a `sf apex run test --code-coverage` run, you want a quick list of every class sitting below your org's 75% coverage gate — the classes that need attention before a release can proceed.

**Standard Command (`awk`) — against a plain-text coverage summary:**
```bash
# Assumes lines formatted like: "AccountServiceTest 92%"
awk -F'[ %]+' '$2 < 75 { print $1": "$2"%" }' coverage-summary.txt
```

**Modern Alternative (`jq`) — against the real `--json` output:**
```bash
sf apex run test --code-coverage --json | \
  jq -r '.result.coverage.coverage[] | select(.coveredPercent < 75) | "\(.name): \(.coveredPercent)%"'
```

**Deep Syntax Breakdown:**
- `-F'[ %]+'` — a regex `FS` matching **one or more** spaces or `%` characters as a single delimiter run, which collapses `"AccountServiceTest 92%"` cleanly into `$1="AccountServiceTest"`, `$2="92"` (the trailing `%` is consumed as a delimiter, not left in the field).
- `$2 < 75` — a **pattern that is itself a comparison expression**, with no explicit `{action}` written before it in this case sits inline; awk automatically evaluates `$2` as numeric here because it's compared against a number, so string `"92"` behaves as `92` for the comparison. If `$2` isn't cleanly numeric (e.g., has trailing text), this coercion can silently misbehave — always sanity-check the input format first.
- **Why `jq` is the production-grade choice:** the real `sf apex run test --json` payload nests coverage data inside `result.coverage.coverage[]`, each entry a JSON object with typed numeric fields (`coveredPercent` as an actual number, not a string with a `%` suffix) — no fragile text-format assumptions required, and `select()` performs the threshold filter natively.

---

## 9. Reformatting CSV Data (`sf data export` / `sf data query --csv`)

**SFDX Context:** Turning a flat CSV export (`Id,Name,Email` header + rows) into a labeled key-value block per record — useful for generating a human-readable diff or an email digest from query results.

**Standard Command (`awk`):**
```bash
awk -F',' 'NR==1 { split($0, header, ","); next }
           { for (i=1; i<=NF; i++) print header[i]": "$i; print "---" }' records.csv
```

**Modern Alternative (shell pipeline — `jq` doesn't natively parse CSV):**
```bash
header=$(head -1 records.csv)
tail -n +2 records.csv | while IFS=',' read -ra row; do
  IFS=',' read -ra cols <<< "$header"
  for i in "${!cols[@]}"; do echo "${cols[$i]}: ${row[$i]}"; done
  echo "---"
done
```

**Deep Syntax Breakdown:**
- `NR==1 { split($0, header, ","); next }` — on the **first record only** (the header row), `split()` breaks the whole line (`$0`) into the `header` array using `,` as the delimiter, then `next` immediately skips to the following input line without running the rest of the script — a standard awk idiom for "capture the header, then process data rows differently."
- `header[i]": "$i` — string concatenation in awk is just **juxtaposition** (placing values side by side with no operator); this builds `"Id: 001xx..."` by concatenating the captured header label, a literal `": "`, and the current row's field value.
- **CSV caveat that trips up naive `awk -F','` scripts:** if any field value contains an embedded comma inside quotes (e.g., `"Doe, Jane"`), a plain `-F','` split will incorrectly treat that as two fields. `gawk` (4.0+) solves this properly with the `FPAT` variable — `gawk 'BEGIN{FPAT="([^,]+)|(\"[^\"]+\")"} {...}'` — which defines fields by *what they look like* rather than by delimiter, correctly keeping quoted commas intact. For anything beyond trivial CSVs, prefer `FPAT`-aware `gawk` or a dedicated CSV tool over plain `-F','`.
- **Why the "modern alternative" here isn't `jq`:** `jq` is a JSON tool with no native CSV support — the honest modern alternative is a `bash`-native `IFS`-based loop, included above for comparison rather than as a strict "reach for this instead" recommendation, since `awk`'s field handling is actually the more natural fit for CSV among the tools in this series.

---

## 10. Finding Duplicate Metadata Entries (Permission Set Field Blocks)

**SFDX Context:** A malformed merge or a bad manual edit can leave the *same* `<field>` granted permissions twice inside one Permission Set XML — Salesforce may accept it, but it's a metadata smell worth catching before deploy.

**Standard Command (`awk`):**
```bash
awk -F'[<>]' '/<field>/{ count[$3]++ } END { for (f in count) if (count[f] > 1) print f, count[f] }' \
  force-app/main/default/permissionsets/MyPermSet.permissionset-meta.xml
```

**Modern Alternative (`ripgrep` piped):**
```bash
rg -o '<field>(.*)</field>' -r '$1' force-app/main/default/permissionsets/MyPermSet.permissionset-meta.xml | \
  sort | uniq -d
```

**Deep Syntax Breakdown:**
- This scenario directly combines the tag-extraction technique from Scenario 6 (`-F'[<>]'`, `$3` as the tag's text content) with the associative-array tallying from Scenario 5 (`count[key]++`) — a good example of how a small set of awk idioms compose into more complex reports.
- `if (count[f] > 1) print f, count[f]` inside the `END` block — only keys seen **more than once** are reported, so a field appearing exactly once (the normal, correct case) is silently skipped.
- `sort | uniq -d` — the `rg` alternative's equivalent logic: `uniq -d` (**duplicates only**) prints a line once *for each value that appeared more than once* in the (now-sorted) stream — `sort` is a hard prerequisite since `uniq` only detects adjacent duplicate lines.

---

## 11. Finding Apex Test Classes Missing `@IsTest`

**SFDX Context:** A file named `*Test.cls` that's missing the `@IsTest` annotation entirely won't be recognized as a test class by Salesforce, silently excluding it from coverage — a subtle bug worth catching in CI.

**Standard Command (portable `awk`, using the `FNR`/`NR` distinction):**
```bash
awk 'FNR==1 { if (fname && !found) print fname" is missing @IsTest"; fname=FILENAME; found=0 }
     /@[Ii]sTest/ { found=1 }
     END { if (fname && !found) print fname" is missing @IsTest" }' \
  force-app/main/default/classes/*Test.cls
```

**Modern Alternative (`ripgrep`, far simpler):**
```bash
rg --files-without-match '@[Ii]sTest' force-app/main/default/classes/*Test.cls
```

**Deep Syntax Breakdown:**
- `FNR==1` — fires exactly once **per file**, at that file's first line, because `FNR` (unlike `NR`) resets to `1` every time awk begins reading a new input file. This is the trigger point for "finalize the previous file's verdict, then reset state for the new file."
- `if (fname && !found) print ...` inside the `FNR==1` block — checks the *previous* file's outcome right before moving on to the new one; `fname` is empty/falsy on the very first file, so this guard prevents a spurious print before any file has actually been fully scanned.
- **Why the `END` block also repeats this check:** the `FNR==1` trigger only fires when a *new* file starts, so it never gets a chance to report on the *last* file processed — nothing comes after it to trigger the check. The `END` block (runs once, after all input across all files is exhausted) is the only place left to flush that final verdict.
- This whole two-checkpoint pattern (`FNR==1` + `END`) is the **portable, POSIX-compliant** way to do "per-file summary" logic in awk. `gawk` offers a shortcut extension, `ENDFILE { ... }`, which runs automatically at the end of *each* file and eliminates the need for the `FNR==1`-triggered lookback — but it's a `gawk`-only feature, not part of standard `awk`, hence the portable version is shown as the primary example.
- `rg --files-without-match` (no short flag in `rg` — note `-L` in ripgrep means `--follow`/symlinks, unlike GNU `grep` where `-L` *is* the files-without-match shorthand) is dramatically simpler for this exact question ("which files don't contain this pattern") — the `awk` version is worth understanding for the *technique* (per-file state tracking across multi-file input), which generalizes to reports `rg` alone can't produce (e.g., "which files are missing X but contain Y").

---

## 12. Building Dynamic Deployment Commands from a Class List

**SFDX Context:** A text file (`classes-to-deploy.txt`, one Apex class name per line — perhaps generated by a CI step that diffed changed files) needs to become a single `sf project deploy start --metadata ApexClass:A ApexClass:B ...` command.

**Standard Command (`awk`):**
```bash
awk 'BEGIN { cmd = "sf project deploy start --metadata" }
     { cmd = cmd" ApexClass:"$1 }
     END { print cmd }' classes-to-deploy.txt
```

**Modern Alternative (shell-native, for a plain list):**
```bash
echo "sf project deploy start --metadata $(sed 's/^/ApexClass:/' classes-to-deploy.txt | paste -sd' ')"
```

**Modern Alternative (`jq`, if the list originates as JSON, e.g. from a prior `sf`/CI JSON step):**
```bash
echo "sf project deploy start --metadata $(jq -r '.[] | "ApexClass:"+.' classes.json | paste -sd' ')"
```

**Deep Syntax Breakdown:**
- `BEGIN { cmd = "..." }` — the **`BEGIN` block** runs exactly once, *before* any input line is read — the correct place to initialize an accumulator variable (here, the base command string) that will be built up across every subsequent record.
- `cmd = cmd" ApexClass:"$1` — runs once per input line, appending `" ApexClass:"` plus that line's first whitespace-delimited field (`$1`, the class name, using awk's default `FS` of "any run of whitespace") onto the growing `cmd` string. This is the accumulator pattern: mutate a variable declared in `BEGIN` on every line, then act on the final result in `END`.
- `END { print cmd }` — the **`END` block** runs exactly once, *after* the last input line has been processed, making it the natural place to emit an aggregate result built up over the whole file — the mirror image of `BEGIN`.
- Together, `BEGIN`/(per-line action)/`END` form awk's three-part program structure: **setup once → process every record → report once** — every non-trivial script in this guide (Scenarios 5, 9, 10, 11) is a variation on this same shape.
- `paste -sd' '` — joins all lines of its input into a single line, delimited by a space (`-s` serializes, `-d' '` sets the delimiter) — the shell-native equivalent of awk's `cmd = cmd" "$1` accumulation, useful when no per-line transformation beyond a fixed prefix is needed.

---

## Bonus Scenarios

### A. Validating CSV Column Count Consistency

**SFDX Context:** A `sf data export`/`data query --csv` file where a row got truncated or a value contains an unescaped delimiter produces a row with the wrong number of columns — a silent data-quality bug until something downstream breaks.

```bash
awk -F',' 'NR==1 { expected=NF; next } NF != expected { print "Line "NR" has "NF" fields, expected "expected }' records.csv
```
- `NF != expected` — compares each row's live field count against the header's field count (captured once via `NR==1`), flagging any row whose shape doesn't match. This is `NF` used as a **data validator**, not just a loop bound — one of awk's most underused capabilities.

### B. Apex Method Name Frequency (Hotspot Report)

**SFDX Context:** Before refactoring a shared utility class, see which method names appear most often across the codebase (a proxy for "most relied upon" / highest-risk-to-change).

```bash
awk -F'[ (]' '/public|private|global/ && /\(/ { print $2 }' force-app/main/default/classes/*.cls | sort | uniq -c | sort -rn | head -10
```
- `-F'[ (]'` — splits on either a space or an opening parenthesis, isolating a method's name as the token immediately before its argument list on a typical declaration line.

### C. Combining `jq` and `awk` for Test Run Statistics

**SFDX Context:** Computing the average Apex test execution time from a `sf apex run test --json` result — `jq` extracts the raw numeric stream, `awk` does the arithmetic, since `jq` alone is awkward for statistical aggregation.

```bash
sf apex run test --json | jq -r '.result.tests[].RunTime' | awk '{ sum += $1; n++ } END { printf "Average: %.2f ms\n", sum/n }'
```
- This is the idiomatic division of labor in this whole guide: **`jq` for structural JSON extraction, `awk` for numeric aggregation** — each tool doing the part it's actually built for, rather than forcing one to do both.

### D. Column-Aligned Pretty-Printing of `sf` Tabular Output

**SFDX Context:** Re-aligning a CLI table or log excerpt whose columns have drifted (e.g., after piping through another filter that changed field widths).

```bash
awk '{ printf "%-20s %-10s %s\n", $1, $2, $3 }' misaligned-output.txt
```
- `printf`'s width specifiers (`%-20s`) are the standard awk technique for turning irregular whitespace-separated text back into a clean, human-scannable table.

---

## Summary Cheat Sheet

| Scenario | `awk` | Modern (`jq` / `fd` / `rg`) |
|---|---|---|
| Object name from path | `awk -F'/' '{for(i=1;i<=NF;i++) if($i=="objects") print $(i+1)}'` | `rg -o 'objects/([^/]+)/' -r '$1'` |
| Field name from path | `awk -F'/' '{n=$NF; sub(/\.field-meta\.xml$/,"",n); print n}'` | `rg -o '([^/]+)\.field-meta\.xml$' -r '$1'` |
| Parse `sf` JSON | `awk -F'"' '/"username"/{print $4}'` | `jq -r '.result.nonScratchOrgs[].username'` |
| Count Apex LOC (excl. tests) | `awk 'END{print NR}' $(find ... ! -iname "*Test.cls")` | `fd -e cls . \| rg -v 'Test\.cls$' \| xargs wc -l` |
| Summarize metadata types | `awk -F'/' '{c[$4]++} END{for(t in c) print t,c[t]}'` | n/a — awk's associative array is the natural fit |
| Extract `<label>` text | `awk -F'[<>]' '/<value>/{print $3}'` | `rg -o '<value>(.*)</value>' -r '$1'` |
| Filter debug logs | `awk '/USER_DEBUG\|EXCEPTION_THROWN/'` | `rg 'USER_DEBUG\|EXCEPTION_THROWN'` |
| Coverage below threshold | `awk -F'[ %]+' '$2 < 75 {print $1,$2}'` | `jq -r '.result.coverage.coverage[] \| select(.coveredPercent<75)'` |
| Reformat CSV to key-value | `awk -F',' 'NR==1{split($0,h,",");next}{...}'` | shell `IFS`-based loop (not `jq` — CSV isn't JSON) |
| Duplicate field permissions | `awk -F'[<>]' '/<field>/{c[$3]++} END{...}'` | `rg -o '<field>(.*)</field>' -r '$1' \| sort \| uniq -d` |
| Test classes missing `@IsTest` | `awk 'FNR==1{...} /@IsTest/{found=1} END{...}'` | `rg --files-without-match '@IsTest'` |
| Build deploy command | `awk 'BEGIN{cmd="..."} {cmd=cmd" "$1} END{print cmd}'` | `paste -sd' '` or `jq -r` + `paste` |

---

## External Resources

- [GNU Awk User's Guide](https://www.gnu.org/software/gawk/manual/gawk.html) — authoritative reference, including `gawk`-only extensions like `FPAT` and `ENDFILE`.
- [jq Manual](https://jqlang.github.io/jq/manual/) — full filter/query language reference for JSON processing.
- [ripgrep on GitHub](https://github.com/BurntSushi/ripgrep) — reference for the `-o`/`-r`/`-L` flags used throughout this guide's "modern alternative" examples.
