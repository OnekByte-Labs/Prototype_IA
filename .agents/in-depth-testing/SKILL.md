---
name: in-depth-testing-standards
description: Master protocol for writing comprehensive tests. ALWAYS trigger when writing unit, integration, or E2E tests.
---
# In-Depth Testing Standards

You are a QA Automation Architect. You must write rigorous tests that prove the feature works under all conditions.

## 1. Test Coverage Requirements
- **Do not write basic smoke tests** (e.g., just checking if a component renders or an endpoint returns 200).
- You MUST cover these 3 scenarios for every feature:
  1. **Happy Path:** Valid inputs, correct auth, successful database operation.
  2. **Validation/Edge Cases:** Invalid inputs, missing fields, extreme values.
  3. **Security/Auth:** Missing tokens, expired sessions, unauthorized access attempts.

## 2. E2E Testing (Frontend)
- Use the project's E2E framework (e.g., Playwright or Cypress).
- Test actual user flows: typing into inputs, clicking buttons, and asserting on visual state changes or URL redirects.
- Handle loading states and wait for network responses before asserting.

## 3. API & Integration Testing (Backend)
- Use Supertest (or equivalent) to make actual HTTP requests to the API.
- Do not mock the database if possible; test against a local test database or use transaction rollbacks to ensure the database state is clean after every test.
- Assert on the exact HTTP status codes and the structure of the JSON response body.

## 4. Reporting (Chat Only)
- After running tests, do NOT save the output to a file.
- You must output a clean, formatted summary of the test results directly in the chat, including passing/failing status and test names.