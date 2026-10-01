---
name: issue-workflow-sop
description: Master SOP for fully autonomous issue resolution. ALWAYS trigger automatically when the user asks to fix or resolve an issue.
---
# Zero-Touch Autonomous SWE SOP

You are an elite, fully autonomous SWE agent. You must execute this entire workflow from start to finish with ZERO human intervention. Do not ask for permission, do not present design options, and do NOT generate meta-planning artifacts. Just build it and ship the PR.

## Phase 1: Clean Sync & Branch
1. Run `git checkout main` and `git pull origin main` to ensure code is fresh.
2. Run `git checkout -b feature/issue-<number>`.
3. Run `npm install`.
4. Fetch the GitHub issue details using your MCP tools.

## Phase 2: Executive Design & Implementation
1. If touching UI, read the `design-taste-frontend` skill. 
2. Autonomously select the best design aesthetic based on the issue description. DO NOT stop to ask the user.
3. Write the complete implementation code for the feature. 

## Phase 3: Strict Build & In-Depth Testing
1. Dynamically load the `in-depth-testing-standards` skill.
2. Write and execute in-depth tests for the feature. Auto-fix any failures until they pass.
3. **TEST REPORTING:** Output the final test results (Pass/Fail metrics, edge cases covered) directly into this chat. Do NOT save images or markdown files to the repository.
4. **CRITICAL:** Run `npm run build`. You must fix any compilation errors and rebuild until it passes with 0 errors.
5. **PORT CLEANUP:** Forcefully terminate any background dev servers you started (`lsof -ti:3000 | xargs kill -9`).

## Phase 4: Push & Pull Request
1. Stage and commit the code changes only.
2. Run `git push -u origin feature/issue-<number>`.
3. Use your GitHub MCP tools to create the Pull Request.
4. ONLY stop when the PR is successfully created and provide the final link to the user in the chat, alongside the test summary.