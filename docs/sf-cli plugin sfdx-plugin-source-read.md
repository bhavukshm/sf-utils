# SF CLI Plugin: sfdx-plugin-source-read

## 1. Header & Overview

- **Category:** Metadata Retrieval (CRUD Metadata API)
- **Primary Purpose:** Reads metadata directly through the **CRUD-based Metadata API** (`readMetadata()`) instead of the **file-based Metadata API** that `sf project retrieve start` uses. The problem this solves is real data completeness, not raw speed: in a **non-source-tracked org**, `sf project retrieve start` on certain metadata types — most notably `Profile`, `RecordType`, and `CustomObjectTranslation` — returns a _stripped-down subset_ (for Profiles: essentially just `userPermissions` plus whatever's referenced in your `package.xml`). A direct CRUD `readMetadata()` call returns the **full** record as the org actually holds it, including entries contributed by managed packages that file-based retrieve silently omits.
- **Installation Command:**
    ```bash
    sf plugins install sfdx-plugin-source-read
    ```
    Published and maintained by GitHub user `amtrack` (MIT license); unsigned third-party plugin — expect the standard authenticity-warning prompt on install.

---

## 2. Deep Dive: What It Does & Key Capabilities

**CRUD Metadata API vs. File-Based Metadata API — the actual mechanical difference:** `sf project retrieve start` (file-based retrieve) packages a zip via the Metadata API's `retrieve()` operation, scoped to whatever a manifest/source-tracking decides is relevant, and unpacks it into source-format files. `sfdx-plugin-source-read`'s command, `sf crud-mdapi read`, instead calls the Metadata API's `readMetadata()` operation directly for named components — the same low-level CRUD-style read the Setup UI itself effectively relies on — and writes the result to source-format files. For most metadata types the two paths return equivalent content; the gap that justifies this plugin's existence is specifically types like `Profile`, where file-based retrieve in a **non-source-tracked** org returns a deliberately limited view (only `userPermissions` and items already listed in your `package.xml`), while `readMetadata()` returns the full profile the org actually has, managed-package entries included.

- **Command topic:** `crud-mdapi` ("Work with the CRUD Metadata API") — the successor to what older tutorials may reference as `sf force source read`.
- **Known tradeoff to be aware of:** because a full CRUD-read Profile includes _every_ entry the org has — including `tabVisibilities` for tabs from managed packages that may not even be installed in a different target org — deploying that fully-read profile back into a different org can throw a deploy error referencing a tab/component that doesn't exist there. This is a documented, known gotcha (upstream issue #66), not a bug in your usage.
- **Why it's superior to file-based retrieve for this narrow case:** for Profiles/RecordTypes/CustomObjectTranslations in a non-source-tracked org, file-based retrieve simply cannot give you the complete picture — there is no flag or workaround on `sf project retrieve start` that changes this behavior, because it's inherent to which API operation is being called. This plugin exists purely to reach the other operation when you need it.

---

## 3. Practical Usage Scenarios & Commands

**Command 1 — Read specific named components by type:name:**

```bash
sf crud-mdapi read --metadata "Profile:Admin" --metadata "Profile:Standard" --target-org my-org
```

`-m/--metadata` accepts one or more `Type:FullName` strings (repeatable flag) — the direct equivalent of naming components in a `package.xml`, but resolved via CRUD read instead of file-based retrieve.

**Command 2 — Read by pointing at existing local source files:**

```bash
sf crud-mdapi read --source-dir force-app/main/default/profiles/Admin.profile-meta.xml --target-org my-org
```

`-d/--source-dir` (repeatable) infers which components to read from the local source files' own paths/names — convenient for refreshing a specific file you already have checked out, without having to re-type its `Type:FullName` identity.

**Command 3 — Read from a manifest file:**

```bash
sf crud-mdapi read --manifest manifest/package.xml --target-org my-org
```

`-x/--manifest` reads component identities from a standard `package.xml`, useful when you already maintain one for a related retrieve/deploy step and want the CRUD-read variant to cover the same component list. `--metadata`, `--manifest`, and `--source-dir` are mutually exclusive — pick exactly one way to specify what to read per invocation.

**Command 4 — RecordType and CustomObjectTranslation reads (the other types this plugin matters for):**

```bash
sf crud-mdapi read --metadata "RecordType:Account.Business" --target-org my-org
sf crud-mdapi read --metadata "CustomObjectTranslation:Task-de" --target-org my-org
```

Same completeness gap as Profiles applies to these types in non-source-tracked orgs — this is the plugin's other primary use case beyond Profile reads.

**Command 5 — Custom output directory:**

```bash
sf crud-mdapi read --metadata "Profile:Admin" --output-dir retrieved-metadata --target-org my-org
```

`-r/--output-dir` sets the root directory the retrieved source files are written into; without it, files land under the project's package directories as defined in `sfdx-project.json`.

**Command 6 — Tuning API batch size for a large read (`--chunk-size`):**

```bash
sf crud-mdapi read --manifest manifest/package.xml --chunk-size 5 --target-org my-org
```

`--chunk-size` controls how many components are requested per underlying `readMetadata()` API call (default `10`, and capped at `10` — the Metadata API's own hard limit for most types via this operation, even though some types like `CustomMetadata`/`CustomApplication` technically allow up to 200 through other paths). Lowering it can help when a batch of components is unusually large/complex and risks timing out a single API call.

---

## 4. Developer Workflow Integration

- **When to reach for this instead of `sf project retrieve start`:** specifically when you need the _complete_, org-actual state of a `Profile`, `RecordType`, or `CustomObjectTranslation` in a **non-source-tracked** org (a sandbox or production org you're not doing continuous source-tracked development against) — e.g., auditing exactly what permissions a managed package silently granted on a profile, or capturing a full RecordType definition before a refactor. For everyday source-tracked scratch-org development, standard `sf project retrieve start`/source-tracking pull remains the right default — this plugin is a targeted tool for a specific, known gap, not a wholesale replacement.
- **Typical trigger points:** a pre-deployment audit step when you suspect a profile's true managed-package-granted permissions aren't visible in your regular retrieve; a one-off metadata forensics task when a profile-related deploy error references something your source-tracked retrieve never showed you; or a migration/cleanup task explicitly targeting Profile/RecordType/CustomObjectTranslation completeness.
- **No dedicated config file** — the project's existing `sfdx-project.json` package directory configuration is used to resolve default output locations when `--output-dir` isn't passed; there's nothing analogous to a `.sgdignore` or `export.json` to set up.
- **Known edge cases / flags to be careful with:**
    - **Full CRUD-read Profiles can carry entries that don't exist in your deploy target** — before deploying a profile read with this tool into a _different_ org than it was read from, review it for `tabVisibilities`/managed-package entries that target org may not have installed; blindly deploying can throw an error referencing a nonexistent component (documented upstream as issue #66). This is the single most important caveat for this plugin.
    - **`--metadata`, `--manifest`, and `--source-dir` are mutually exclusive** — passing more than one in the same invocation is a usage error, not a "most specific wins" merge.
    - **`--chunk-size` has a hard ceiling of 10** for this operation regardless of the value you pass — it's a batching knob for reliability/timeout tuning, not a way to force larger batches.
    - **Must be run inside an actual SFDX project** (`requiresProject = true`) — it resolves output paths relative to `sfdx-project.json`, so it won't run from an arbitrary directory the way a fully standalone CLI tool might.
