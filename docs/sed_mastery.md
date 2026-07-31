# Sed Mastery Guide for Salesforce Metadata

A production-grade reference for bulk find-and-replace, string manipulation, and in-place file updates across a Salesforce DX codebase. Once you've _located_ files (`find_mastery.md`) and _searched_ their content (`grep_mastery.md`), `sed` is the tool that actually rewrites metadata at scale — API version bumps, namespace stripping, permission toggles, and merge-conflict cleanup — without opening a single file by hand.

---

## 0. Prerequisites & The GNU vs. BSD `sed -i` Trap

`sed` ships on every Unix-like system, but **two incompatible implementations exist**, and this single difference causes more broken CI scripts than any other `sed` issue:

- **GNU sed** (default on Linux, WSL, Git Bash on Windows): `sed -i 's/old/new/g' file` edits in place directly. Passing a suffix (`sed -i.bak ...`) is _optional_ — if you omit it, no backup is made.
- **BSD sed** (default on macOS): `-i` **requires an argument** for the backup-file suffix, and that argument must be _directly attached with no space_, or `sed` will silently misinterpret the next word as the suffix. To make no backup on macOS, you must pass an **explicit empty string**:

    ```bash
    # GNU (Linux) — backup suffix optional
    sed -i 's/old/new/g' file.xml

    # BSD (macOS) — empty string satisfies -i's mandatory argument, meaning "no backup"
    sed -i '' 's/old/new/g' file.xml
    ```

    If you write `sed -i 's/old/new/g' file.xml` on macOS, BSD `sed` interprets `'s/old/new/g'` **as the backup suffix**, treats `file.xml` as the script, and fails (or worse, silently does the wrong thing). This is _the_ single most common cross-platform `sed` bug.

- **Portable idiom** used throughout this guide when a script must run on both platforms:
    ```bash
    sed -i.bak 's/old/new/g' file.xml && rm file.xml.bak
    ```
    Using an explicit non-empty suffix (`.bak`) works identically on GNU and BSD, then the backup is deleted immediately after — sidestepping the empty-string quoting difference entirely.
- **Modern Alternative — `sd`:** a Rust-based find-and-replace tool with one syntax on every platform (no GNU/BSD split), safer default regex handling, and no delimiter-escaping headaches. Install with `brew install sd` / `cargo install sd` / `choco install sd`.
- **Modern Alternative — `xmlstarlet`:** an XML-aware toolkit (`xmlstarlet ed`) that edits XML by _node/XPath_, not by text pattern — the correct choice whenever a "text replace" scenario is actually an "XML structure edit" in disguise (see Scenarios 1, 2, and 9).

---

## 1. API Version Upgrade

**SFDX Context:** After a Salesforce release, every metadata file's `<apiVersion>` needs bumping — e.g., from `58.0` to `61.0` — across all `*-meta.xml` files project-wide.

**Standard Command — GNU `sed` (Linux):**

```bash
sed -i 's/<apiVersion>58.0<\/apiVersion>/<apiVersion>61.0<\/apiVersion>/g' force-app/**/*-meta.xml
```

**Standard Command — BSD `sed` (macOS):**

```bash
sed -i '' 's/<apiVersion>58.0<\/apiVersion>/<apiVersion>61.0<\/apiVersion>/g' force-app/**/*-meta.xml
```

**Modern Alternative (`sd`):**

```bash
sd '<apiVersion>58.0</apiVersion>' '<apiVersion>61.0</apiVersion>' force-app/**/*-meta.xml
```

**Modern Alternative (`xmlstarlet`, structurally correct):**

```bash
find force-app -name "*-meta.xml" -exec xmlstarlet ed -L -u "//*[local-name()='apiVersion']" -v "61.0" {} \;
```

**Deep Syntax Breakdown:**

- `s/find/replace/g` — the substitute command: `s` starts a substitution, `find` and `replace` are separated by the delimiter (`/` here), and the trailing `g` (**global**) means replace _every_ match on the line, not just the first. Without `g`, `sed` stops after the first match per line.
- `<\/apiVersion>` — the forward slash inside the closing tag must be **escaped with `\`** because `/` is also the field delimiter; an unescaped `/` here would prematurely end the `find` portion.
- `-i` (in-place) — writes changes directly back to the file instead of printing to stdout. This is where GNU and BSD diverge (see Prerequisites).
- `sd` avoids the delimiter-escaping problem entirely — it takes `find` and `replace` as separate shell arguments, so no `/` needs escaping, and it treats patterns as literal-by-default-safe regex.
- `xmlstarlet ed -L -u "<xpath>" -v "<value>"` — `-L` edits in place, `-u` (update) selects a node by XPath and `-v` sets its text value. This is the _only_ approach in this scenario that is 100% safe against accidental double-replacement or matching an unrelated `58.0` string elsewhere in the file, because it targets the XML node itself, not text.
- **Why prefer text-based `sed` here anyway in practice:** `<apiVersion>` values are narrowly-scoped and rarely appear elsewhere in a file, so the risk `xmlstarlet` guards against is low — `sed`/`sd` remain the fast, common choice for this specific scenario.

---

## 2. Permission Toggle

**SFDX Context:** Bulk-enabling a specific permission (e.g., a custom permission or object permission) across a targeted set of Permission Set XML files — for example, turning on a feature flag permission for a rollout.

**Standard Command — GNU `sed`:**

```bash
sed -i 's/<enabled>false<\/enabled>/<enabled>true<\/enabled>/g' force-app/main/default/permissionsets/Rollout_*.permissionset-meta.xml
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' 's/<enabled>false<\/enabled>/<enabled>true<\/enabled>/g' force-app/main/default/permissionsets/Rollout_*.permissionset-meta.xml
```

**Modern Alternative (`sd`):**

```bash
sd '<enabled>false</enabled>' '<enabled>true</enabled>' force-app/main/default/permissionsets/Rollout_*.permissionset-meta.xml
```

**Deep Syntax Breakdown:**

- **Danger flag for this scenario specifically:** `<enabled>false</enabled>` is a _generic_ tag pattern that appears many times per Permission Set file (once per field/object/permission entry) — a blind global replace turns **every** disabled permission ON, which is almost never the intent.
- **Safer, targeted approach** — scope the match to the surrounding block using `sed` range addressing or, better, use `xmlstarlet` to target the exact `<fieldPermissions>`/`<userPermissions>` node by its sibling `<field>`/`<name>` value:
    ```bash
    xmlstarlet ed -L \
      -u "//fieldPermissions[field='My_Field__c']/enabled" -v "true" \
      force-app/main/default/permissionsets/Rollout_Feature.permissionset-meta.xml
    ```
- `//fieldPermissions[field='My_Field__c']/enabled` — an XPath predicate: select the `<fieldPermissions>` node whose child `<field>` equals `My_Field__c`, then update _its_ `<enabled>` child specifically — impossible to express safely with a flat text substitution.
- This scenario is the clearest illustration in the whole guide of _when to abandon `sed`/`sd` entirely_ in favor of an XML-aware tool: whenever the tag you're changing is repeated many times per file and only specific occurrences should change.

---

## 3. Namespace Removal

**SFDX Context:** After un-managing a package or migrating fields out of a namespace, every reference to `my_namespace__Field__c` (in Apex, triggers, and XML) needs its `my_namespace__` prefix stripped, leaving plain `Field__c`.

**Standard Command — GNU `sed`:**

```bash
sed -i 's/my_namespace__//g' force-app/**/*.{cls,trigger,xml}
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' 's/my_namespace__//g' force-app/**/*.{cls,trigger,xml}
```

**Modern Alternative (`sd`):**

```bash
sd 'my_namespace__' '' force-app/**/*.{cls,trigger,xml}
```

**Deep Syntax Breakdown:**

- `s/my_namespace__//g` — an empty `replace` portion between the second and third delimiter means "delete every match" rather than substitute it with new text.
- **Trailing double-underscore trap:** managed package namespace prefixes always end in `__` (double underscore), which is also how custom field/object API names separate the namespace from the developer name (`Namespace__Object__c`). Stripping `my_namespace__` cleanly leaves `Object__c` intact — but always verify the literal string includes the trailing underscores, or you'll get a mangled `_Object__c`.
- No character in `my_namespace__` requires regex escaping (it's alphanumeric plus underscore), making this one of the few scenarios where the literal string is _already_ a valid regex with zero adjustment needed.
- `sd` shines here for readability — `sd 'my_namespace__' ''` reads as plainly as possible with no delimiter or escaping concerns at all.

---

## 4. Deleting Specific Lines (Removing `System.debug` / Comments)

**SFDX Context:** Pre-production cleanup — stripping every `System.debug(...)` statement (common before a performance-sensitive release) or removing single-line `//` comments left behind from development.

**Standard Command — GNU `sed`:**

```bash
sed -i '/System\.debug(/d' force-app/main/default/classes/*.cls
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' '/System\.debug(/d' force-app/main/default/classes/*.cls
```

**Modern Alternative (`sd`):**

```bash
sd '(?m)^.*System\.debug\(.*$\n' '' force-app/main/default/classes/*.cls
```

**Deep Syntax Breakdown:**

- `/pattern/d` — an **address + command** form, distinct from `s///`: `/pattern/` selects which lines to act on (the "address"), and `d` is the **delete** command applied to every selected line. No substitution syntax or delimiters-as-`/`-separators are involved here at all.
- `System\.debug(` — the `.` in `System.debug` is escaped (`\.`) because an unescaped `.` in regex matches _any single character_; without escaping, `SystemXdebug(` would also incorrectly match.
- **Caveat:** this deletes the _entire line_. If a `System.debug(...)` call is one part of a multi-statement line, or if it spans multiple lines (a long message split across lines), this simple line-address delete will either under- or over-delete. For multi-line statements, a proper Apex-aware tool (or manual review) is safer than `sed`.
- `sd` requires the `(?m)` (multiline) flag and an explicit `\n` in the replacement pattern to emulate line-deletion behavior, since `sd`'s default mental model is "substitute matched text," not "delete matched lines" — `sed`'s dedicated `d` command is actually more ergonomic for this specific scenario.

---

## 5. Inserting Lines

**SFDX Context:** Enforcing a standard test-class annotation (`@IsTest(SeeAllData=false)`) directly above every `public class ... Test` declaration that's missing it, as part of a test-data-isolation compliance sweep.

**Standard Command — GNU `sed`:**

```bash
sed -i '/^public class .*Test/i\@IsTest(SeeAllData=false)' force-app/main/default/classes/*Test.cls
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' '/^public class .*Test/i\
@IsTest(SeeAllData=false)' force-app/main/default/classes/*Test.cls
```

**Modern Alternative (`sd`):**

```bash
sd '(?m)^(public class .*Test)' '@IsTest(SeeAllData=false)\n$1' force-app/main/default/classes/*Test.cls
```

**Deep Syntax Breakdown:**

- `/pattern/i\` — the **insert** command (`i`), which adds a new line **before** every line matching `/pattern/`. (`a\` is the sibling command for **append**, adding a line _after_ the match.)
- **GNU vs. BSD divergence again:** GNU `sed` accepts the inserted text on the same line after `i\` (as shown). Classic BSD `sed` is stricter and requires the inserted text on its **own line following a literal backslash-newline**, which is why the BSD example above breaks the command across two lines inside the quotes.
- `^public class .*Test` — `^` anchors the match to the start of the line, ensuring only actual class declarations trigger the insert, not incidental substring matches elsewhere in the file.
- `sd`'s approach uses a **capture group** `(public class .*Test)` and back-reference `$1` in the replacement to _re-emit_ the matched line after inserting new text above it — a substitution-based way of achieving the same "insert before" effect, since `sd` has no dedicated insert command.
- This scenario is a good candidate for **manual verification after running** — always re-`grep` for `@IsTest(SeeAllData=false)` count vs. `*Test.cls` file count to confirm no double-insertion occurred on a second run.

---

## 6. Alternative Delimiters (Replacing URLs / Paths)

**SFDX Context:** Migrating hardcoded sandbox references from `https://test.salesforce.com` to `https://login.salesforce.com` — a path full of forward slashes that would otherwise require heavy backslash-escaping.

**Standard Command — GNU `sed`:**

```bash
sed -i 's|https://test.salesforce.com|https://login.salesforce.com|g' force-app/**/*.cls
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' 's|https://test.salesforce.com|https://login.salesforce.com|g' force-app/**/*.cls
```

**Modern Alternative (`sd`):**

```bash
sd 'https://test\.salesforce\.com' 'https://login.salesforce.com' force-app/**/*.cls
```

**Deep Syntax Breakdown:**

- `s|old|new|g` — `sed`'s substitute command doesn't require `/` as the delimiter; **any character not appearing in the pattern** can serve as the delimiter. Using `|` here means the literal `/` characters inside the URLs need **no escaping at all**.
- Compare to the escaping nightmare of using `/` as the delimiter for the same replacement: `s/https:\/\/test\.salesforce\.com/https:\/\/login.salesforce.com/g` — every `/` in the URL would need a `\` in front of it, hurting readability and inviting mistakes.
- Common alternative delimiter choices: `|`, `#`, `,`, `@` — pick whichever character is guaranteed absent from both `find` and `replace`.
- `sd` never has this problem in the first place since it takes plain string/regex arguments with no delimiter concept — one more reason it's often preferred for path/URL replacements.

---

## 7. Multi-File Batch Replacement (Combining `find` + `sed`)

**SFDX Context:** Safely applying a tag replacement across every XML file inside `force-app`, recursively, including deeply nested LWC/Aura metadata — without relying on shell globbing (which can silently skip files or hit "argument list too long" on huge trees).

**Standard Command — GNU `sed`:**

```bash
find force-app -type f -name "*.xml" -exec sed -i 's/<status>Draft<\/status>/<status>Active<\/status>/g' {} +
```

**Standard Command — BSD `sed`:**

```bash
find force-app -type f -name "*.xml" -exec sed -i '' 's/<status>Draft<\/status>/<status>Active<\/status>/g' {} +
```

**Modern Alternative (`sd`, no `find` needed):**

```bash
fd -e xml . force-app -x sd '<status>Draft</status>' '<status>Active</status>'
```

**Deep Syntax Breakdown:**

- `-exec ... {} +` — the `+` terminator (vs. `\;`) batches as many matched files as possible into a single `sed` invocation, dramatically faster than spawning one `sed` process per file, and immune to shell argument-length limits since `find` manages the batching internally.
- This is the **production-safe pattern**: shell glob expansion (`force-app/**/*.xml`) depends on shell options (`globstar` must be enabled in bash for `**` to recurse) and can silently return zero matches or partial matches if misconfigured — `find -exec` has no such dependency.
- `fd ... -x sd ...` — `fd`'s `-x` flag runs `sd` once per matched file (mirroring `-exec {} \;` behavior); use `-X` for the batched equivalent of `-exec {} +`.
- Always dry-run this pattern first with `find force-app -type f -name "*.xml" -exec grep -l "<status>Draft</status>" {} +` to preview exactly which files will be touched before adding `sed -i`.

---

## 8. Trimming Trailing Whitespace

**SFDX Context:** Editors/IDEs sometimes leave trailing spaces at line-ends in `.cls` files, which trips up linters and creates noisy git diffs on every subsequent edit to that line.

**Standard Command — GNU `sed`:**

```bash
sed -i 's/[ \t]*$//' force-app/main/default/classes/*.cls
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' 's/[ \t]*$//' force-app/main/default/classes/*.cls
```

**Modern Alternative (`sd`):**

```bash
sd '[ \t]+$' '' force-app/main/default/classes/*.cls
```

**Deep Syntax Breakdown:**

- `[ \t]*$` — `[ \t]` is a character class matching either a literal space or a tab; `*` allows zero-or-more of them; `$` anchors the match to the **end of the line**. Together: "match any trailing run of spaces/tabs right before line-end."
- Using `*` (zero-or-more) rather than `+` (one-or-more) in the `sed` version is deliberate — BSD `sed`'s default BRE mode doesn't support `+` at all without `-E`, so `*` keeps this portable across both GNU and BSD without needing the extended-regex flag.
- The replacement is empty (nothing between the 2nd and 3rd `/`), meaning "delete the matched trailing whitespace, keep everything else on the line."
- `sd` uses `+` freely since its regex engine always supports it — no BRE/ERE distinction exists in `sd`.

---

## 9. XML Tag Bulk Deletion

**SFDX Context:** Removing every `<description>...</description>` block from object/field metadata — e.g., stripping verbose internal notes before delivering a package to an external partner.

**Standard Command — GNU `sed`:**

```bash
sed -i '/<description>/,/<\/description>/d' force-app/main/default/objects/**/*.xml
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' '/<description>/,/<\/description>/d' force-app/main/default/objects/**/*.xml
```

**Modern Alternative (`xmlstarlet`, structurally correct):**

```bash
find force-app/main/default/objects -name "*.xml" -exec xmlstarlet ed -L -d "//*[local-name()='description']" {} \;
```

**Deep Syntax Breakdown:**

- `/start/,/end/d` — a **range address**: matches every line from the first line containing `<description>` through the first subsequent line containing `</description>`, inclusive, and deletes the entire range. This correctly handles multi-line description blocks that a single-line `/pattern/d` could not.
- **Single-line tag risk:** if `<description>Some text</description>` appears entirely on one line, the _same_ line satisfies both the start and end address — GNU and BSD `sed` both handle this correctly (the range closes on the same line it opens), but it's worth verifying with a dry run (`sed -n '/<description>/,/<\/description>/p' file.xml`) before deleting.
- `xmlstarlet ed -d "<xpath>"` — the **delete** node-edit action; `-d "//*[local-name()='description']"` removes every `<description>` element (using `local-name()` to stay namespace-agnostic, since Salesforce metadata XML declares a default namespace that can otherwise break plain `//description` XPath matches).
- **Recommendation:** for any "delete an entire tag/block" scenario, `xmlstarlet` is structurally guaranteed correct (it parses real XML), while the `sed` range-delete is a text heuristic that can misfire on unusual formatting (e.g., nested tags of the same name, or a `<description>` mentioned inside a comment). Use `sed` for quick one-offs you'll visually diff afterward; use `xmlstarlet` for anything scripted/unattended.

---

## 10. Capitalization / Prefix Conversion

**SFDX Context:** Enforcing a naming-convention rollout — prepending a standard prefix (e.g., `LEGACY_`) to a batch of field labels ahead of a deprecation cycle, to make them visually obvious in Setup.

**Standard Command — GNU `sed`:**

```bash
sed -i 's/<label>\(.*\)<\/label>/<label>LEGACY_\1<\/label>/g' force-app/main/default/objects/Account/fields/Old_*.field-meta.xml
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' 's/<label>\(.*\)<\/label>/<label>LEGACY_\1<\/label>/g' force-app/main/default/objects/Account/fields/Old_*.field-meta.xml
```

**Modern Alternative (`sd`):**

```bash
sd '<label>(.*)</label>' '<label>LEGACY_$1</label>' force-app/main/default/objects/Account/fields/Old_*.field-meta.xml
```

**Deep Syntax Breakdown:**

- `\(.*\)` — a **capture group** in BRE syntax: parentheses must be backslash-escaped (`\(` `\)`) in basic `sed` regex to have special (grouping) meaning — unescaped parentheses are literal characters in BRE. `.*` inside the group greedily captures the existing label text.
- `\1` — a **back-reference** in the replacement, re-inserting whatever the first capture group matched — this is what lets you _prepend_ text while preserving the original label value rather than overwriting it.
- In `sd`, capture groups use plain regex syntax `(.*)` (no backslash needed — `sd` always operates in an "extended"-like mode), and the back-reference in the replacement is `$1` instead of `\1`.
- If GNU-only extended regex is preferred, add `-E`/`-r` (GNU accepts either; BSD only accepts `-E`) to drop the backslashes: `sed -E 's/<label>(.*)<\/label>/<label>LEGACY_\1<\/label>/g'` — note the back-reference in the _replacement_ is still `\1` even in ERE mode; only the _pattern-side_ grouping parentheses become unescaped.

---

## 11. Updating Field Label Names (Bulk Rename)

**SFDX Context:** A business rename — e.g., "Account Manager" is being renamed to "Relationship Owner" across every object where that field label appears, spanning multiple `.field-meta.xml` files.

**Standard Command — GNU `sed`:**

```bash
find force-app -name "*.field-meta.xml" -exec sed -i 's/<label>Account Manager<\/label>/<label>Relationship Owner<\/label>/g' {} +
```

**Standard Command — BSD `sed`:**

```bash
find force-app -name "*.field-meta.xml" -exec sed -i '' 's/<label>Account Manager<\/label>/<label>Relationship Owner<\/label>/g' {} +
```

**Modern Alternative (`xmlstarlet`, structurally correct):**

```bash
find force-app -name "*.field-meta.xml" -exec xmlstarlet ed -L -u "//*[local-name()='label'][text()='Account Manager']" -v "Relationship Owner" {} \;
```

**Deep Syntax Breakdown:**

- This combines Scenario 1's exact-tag-match pattern with Scenario 7's `find -exec` batching — the standard production idiom for any bulk metadata rename: **locate candidate files, then substitute an exact old/new tag pair, batched for performance.**
- `Account Manager` contains a space, not a regex metacharacter, so no escaping is needed for the space itself — but always double-check for characters like `&`, which in the _replacement_ side of `sed` has special meaning (it re-inserts the whole match) and must be escaped as `\&` if it should be literal.
- `xmlstarlet`'s `[text()='Account Manager']` XPath predicate is the safest option because it only touches `<label>` nodes whose _exact_ text equals `Account Manager` — a plain `sed` text substitution would also (harmlessly, in this case) match the same string if it appeared inside a comment or an unrelated attribute value, which `xmlstarlet` structurally cannot do.
- Always run the equivalent `grep -rc "Account Manager" force-app` before and after to confirm the expected number of replacements occurred — a mismatch signals either missed files or unintended matches.

---

## 12. Cleaning Up Git Merge Conflict Markers

**SFDX Context:** A bad merge/rebase left `<<<<<<<`, `=======`, or `>>>>>>>` conflict markers committed inside XML metadata — these break XML parsing entirely and must be purged (along with, typically, manual review of which side of the conflict to keep).

**Standard Command — GNU `sed`:**

```bash
sed -i '/^<<<<<<<\|^=======\|^>>>>>>>/d' force-app/**/*.xml
```

**Standard Command — BSD `sed`:**

```bash
sed -i '' -E '/^(<<<<<<<|=======|>>>>>>>)/d' force-app/**/*.xml
```

**Modern Alternative (`sd`):**

```bash
sd '(?m)^(<<<<<<<|=======|>>>>>>>).*$\n' '' force-app/**/*.xml
```

**Deep Syntax Breakdown:**

- `^<<<<<<<\|^=======\|^>>>>>>>` — GNU `sed`'s BRE mode supports `\|` as a GNU-specific extension for alternation (not portable to BSD `sed`, which does not support `\|` at all in BRE mode).
- The BSD version instead uses `-E` (extended regex) explicitly, enabling plain `|` alternation grouped with `()` — this is the **correct portable fix**, since relying on GNU's `\|` extension silently breaks on macOS.
- `^` anchors ensure only lines that _start_ with a conflict marker are deleted — important because `=======` in particular is a short, generic-looking string that could theoretically appear as legitimate content elsewhere (though rare in XML).
- **This is a destructive, blunt-instrument fix** — it removes the marker lines but does **nothing** about _which_ conflicting content (ours vs. theirs) to keep; those lines remain in the file untouched, now unmarked and easy to miss. Always follow this cleanup with a full diff review before committing, and treat it as a last-resort script for a batch of files where you've already manually confirmed which side should "win," rather than a substitute for resolving each conflict properly.
- `sd`'s pattern uses `(?m)` (multiline mode, so `^`/`$` match per-line rather than only at the string's start/end) plus a trailing `\n` in both pattern and replacement to fully remove the line (including its newline), not just blank it out.

---

## Summary Cheat Sheet

| Scenario                 | GNU `sed`                                    | BSD `sed`                                        | Modern (`sd` / `xmlstarlet`)                       |
| ------------------------ | -------------------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| API version upgrade      | `sed -i 's/58.0/61.0/g' file.xml`            | `sed -i '' 's/58.0/61.0/g' file.xml`             | `sd '58.0' '61.0' file.xml`                        |
| Permission toggle        | `sed -i 's/false/true/g' file`               | `sed -i '' 's/false/true/g' file`                | `xmlstarlet ed -L -u "XPath" -v true file`         |
| Namespace removal        | `sed -i 's/ns__//g' file`                    | `sed -i '' 's/ns__//g' file`                     | `sd 'ns__' '' file`                                |
| Delete lines             | `sed -i '/pattern/d' file`                   | `sed -i '' '/pattern/d' file`                    | n/a (use `sed -d`)                                 |
| Insert line              | `sed -i '/pat/i\text' file`                  | `sed -i '' '/pat/i\`⏎`text' file`                | `sd '(?m)^(pat)' 'text\n$1' file`                  |
| Alt delimiters           | `sed -i 's\|old\|new\|g' file`               | `sed -i '' 's\|old\|new\|g' file`                | `sd 'old' 'new' file`                              |
| Batch across dirs        | `find ... -exec sed -i 's/a/b/g' {} +`       | `find ... -exec sed -i '' 's/a/b/g' {} +`        | `fd ... -X sd 'a' 'b'`                             |
| Trim trailing whitespace | `sed -i 's/[ \t]*$//' file`                  | `sed -i '' 's/[ \t]*$//' file`                   | `sd '[ \t]+$' '' file`                             |
| Delete XML tag block     | `sed -i '/<tag>/,/<\/tag>/d' file`           | `sed -i '' '/<tag>/,/<\/tag>/d' file`            | `xmlstarlet ed -L -d "XPath" file`                 |
| Prefix conversion        | `sed -i 's/<l>\(.*\)<\/l>/<l>PRE_\1<\/l>/g'` | same + `-i ''`                                   | `sd '<l>(.*)</l>' '<l>PRE_$1</l>'`                 |
| Field label rename       | `find ... -exec sed -i 's/old/new/g' {} +`   | `find ... -exec sed -i '' 's/old/new/g' {} +`    | `xmlstarlet ed -L -u "XPath[text()='old']" -v new` |
| Conflict marker cleanup  | `sed -i '/^<<<<<<<\|^=======\|^>>>>>>>/d'`   | `sed -i '' -E '/^(<<<<<<<\|=======\|>>>>>>>)/d'` | `sd '(?m)^(<<<<<<<\|=======\|>>>>>>>).*$\n' ''`    |

---

## External Resources

- [GNU sed manual](https://www.gnu.org/software/sed/manual/sed.html) — authoritative GNU `sed` documentation and regex reference.
- [BSD sed man page (macOS)](https://ss64.com/mac/sed.html) — quick reference highlighting BSD-specific flag behavior.
- [`sd` on GitHub](https://github.com/chmln/sd) — source and full usage reference for the modern find-and-replace CLI.
- [`xmlstarlet` documentation](http://xmlstar.sourceforge.net/docs.php) — full command reference for XPath-based XML editing.
