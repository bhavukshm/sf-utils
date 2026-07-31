# jq Mastery Guide for Salesforce CLI (sf / sfdx) JSON Output

A production-grade reference for parsing, querying, filtering, and reshaping JSON emitted by the Salesforce CLI (`sf` / `sfdx --json`). Where `awk_mastery.md` and `grep_mastery.md` treat CLI output as lines of text, every `sf`/`sfdx` command supports a `--json` flag that emits a single structured document instead — and the moment that's true, `jq` is the only tool that should touch it. Text-oriented tools (`awk`, `grep`, `cut`) have no concept of nesting, arrays, or quoting rules; they get lucky on pretty-printed output and break the instant it's minified, re-ordered, or contains an escaped character. `jq` parses real JSON and lets you navigate, filter, and rebuild it with a purpose-built query language.

---

## 0. Prerequisites & Setup

- **Install `jq`:**
    ```bash
    brew install jq        # macOS
    choco install jq       # Windows
    sudo apt install jq    # Debian/Ubuntu
    ```
- **Always pass `--json` to the `sf` command you're piping from.** Without it, `sf` prints human-formatted tables/text and there is no JSON for `jq` to parse. Every example in this guide assumes `sf ... --json | jq ...`.
- **Every `sf --json` response shares an envelope shape:**
    ```json
    {
        "status": 0,
        "result": {
            /* command-specific payload */
        },
        "warnings": []
    }
    ```
    `status: 0` means success; non-zero means the command failed and `result` may be absent or replaced with an error structure — this is why almost every filter in this guide starts with `.result`.
- **`jq` version matters slightly:** this guide targets `jq` 1.6/1.7 syntax (both are in wide circulation). Features like `ltrimstr`, `getpath`, and `try/catch` (used in §6) are available in both; `input_line_number` and a few newer builtins differ, but nothing in this guide depends on that.
- **Two invocation modes you'll see throughout:** `jq '<filter>'` (reads stdin as JSON, the normal case for piping from `sf`) vs `jq -n '<filter>'` (`-n`, null input — starts with `null` instead of reading stdin; used only when constructing a value from scratch, e.g. combining two files with `--slurpfile`).

---

## 1. Basic Formatting & Lookup

### Scenario 1.1 — Pretty-Print and Colorize Raw JSON

**SFDX Context:** Any `sf ... --json` command can return a wall of unreadable, whitespace-stripped JSON on a single line. Before doing anything else, you need to _see_ the structure.

**Naive Command (no JSON awareness):**

```bash
sf org list --json | fold -w 120
```

`fold` just wraps text at a column width — it has no idea where an object or array boundary is, so a wrapped line can split a key from its value mid-token, and there's no indentation to show nesting depth at all.

**Dedicated `jq` Command:**

```bash
sf org list --json | jq .
sf org list --json | jq -C .   # force ANSI color even when piping to a file/pager
```

**Deep Syntax & Filter Breakdown:**

- `.` — the **identity filter**. It takes whatever JSON value comes in and outputs it unchanged. On its own it does nothing semantically useful, but because `jq` always pretty-prints (2-space indent) and colorizes its output by default when connected to a terminal, `jq .` is the idiomatic "just show me this nicely" command — the JSON equivalent of `cat -A`.
- `-C` — force color output even when `jq`'s output isn't going straight to a terminal (e.g., piping into `less -R` or writing to a log file that a colorizing viewer will later read). The inverse, `-M`, forces color **off**.
- Every other filter in this guide is really just "identity, plus navigation" — understanding `.` first makes the rest read naturally as _modifications to identity_.

---

### Scenario 1.2 — Extract a Single Top-Level Key

**SFDX Context:** `sf project deploy validate --json` returns a large envelope; you only want the `status` field (the deploy's pass/fail outcome) or the entire `result` object, discarding the rest.

**Naive Command (text parsing):**

```bash
sf project deploy validate --json | grep -A2 '"status"' | head -1
```

This assumes `"status"` appears exactly once, on its own line, in a fixed position relative to other keys — all three assumptions break the moment Salesforce adds a field, reorders the response, or minifies it.

**Dedicated `jq` Command:**

```bash
sf project deploy validate --json | jq '.status'
sf project deploy validate --json | jq '.result'
```

**Deep Syntax & Filter Breakdown:**

- `.status` — **object member access**. The dot operator, followed by a key name, descends one level into the object and returns the value at that key. This is the same dot as `.` in Scenario 1.1, just with a key appended — `jq`'s entire syntax is built by chaining these small pieces.
- `.result` — same operator, different key; since `result` is itself an object (not a scalar), the output is a full nested JSON object, still pretty-printed.
- If the key doesn't exist, `jq` returns `null` rather than erroring — useful to know before you assume a missing field means something crashed.

---

### Scenario 1.3 — Extract Raw Strings for Shell Variables

**SFDX Context:** You want to capture a value — e.g. the default org's username — directly into a shell variable to feed into a subsequent command, without the double quotes `jq` normally wraps around JSON strings.

**Naive Command (text parsing):**

```bash
USERNAME=$(sf org display --json | grep '"username"' | cut -d'"' -f4)
```

Fragile for the same reasons as every `grep`/`cut` JSON hack in this guide: it silently breaks if the username itself contains an escaped quote, or if the key appears more than once anywhere in the payload (e.g. inside a nested `connectedOrgs` array).

**Dedicated `jq` Command:**

```bash
USERNAME=$(sf org display --json | jq -r '.result.username')
echo "Current default user: $USERNAME"
```

**Deep Syntax & Filter Breakdown:**

- `-r` (**raw output**) — without it, `jq '.result.username'` prints `"test@example.com"` — a valid JSON string, quotes included. `-r` prints the _unquoted_ content instead: `test@example.com`. This is the flag you need almost every time `jq`'s output is destined for a shell variable, a `curl` header, or another CLI's `--flag value`, rather than for another `jq`/JSON consumer.
- Without `-r`, `$USERNAME` would literally contain the surrounding quote characters — breaking any command you interpolate it into.
- Rule of thumb: keep `jq`'s default quoted output when _piping to another JSON tool_; add `-r` the moment the final destination is plain text.

---

## 2. Array Iteration & Plucking

### Scenario 2.1 — List All Default Org Usernames

**SFDX Context:** `sf org list --json` returns orgs split across `result.nonScratchOrgs` and `result.scratchOrgs` arrays. You want a flat list of every `username`, e.g. to loop over in a script that refreshes each org's access token.

**Naive Command (text parsing):**

```bash
sf org list --json | grep '"username"' | sed 's/.*"username": "\(.*\)",/\1/'
```

Breaks if any _other_ object in the payload (e.g. a nested `connectedStatus` metadata block) happens to also have a `username` key at a different nesting depth, or if the trailing comma is missing because it's the array's last element.

**Dedicated `jq` Command:**

```bash
sf org list --json | jq -r '.result.nonScratchOrgs[].username'
sf org list --json | jq -r '.result.scratchOrgs[].username'

# Both lists combined into one stream
sf org list --json | jq -r '(.result.nonScratchOrgs + .result.scratchOrgs)[].username'
```

**Deep Syntax & Filter Breakdown:**

- `[]` — the **array iterator**. Applied to an array, it emits _each element_ as a separate value flowing down the pipeline, rather than the array as a single unit. `.result.nonScratchOrgs[]` therefore produces a stream of individual org objects, not one array containing them.
- `.result.nonScratchOrgs[].username` — chaining `.username` directly after `[]` applies that key lookup to _every_ emitted element: iterate, then pluck. This "iterate-then-project" pattern is the single most common shape in every `jq` filter you'll write against `sf` output.
- `.result.nonScratchOrgs + .result.scratchOrgs` — the `+` operator on two arrays performs **concatenation** (not addition), producing one combined array; wrapping it in `(...)` before applying `[]` is necessary because `jq` would otherwise try to apply `[]` to `.scratchOrgs` alone due to operator precedence.
- Output is one username per line — because `-r` strips quotes, this is immediately usable as input to a `while read -r line` loop in bash.

---

### Scenario 2.2 — Extract Custom Object / Apex Class Names from Retrieve Preview

**SFDX Context:** `sf project retrieve preview --json` reports which components would be pulled from the org before you actually run `sf project retrieve start`. You want just the component names, grouped or filtered by metadata type, to review before committing to the retrieve.

**Naive Command (text parsing):**

```bash
sf project retrieve preview --json | grep '"fullName"' | cut -d'"' -f4
```

Pulls _every_ `fullName` in the document indiscriminately — including ones nested under `conflicts` or `ignored` sections you may not want mixed together — with no ability to filter by `type`.

**Dedicated `jq` Command:**

```bash
# All component names to retrieve
sf project retrieve preview --json | jq -r '.result.toRetrieve[].fullName'

# Only Apex Classes
sf project retrieve preview --json | jq -r '.result.toRetrieve[] | select(.type == "ApexClass") | .fullName'

# Only Custom Objects
sf project retrieve preview --json | jq -r '.result.toRetrieve[] | select(.type == "CustomObject") | .fullName'
```

**Deep Syntax & Filter Breakdown:**

- `|` — the **pipe operator**. It feeds the output of the filter on its left as the input to the filter on its right, exactly like a shell pipe but for JSON values instead of text streams. `.result.toRetrieve[] | select(...) | .fullName` reads as three sequential steps: iterate the array, keep matching elements, then project one field from each survivor.
- `select(.type == "ApexClass")` — a filter that receives one element at a time (because it's downstream of `[]`) and passes it through **unchanged** if the boolean condition is true, or drops it from the stream entirely if false. `select` is `jq`'s `WHERE` clause — it never transforms a value, only decides whether it continues down the pipeline.
- `==` performs exact string equality here; `jq` also supports `!=`, `<`, `>`, `and`, `or`, `not` for combining conditions, all covered further in §3.
- Chaining `select()` calls (e.g. `select(.type == "ApexClass") | select(.fullName | startswith("Acct"))`) works the same way `WHERE a AND b` would — each stage narrows the stream further.

---

### Scenario 2.3 — Count Items in a JSON Array

**SFDX Context:** Before running a bulk operation, you want a quick sanity count — e.g., "how many orgs are currently authenticated?" or "how many components will this deploy touch?" — without eyeballing a printed list.

**Naive Command (text parsing):**

```bash
sf org list --json | grep -c '"username"'
```

Counts _lines matching a string_, which is only correct by coincidence if `username` never appears anywhere else in the payload and the output is one-key-per-line pretty-printed — both assumptions are one Salesforce CLI version bump away from silently breaking.

**Dedicated `jq` Command:**

```bash
sf org list --json | jq '.result.nonScratchOrgs | length'
sf project deploy start --json | jq '.result.details.componentSuccesses | length'
```

**Deep Syntax & Filter Breakdown:**

- `length` — a built-in function that, applied to an **array**, returns its element count; applied to a **string**, returns its character count; applied to an **object**, returns its number of keys. It adapts to whatever type flows into it, which is why the same word works for "how many orgs" and "how many characters in this username" — check the type of what's upstream to know what you're actually counting.
- Note there's no `-r` here: `length` already returns a bare JSON number, which prints unquoted with or without `-r` — `-r` only affects _string_ output.
- `.result.nonScratchOrgs | length` vs `.result.nonScratchOrgs[] | length` are very different: the first counts _the array_; the second would run `length` separately on _each org object_ (returning its key count), one number per org. Forgetting the `[]` is a much smaller mistake here than accidentally adding it.

---

## 3. Filtering with Conditions (`select`)

### Scenario 3.1 — Filter Failing Apex Test Methods

**SFDX Context:** `sf apex run test --json` returns every executed test method with its outcome. In CI, you only care about the failures — their class, method, and stack trace — to post as a build annotation.

**Naive Command (text parsing):**

```bash
sf apex run test --json | grep -B2 -A2 '"Outcome": "Fail"'
```

Grabs two lines of context above/below each match, hoping the class/method name happens to fall in that window — it doesn't generalize if the JSON key order changes, and it can't cleanly extract just the three fields you want.

**Dedicated `jq` Command:**

```bash
sf apex run test --json | jq -r '
  .result.tests[]
  | select(.Outcome == "Fail")
  | "\(.ApexClass.FullName).\(.MethodName): \(.Message)\n\(.StackTrace)\n---"
'
```

**Deep Syntax & Filter Breakdown:**

- `select(.Outcome == "Fail")` — same filter-by-condition pattern as Scenario 2.2, here narrowing the test stream to only failures before anything downstream sees them.
- `\(.ApexClass.FullName)` — **string interpolation**. Inside a double-quoted `jq` string, `\(...)` evaluates the enclosed filter against the _current_ input and splices its result into the string at that position — this is `jq`'s equivalent of an f-string/template literal, and it's how you build human-readable one-line summaries out of structured fields instead of printing raw JSON.
- Chaining multiple `\(...)` blocks and literal text (`": "`, `"\n"`, `"---"`) inside one string lets you compose an arbitrary report line per matched record — `\n` inside the string produces an actual newline in the raw output once `-r` is applied.
- `.ApexClass.FullName` — nested member access two levels deep; `jq` chains dots for nested objects exactly the way you'd expect from any object-path syntax.
- If a test record is somehow missing `StackTrace` (e.g. a passing test where it's `null`), interpolating `\(.StackTrace)` on a `null` prints the literal text `null` rather than crashing — worth being aware of, and addressed with `?`/`// ""` fallbacks in §6.

---

### Scenario 3.2 — Filter Orgs That Are Expired or on a Specific Instance

**SFDX Context:** Before a cleanup script deletes scratch orgs, or before an audit checks for stray sandbox connections, you want to isolate orgs whose `expirationDate` has passed, or whose `instanceUrl` points at a specific instance (e.g. all orgs on `cs*` sandbox instances).

**Naive Command (text parsing):**

```bash
sf org list --json | grep -B5 '"connectedStatus": "Expired"'
```

Same "hope the context window catches the right lines" fragility as 3.1, and it can't express a date comparison (`expirationDate < today`) at all — `grep` has no concept of dates, only string patterns.

**Dedicated `jq` Command:**

```bash
# Orgs Salesforce itself reports as expired/disconnected
sf org list --json | jq -r '
  .result.scratchOrgs[]
  | select(.connectedStatus == "Expired" or .status == "Expired")
  | .username
'

# Orgs on a specific sandbox instance, matched by regex
sf org list --json | jq -r '
  .result.nonScratchOrgs[]
  | select(.instanceUrl | test("cs[0-9]+\\.salesforce\\.com"))
  | .username
'
```

**Deep Syntax & Filter Breakdown:**

- `select(.connectedStatus == "Expired" or .status == "Expired")` — `or` combines two boolean sub-filters exactly like a shell `||` or SQL `OR`; `jq` also supports `and` and unary `not` for arbitrarily complex conditions.
- `.instanceUrl | test("cs[0-9]+\\.salesforce\\.com")` — `test(regex)` is `jq`'s regex-match predicate, returning `true`/`false`; piping the field into it (`.instanceUrl | test(...)`) rather than writing `test(.instanceUrl; ...)` is the more idiomatic style since the string being tested is already the pipeline's current input.
- The double backslash (`\\.`) is necessary because the regex itself lives inside a `jq` string literal — the first backslash escapes the second for `jq`'s string parser, leaving a single literal `\.` for the regex engine to interpret as "match a literal dot," not "match any character."
- `test()` (boolean match/no-match) is the filtering primitive; `match()` (returns full match details/capture groups) and `capture()` (returns named capture groups as an object) are its siblings for when you need to _extract_ part of a matched string rather than just decide whether to keep the record — useful, e.g., for pulling the sandbox instance number itself out of `instanceUrl`.

---

### Scenario 3.3 — Filter SOQL Records by Numeric Threshold or Regex

**SFDX Context:** `sf data query --json --query "SELECT Id, Name, AnnualRevenue FROM Account"` returns every matching record; you want to narrow that further client-side — e.g., only accounts above a revenue threshold, or only accounts whose `Name` matches a naming-convention pattern — without re-running a different SOQL query.

**Naive Command (text parsing):**

```bash
sf data query --json --query "SELECT Id, Name, AnnualRevenue FROM Account" \
  | grep -B1 '"AnnualRevenue": [0-9]\{7,\}'
```

Approximates "7+ digits" as a proxy for "greater than 1,000,000," which is both a hack (breaks for exactly-1,000,000 vs 999,999,999) and incapable of pairing the matched revenue line back up with its sibling `Name`/`Id` lines reliably.

**Dedicated `jq` Command:**

```bash
# Numeric threshold
sf data query --json --query "SELECT Id, Name, AnnualRevenue FROM Account" \
  | jq -r '.result.records[] | select(.AnnualRevenue != null and .AnnualRevenue > 1000000) | .Name'

# Regex match on Name
sf data query --json --query "SELECT Id, Name FROM Account" \
  | jq -r '.result.records[] | select(.Name | test("^Acme.*Corp$"; "i")) | .Name'
```

**Deep Syntax & Filter Breakdown:**

- `select(.AnnualRevenue != null and .AnnualRevenue > 1000000)` — the `!= null` guard matters because SOQL commonly returns `null` for unset numeric fields; comparing `null > 1000000` doesn't error in `jq`, but it also silently evaluates to `false` for every ordering operator against `null` in a way that's easy to _assume_ is filtering correctly when it's actually just always excluding those records — being explicit about the `null` check documents the intent and protects against a future field-type change.
- `.AnnualRevenue > 1000000` — standard numeric comparison; unlike the `grep` digit-count hack, this is a real numeric comparison regardless of how many digits the number happens to have.
- `test("^Acme.*Corp$"; "i")` — the second argument to `test()` is a **flags string**; `"i"` makes the match case-insensitive, the same role `i` plays in Perl/JS regex literals. Anchors `^`/`$` work exactly as in standard regex, matching start/end of the string.
- This is a good moment to note SOQL vs. `jq` division of labor: pushing filters into the `WHERE` clause of the SOQL query itself is almost always more efficient (less data transferred, indexed at the database), and `jq`-side filtering shown here is for conditions that are awkward or impossible to express in SOQL (complex regex, cross-field logic) or for filtering a response you've already captured and don't want to re-query for.

---

## 4. Reshaping Data & Custom Output

### Scenario 4.1 — Transform Query Records into a Custom String Output

**SFDX Context:** You've queried a set of Accounts and want a clean, human-readable line per record for a Slack message or terminal report — not raw JSON, not a spreadsheet.

**Naive Command (text parsing):**

```bash
sf data query --json --query "SELECT Id, Name FROM Account" \
  | paste - - | sed -n 's/.*"Id": "\([^"]*\)".*"Name": "\([^"]*\)".*/ID: \1 | Name: \2/p'
```

Relies on `Id` and `Name` always appearing as adjacent lines in a fixed order for `paste - -` to pair them correctly — one schema change (adding a field between them) and every pairing shifts and produces garbage.

**Dedicated `jq` Command:**

```bash
sf data query --json --query "SELECT Id, Name FROM Account" \
  | jq -r '.result.records[] | "ID: \(.Id) | Name: \(.Name)"'
```

**Deep Syntax & Filter Breakdown:**

- `"ID: \(.Id) | Name: \(.Name)"` — the same string-interpolation pattern from Scenario 3.1, here used purely for formatting rather than combined with `select`. Because each record flows through independently via `[]`, this single template is applied once per record, producing one formatted line per Account.
- Note the literal `|` inside the quoted string (between `\(.Id)` and `Name:`) is just a character in that string — it has no pipe/filter meaning once it's inside `"..."`; `jq` only interprets `|` as the pipe operator outside of string literals.
- This scenario is the general-purpose template for "make CLI output readable" — swap the interpolated fields and literal text for whatever report line your script actually needs.

---

### Scenario 4.2 — Convert SOQL JSON Query Results Directly into CSV

**SFDX Context:** A stakeholder wants a `.csv` export of a SOQL query result to open in Excel, without adding `--result-format csv` to the original `sf data query` call (e.g., because you already have the JSON captured, or need CSV derived from a subset/reshaping of the fields).

**Naive Command (text parsing):**

```bash
sf data query --json --query "SELECT Id, Name, AnnualRevenue FROM Account" \
  | grep -oE '"(Id|Name|AnnualRevenue)": *"?[^",}]*"?' | paste -d, - - -
```

Extremely brittle: assumes exactly three matches per record in a fixed order, breaks the moment a value legitimately contains a comma (which CSV requires to be quoted and this approach can't detect), and produces no header row.

**Dedicated `jq` Command:**

```bash
sf data query --json --query "SELECT Id, Name, AnnualRevenue FROM Account" \
  | jq -r '
    ["Id", "Name", "AnnualRevenue"],
    (.result.records[] | [.Id, .Name, .AnnualRevenue])
    | @csv
  ' > accounts.csv
```

**Deep Syntax & Filter Breakdown:**

- `["Id", "Name", "AnnualRevenue"], (.result.records[] | [...])` — the **comma operator** runs the filter on both sides against the _same_ input and emits both results in sequence, one after the other, into the output stream. Here it's used to emit a literal header-row array first, followed by one array per record — both of which then flow into `@csv` below.
- `[.Id, .Name, .AnnualRevenue]` — building an **array literal** from three field lookups on the current record; order in the array is the column order in the resulting CSV row.
- `@csv` — a built-in **format string** that takes an array of scalars and renders it as one properly RFC-4180-quoted CSV line (commas inside a value are automatically wrapped in double quotes, and embedded quotes are escaped) — a correctness guarantee the `grep`/`paste` version has no way to provide.
- Because the comma operator emits the header array and every record array through the _same_ trailing `| @csv`, the header row gets CSV-formatted identically to the data rows, so both land in the same shape without a separate `echo "Id,Name,AnnualRevenue"` step.

---

### Scenario 4.3 — Create a Simplified, Minified JSON Payload with Selected Fields

**SFDX Context:** You need to hand off just the `Id` and `Name` of every retrieved record to another script/service that expects small, specific JSON objects — not the full SOQL response with its `attributes` metadata and every queried column.

**Naive Command (text parsing):**

```bash
sf data query --json --query "SELECT Id, Name, AnnualRevenue, BillingCity FROM Account" \
  | grep -oE '"(Id|Name)": *"[^"]*"'
```

Produces a flat list of loose `"key": "value"` fragments — not valid JSON on its own, with no object/array wrapper, and no way to consume it as structured data downstream.

**Dedicated `jq` Command:**

```bash
sf data query --json --query "SELECT Id, Name, AnnualRevenue, BillingCity FROM Account" \
  | jq -c '[.result.records[] | {Id: .Id, Name: .Name}]'
```

**Deep Syntax & Filter Breakdown:**

- `{Id: .Id, Name: .Name}` — an **object construction** filter: `jq` builds a brand-new object with the keys you name literally (`Id`, `Name`) and values pulled from the current input via the filters on the right of each colon. This is the standard way to _reshape_ a record down to only the fields you need, discarding everything else (like the noisy `attributes` block SOQL responses always include).
- `jq`'s shorthand `{Id, Name}` (omitting `: .Id` when the target key name matches the source field name exactly) works identically to `{Id: .Id, Name: .Name}` — both are shown here in full for clarity, but the shorthand is common in terse one-liners.
- Wrapping the whole `.result.records[] | {...}` pipeline in `[...]` collects the stream of individual objects back into a single JSON **array**, rather than leaving them as separate top-level values — necessary if the payload needs to be valid as one JSON document (e.g., a single `curl -d @file.json` body) rather than newline-delimited JSON.
- `-c` (**compact output**) — prints each JSON value on a single line with no extra whitespace, the opposite of the pretty-printing from Scenario 1.1. This is the right flag when the output is destined for another program (a file another script will parse, an HTTP request body, a line-oriented log) rather than for human eyes — compact JSON is smaller and, when combined with one-object-per-line conventions, easier to `grep`/stream-process downstream.

---

## 5. Advanced Scripting & Pipeline Integration

### Scenario 5.1 — Parse Deployment Errors into a Clean Summary Table

**SFDX Context:** `sf project deploy start --json` (or `deploy validate --json`) returns a `result.details.componentFailures` array when a deploy fails — each entry has the component's type, name, and the specific problem. You want a scannable table for the console or a CI log, not a JSON dump.

**Naive Command (text parsing):**

```bash
sf project deploy start --json | grep -A3 '"problemType": "Error"'
```

Assumes `fileName`/`fullName`/`problem` always sit within three lines _after_ `problemType` in the pretty-printed output — true only until Salesforce reorders keys in a future CLI version, and it can't align the results into columns.

**Dedicated `jq` Command:**

```bash
sf project deploy start --json | jq -r '
  .result.details.componentFailures[]?
  | [.componentType, .fullName, .problem] | @tsv
' | column -t -s $'\t'
```

**Deep Syntax & Filter Breakdown:**

- `.componentFailures[]?` — the **optional operator** `?`. Without it, if `componentFailures` doesn't exist on this response (e.g. the deploy actually _succeeded_, so `result.details` has no failures key at all, or has a different shape), applying `[]` to `null` throws a hard error and kills the whole pipeline (`Cannot iterate over null`). Appending `?` makes `jq` treat that error as "produce nothing" instead of crashing — the filter silently yields zero results and the script continues. This is the single most important defensive habit in this guide: append `?` to any `[]` or `.key` access that might legitimately be absent, especially deploy results, empty query results, and optional API response fields.
- `[.componentType, .fullName, .problem] | @tsv` — same array-then-format pattern as `@csv` in Scenario 4.2, but `@tsv` separates fields with a literal tab character instead of commas — a better fit here because deploy `problem` messages routinely contain commas themselves, and TSV sidesteps needing to quote them.
- Piping the whole `jq` output into `column -t -s $'\t'` (a standard Unix table-formatter, not `jq`) auto-aligns the tab-separated columns into a padded, readable table — `jq` produces the _correct, delimited_ data; a downstream tool handles the _visual_ alignment, which is the right division of labor rather than trying to hand-pad strings inside the `jq` filter itself.
- Swap `sf project deploy start` for `sf project deploy validate` to get the identical report from a dry-run validation, without touching the filter at all — both commands share the same `result.details.componentFailures` shape.

---

### Scenario 5.2 — Extract `accessToken` and `instanceUrl` to Build a Direct API `curl` Request

**SFDX Context:** You need to call a Salesforce REST endpoint directly (one not wrapped by any `sf` command) — this requires the current org's session `accessToken` and `instanceUrl`, both returned by `sf org display --json --verbose` (the `--verbose` flag is required for `accessToken` to be included in the payload).

**Naive Command (text parsing):**

```bash
TOKEN=$(sf org display --json --verbose | grep '"accessToken"' | cut -d'"' -f4)
URL=$(sf org display --json --verbose | grep '"instanceUrl"' | cut -d'"' -f4)
curl -H "Authorization: Bearer $TOKEN" "$URL/services/data/v60.0/limits"
```

Works, technically, on stable output — but requires two separate CLI invocations (or careful re-parsing of a saved copy), and any accidental match of `instanceUrl` appearing elsewhere in a verbose payload (e.g. inside a nested connected-app metadata block) silently produces the wrong URL with no error.

**Dedicated `jq` Command:**

```bash
ORG_JSON=$(sf org display --json --verbose)
TOKEN=$(echo "$ORG_JSON" | jq -r '.result.accessToken')
INSTANCE_URL=$(echo "$ORG_JSON" | jq -r '.result.instanceUrl')

curl -s -H "Authorization: Bearer $TOKEN" \
  "$INSTANCE_URL/services/data/v60.0/limits" | jq .
```

**Deep Syntax & Filter Breakdown:**

- Capturing `sf org display --json --verbose` **once** into `$ORG_JSON` and running two separate `jq` filters against the shell variable (rather than invoking `sf` twice) avoids hitting the org a second time just to extract a second field — a good habit whenever you need more than one value out of the same CLI call, since some `sf` commands (`data query`, `apex run`) are slow or rate-limited.
- `.result.accessToken` / `.result.instanceUrl` — plain member access, no iteration needed since `org display` returns a single object, not an array of orgs.
- The final `curl ... | jq .` at the end pretty-prints whatever the REST API itself returns — ties back to Scenario 1.1, since this is now genuinely arbitrary JSON from Salesforce's API rather than from the `sf` CLI, and the exact same tool applies unchanged.
- **Security note:** `accessToken` is a live session credential with the same privileges as the logged-in user — avoid `echo`-ing it directly to a terminal you're screen-sharing or logging to CI output uncensored; capturing it into a shell variable as shown (rather than printing it) is the safer pattern, and CI logs should mask it explicitly if it's ever printed for debugging.

---

## 6. Operator & Safety Reference

A consolidated cheat sheet for every operator used above, plus the defensive patterns worth defaulting to when scripting against `sf` output that may be incomplete, empty, or shaped differently than expected.

| Operator / Flag                | Meaning                                                                                                             | Example                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `.`                            | Identity — pass the input through unchanged                                                                         | `jq .`                                        |
| `.key`                         | Object member access                                                                                                | `.result.status`                              |
| `.a.b.c`                       | Chained/nested member access                                                                                        | `.result.details.componentFailures`           |
| `[]`                           | Array iterator — emit each element as a separate value                                                              | `.result.records[]`                           |
| `[]?`                          | **Optional** array iterator — emit nothing instead of erroring if the input is `null`/not an array                  | `.result.details.componentFailures[]?`        |
| `.key?`                        | Optional member access — suppress the error if `.key` doesn't exist on this value's type                            | `.result.accessToken?`                        |
| `\| `                          | Pipe — feed left-hand output as right-hand input                                                                    | `.result.tests[] \| select(.Outcome=="Fail")` |
| `select(cond)`                 | Keep the current value if `cond` is true, drop it otherwise                                                         | `select(.AnnualRevenue > 1000000)`            |
| `\(...)`                       | String interpolation inside a `"..."` literal                                                                       | `"ID: \(.Id)"`                                |
| `{k: .v}`                      | Object construction — build a new object                                                                            | `{Id: .Id, Name: .Name}`                      |
| `[a, b]`                       | Array construction                                                                                                  | `[.Id, .Name]`                                |
| `,`                            | Comma operator — run both filters against the same input, emit both outputs                                         | `["Id"], (.result.records[] \| [.Id])`        |
| `+`                            | Concatenate two arrays, merge two objects, or add two numbers                                                       | `.nonScratchOrgs + .scratchOrgs`              |
| `length`                       | Count array elements / object keys / string characters                                                              | `.result.records \| length`                   |
| `test(re; flags)`              | Regex boolean match                                                                                                 | `.Name \| test("^Acme"; "i")`                 |
| `@csv` / `@tsv`                | Render an array of scalars as one delimited, correctly-quoted line                                                  | `[.Id, .Name] \| @csv`                        |
| `-r`                           | Raw output — strip quotes from string results                                                                       | `jq -r '.result.username'`                    |
| `-c`                           | Compact output — one JSON value per line, no pretty-print whitespace                                                | `jq -c '{Id, Name}'`                          |
| `-n`                           | Null input — start from `null` instead of reading stdin                                                             | `jq -n '{now: now}'`                          |
| `-e`                           | Exit with non-zero status if the last output value is `false`/`null`/absent — lets `jq` drive shell `if`/`&&` logic | `jq -e '.result.success == true'`             |
| `// ""` (alternative operator) | Fallback value if the left side is `null`/`false`                                                                   | `.StackTrace // "no stack trace"`             |

### Safety Tips for Scripting Against `sf` JSON

- **Default to `?` on any path that walks into a `result` sub-object that isn't guaranteed present.** `sf` command payloads differ meaningfully between success and failure — `componentFailures` only exists on a failed deploy, `tests` failures only exist if something actually failed, `scratchOrgs` may be an empty array or absent entirely on a fresh Dev Hub. Writing `.result.details.componentFailures[]?` costs nothing on the happy path and prevents `jq: error (at <stdin>:0): Cannot iterate over null (null)` from killing an otherwise-working CI pipeline.
- **Use `// <fallback>` for values that might be `null` but shouldn't stop the script**, e.g. `.StackTrace // "N/A"` — the `//` alternative operator returns its left side unless that's `null` or `false`, in which case it returns the right side instead.
- **Check exit status with `-e` when `jq` is the thing deciding pass/fail in a script**, e.g. `sf project deploy validate --json | jq -e '.result.success'` — combined with `&&`/`||` in bash, this lets `jq` itself gate whether the script continues, rather than parsing text like `"success": true` and hoping a string comparison lines up.
- **Prefer `select()` over piping into `grep` afterward.** Once you've extracted fields with `jq`, filtering the _remaining_ JSON stream with more `jq` (rather than falling back to text tools on jq's own output) keeps every stage of the pipeline JSON-aware and composable — losing structure early is the exact trap this whole guide exists to avoid.
- **When in doubt about a payload's shape, run `jq .` on it first** (Scenario 1.1) before writing the "real" filter — never guess a schema from documentation or memory when you can pretty-print the actual response in five seconds.
