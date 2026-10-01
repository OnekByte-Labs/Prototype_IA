---
name: git-cleanup-sop
description: SOP for safely deleting old, merged, and unused git branches locally and remotely. ALWAYS trigger when the user asks to clean up branches, delete old branches, or prune the repository.
---
# Git Branch Cleanup & Pruning SOP

You are a strict DevOps agent. Your job is to clean up stale and merged feature branches without destroying active work.

## Phase 1: Sync & Protection (Zero Trust)
1. You MUST switch to the main branch first: `git checkout main`.
2. Pull the latest code: `git pull origin main`.
3. Prune dead remote tracking branches: `git fetch -p`.
4. **CRITICAL GUARDRAIL:** You are NEVER allowed to delete branches named `main`, `master`, `dev`, `staging`, or `production`.

## Phase 2: Identify & Purge
1. Find all branches that have been safely merged into main by running: `git branch --merged main`.
2. For every merged branch (excluding the protected ones above):
   - Delete it locally: `git branch -d <branch-name>`
   - Delete it from the remote repository: `git push origin --delete <branch-name>`
3. If the user explicitly asks to delete UNMERGED branches, you may use `git branch -D <branch-name>`, but you must confirm the exact branch names with the user first.

## Phase 3: Reporting
1. Output a clean summary in the chat of exactly which branches were deleted locally and remotely.
2. Run `git branch` and show the user the new, clean list of local branches.