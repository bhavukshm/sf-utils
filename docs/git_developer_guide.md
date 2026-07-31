# Git Developer Reference & Quick Guide

A comprehensive, practical reference for developers covering Git internal mechanics, undo strategies, divergence handling, comparisons, and daily essential workflows.

---

## 1. How Git Works Under the Hood (The Mental Model)

To use Git effectively without fear of losing code, you must understand how Git stores data and tracks where you are.

### 1.1 The Three States & Three Areas

Git manages files across three main areas in your local machine:

```
+------------------+         +------------------+         +------------------+
|   Working Tree   |  add    |   Staging Area   | commit  | Local Repository |
| (Your active files) ------>|     (Index)      |-------->|   (.git directory)|
+------------------+         +------------------+         +------------------+
```

1. **Working Tree (Working Directory):** The actual files on your filesystem that you edit in your IDE.
2. **Staging Area (Index):** A draft space holding snapshot information about files ready to be included in the next commit.
3. **Local Repository (`.git`):** The persistent database containing all your project history, commit objects, trees, blobs, and branch references.

### 1.2 Git's Core Object Model

Git is a content-addressable key-value filesystem. Everything is saved inside `.git/objects` hashed using SHA-1 (or SHA-256):

- **Blob:** Stores raw file content (does not store file names or metadata).
- **Tree:** Represents a directory structure. Maps filenames to blob hashes or sub-tree hashes.
- **Commit:** Points to a root `Tree` hash, contains metadata (author, timestamp, commit message), and points to parent commit(s).
- **Tag:** An explicit label pointing directly to a specific commit object.

### 1.3 Attached HEAD vs. Detached HEAD

`HEAD` is simply a pointer (file inside `.git/HEAD`) indicating your current active location in Git.

#### Attached HEAD State (Normal State)

In an attached state, `HEAD` points to a **branch reference** (e.g., `refs/heads/main`), which in turn points to the latest commit. When you make a new commit, the branch reference moves forward automatically along with `HEAD`.

```
HEAD ---> refs/heads/main ---> [Commit C] ---> [Commit B] ---> [Commit A]
```

#### Detached HEAD State

A **Detached HEAD** occurs when `HEAD` points directly to a **specific commit hash or tag**, rather than a branch name.

```
HEAD -------------------------> [Commit B] ---> [Commit A]
          refs/heads/main ----> [Commit C]
```

##### Practical Example: How you enter a Detached HEAD state

```bash
# Checkout a specific commit hash directly
git checkout a1b2c3d

# OR checkout a tag directly
git checkout v1.0.0
```

##### What happens if you commit in a Detached HEAD state?

You can edit files and make commits. Git will create new commit objects. However, **no branch points to them**. If you switch back to `main`, those new commits become "orphaned" and will eventually be garbage collected by Git!

```bash
# Practical Example: Fixing or Experimenting in Detached HEAD
git checkout a1b2c3d               # Enters Detached HEAD
# ... make edits ...
git commit -am "Experimental fix"  # Commit created in detached state

# If you want to SAVE these changes into a real branch:
git switch -c my-experiment-branch # Attaches HEAD to a new branch!

# If you want to ABANDON these changes:
git switch main                     # HEAD returns to main, detached commits are left behind
```

---

## 2. Divergent Branches: Syncing Local vs Remote

Scenario: Your local branch has commits `A -> B -> C`, but the remote repository has updated to `A -> D -> K`.

```
       ---> B ---> C  (main - Local)
     /
--- A
            ---> D ---> K  (origin/main - Remote)
```

Here are the standard strategies to resolve divergence, ordered by best practices.

### Strategy 1: Rebase (`pull --rebase`) — **BEST PRACTICE (Clean History)**

Rebasing replays your local commits (`B`, `C`) on top of the remote commits (`K`). It keeps a perfectly linear history without unnecessary merge commits.

```bash
# Fetch latest remote references and rebase local commits on top
git pull --rebase origin main
```

_Resulting History:_ `A -> D -> K -> B' -> C'`

### Strategy 2: Explicit Merge (`pull --no-rebase`) — **PRESERVES EXACT TIMELINE**

Merges remote changes into your local branch by creating a dedicated "Merge Commit". Good for public shared branches where exact history preservation is required.

```bash
git pull origin main
```

_Resulting History:_ Creates a new merge commit `M` combining `C` and `K`.

### Strategy 3: Interactive Rebase (`rebase -i`) — **CLEANUP BEFORE PUSHING**

If your local commits `B` and `C` are messy work-in-progress (WIP) commits, clean them up before rebasing onto remote.

```bash
git fetch origin
git rebase -i origin/main
```

_An editor opens allowing you to `squash` (combine), `fixup`, or `reword` your local commits before applying them onto `origin/main`._

### Strategy 4: Hard Reset (`reset --hard`) — **DISCARD LOCAL CHANGES**

If local commits `B` and `C` were an invalid experiment and you want your local branch to match remote exactly.

```bash
git fetch origin
git reset --hard origin/main
```

_Warning:_ Destroys local uncommitted changes and unpushed commits `B` and `C`.

---

## 3. Overriding Remote with Local

When you want to force remote to take your local commits (e.g., after an interactive rebase or squashing commits).

### Best Practice: Force with Lease (Safe)

`--force-with-lease` checks if anyone else pushed commits to the remote branch while you were working. If someone did, it refuses to overwrite and prevents losing a colleague's work.

```bash
git push origin feature-branch --force-with-lease
```

### Destructive Override: Hard Force (Use with Extreme Caution)

Overwrites the remote branch blindly, ignoring any new commits pushed by teammates.

```bash
git push origin feature-branch --force
# short form:
git push origin feature-branch -f
```

---

## 4. Reverting & Undoing Changes

### 4.1 Unstaged Changes (Working Directory)

Discard modifications in your current working directory.

```bash
# Restore single file to last committed state
git restore path/to/file.ext

# Restore all files in current directory
git restore .

# Legacy alternative:
git checkout -- path/to/file.ext
```

### 4.2 Staged Changes (Moving back to Unstaged)

Unstage files without losing your code edits.

```bash
# Unstage single file
git restore --staged path/to/file.ext

# Unstage everything
git restore --staged .

# Legacy alternative:
git reset HEAD path/to/file.ext
```

### 4.3 Clean Untracked Files

Remove untracked files and folders (e.g., build artifacts, temporary logs).

```bash
# Dry run: see what will be removed without deleting
git clean -nd

# Remove untracked files and directories forcefully
git clean -fd
```

### 4.4 Local Committed Changes

Undo local commits that haven't been pushed yet.

```bash
# Soft Reset: Undoes commit, keeps all changes staged
git reset --soft HEAD~1

# Mixed Reset (Default): Undoes commit, keeps changes in Working Directory (unstaged)
git reset --mixed HEAD~1

# Hard Reset: Completely erases the commit AND all changes (DESTRUCTIVE)
git reset --hard HEAD~1
```

### 4.5 Published Remote Commits

If a commit has already been pushed to a shared remote, **never use `git reset`**. Use `git revert` to create a new commit that safely reverses the targeted commit.

```bash
# Revert a specific commit hash safely
git revert <commit-hash>

# Push the reversal to remote
git push origin main
```

---

## 5. Merging & Conflict Resolution

### 5.1 Resolving Merge Conflicts Step-by-Step

1. **Trigger Merge/Rebase:**
    ```bash
    git merge feature-branch
    ```
2. **Identify Conflicts:**
    ```bash
    git status
    ```
    _(Files with conflicts are listed under "Unmerged paths")_
3. **Open and Resolve:** Edit conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in files.
4. **Stage Resolved Files:**
    ```bash
    git add path/to/resolved-file.ext
    ```
5. **Complete Process:**
    ```bash
    git merge --continue   # Or 'git commit' for merge, 'git rebase --continue' for rebase
    ```

### 5.2 Aborting a Stuck Merge or Rebase

If conflict resolution gets too complex and you want to start fresh:

```bash
git merge --abort
# OR
git rebase --abort
```

### 5.3 Cherry-Picking

Copy specific commits from another branch onto your current branch without merging the whole branch.

```bash
# Switch to destination branch
git switch main

# Apply commit from another branch
git cherry-pick <commit-hash>

# Cherry-pick a range of commits
git cherry-pick A_hash..B_hash
```

### 5.4 Automatic Conflict Memory (`rerere`)

Enable **rerere** (Reuse Recorded Resolution) so Git remembers how you resolved a conflict and auto-resolves it next time it occurs.

```bash
git config --global rerere.enabled true
```

---

## 6. Comparing Codebases, Files, and Organizations

### 6.1 Comparing Files & Diffing Tools

```bash
# Compare working directory against staging area
git diff

# Compare staged changes against last commit
git diff --staged

# Compare a file between two commits
git diff commit1_hash commit2_hash -- path/to/file.ext

# Launch visual tool (e.g., Meld, VS Code, KDiff3)
git difftool commit1_hash commit2_hash -- path/to/file.ext
```

_Configuring Meld as your default diff tool:_

```bash
git config --global diff.tool meld
git config --global difftool.prompt false
```

### 6.2 Comparing Specific Folders

```bash
# Diff changes inside a specific folder between two branches/commits
git diff branchA branchB -- src/components/
```

### 6.3 Finding Missing or Changed Files Between Commits

```bash
# Display summary status of files changed between two commits
# (A = Added, M = Modified, D = Deleted)
git diff --name-status commit1_hash commit2_hash

# Show only files present in commit2 but deleted/missing from commit1
git diff --name-status commit1_hash commit2_hash | grep "^D"

# Show list of added files only
git diff --diff-filter=A --name-only commit1_hash commit2_hash
```

### 6.4 Comparing Two Different Repositories / Orgs (e.g., `dev` vs `full`)

When managing two separate Git repositories/orgs (e.g., a lightweight `dev` org vs complete `full` org repository):

```bash
# 1. Add the second org repository as a remote reference inside your local repo
git remote add full_org https://github.com/my-org/full-repo.git

# 2. Fetch all metadata from both org remotes
git fetch --all

# 3. Compare file differences between dev/main and full_org/main
git diff origin/main full_org/main

# 4. Find files present in 'full_org' but missing in 'dev'
git diff --name-status origin/main full_org/main

# 5. Compare a specific directory across both orgs
git diff origin/main full_org/main -- force-app/main/default/classes/
```

---

## 7. Daily Developer Toolkit & Real-World Examples

### 7.1 Stashing (Temporary Storage)

**Real-world scenario:** You are halfway through building a feature when an urgent production bug fix is assigned. You don't want to make an incomplete commit.

```bash
# Stash uncommitted work (including untracked files)
git stash -u -m "WIP: login page styling"

# Switch to main branch to hotfix
git switch main
# ... fix bug, commit, push ...

# Return to feature branch and re-apply stashed work
git switch feature-branch
git stash pop

# List all stashed items
git stash list

# View content of a stash without applying
git stash show -p stash@{0}
```

### 7.2 The Panic Button: `git reflog`

**Real-world scenario:** You accidentally ran `git reset --hard` and lost 3 hours of committed work, or deleted a branch by mistake.

Git records every movement of `HEAD` in the reference log (`reflog`).

```bash
# View full HEAD history, even deleted commits
git reflog

# Output example:
# e4f2a1b HEAD@{0}: reset: moving to HEAD~1
# c3b2a1a HEAD@{1}: commit: Add user dashboard logic

# Recover lost commit using its hash from reflog:
git checkout -b recovered-branch c3b2a1a
```

### 7.3 Log & History Inspection

```bash
# Beautiful visual branch graph in terminal
git log --graph --oneline --all --decorate

# Search commit history for specific text changes (Pickaxe search)
git log -S "API_SECRET_KEY"

# Show history of a specific file including renames
git log --follow -p -- path/to/file.ext
```

### 7.4 Line-by-Line Archaeology: `git blame`

Find out who modified a line of code and in which commit.

```bash
git blame -L 40,60 path/to/file.ext
```

### 7.5 Housekeeping & Remote Cleaning

```bash
# Delete local branch safely
git branch -d feature-branch

# Force delete local unmerged branch
git branch -D feature-branch

# Delete remote branch
git push origin --delete feature-branch

# Clean up stale remote tracking branches (deleted by teammates on GitHub)
git remote prune origin
```

---

## 8. Summary Command Cheat Sheet

| Task                                 | Command                                       |
| :----------------------------------- | :-------------------------------------------- |
| **Check State**                      | `git status`                                  |
| **Unstage File**                     | `git restore --staged <file>`                 |
| **Discard Unstaged Edits**           | `git restore <file>`                          |
| **Undo Last Commit (Keep Edits)**    | `git reset --soft HEAD~1`                     |
| **Safely Revert Remote Commit**      | `git revert <commit-hash>`                    |
| **Sync with Rebase (Best Practice)** | `git pull --rebase origin main`               |
| **Safe Force Push**                  | `git push origin <branch> --force-with-lease` |
| **Compare Repos/Branches**           | `git diff branchA branchB --name-status`      |
| **Recover Deleted Commits**          | `git reflog` then `git checkout <hash>`       |
| **Temporarily Save Work**            | `git stash -u` & `git stash pop`              |
