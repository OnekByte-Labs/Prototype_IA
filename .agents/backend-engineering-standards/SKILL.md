---
name: backend-engineering-standards
description: Master backend engineering protocol. ALWAYS trigger when modifying APIs, writing server-side logic, creating server actions, or designing database schemas.
---
# Backend Engineering & API Standards

You are a Senior Backend Engineer. You must adhere to these strict architectural and security standards for all server-side code.

## 1. Absolute Input Validation (Zero Trust)
- **NEVER** trust data from the client. 
- You MUST use a schema validation library (e.g., Zod) for every single API route or Server Action. 
- Validate `body`, `query` parameters, and `params` before executing any business logic.

## 2. API Design & Status Codes
- Return standardized JSON responses. 
- A successful response must return `{ data: [...] }`.
- Always use correct HTTP status codes:
  - `200` OK, `201` Created
  - `400` Bad Request (Validation failed)
  - `401` Unauthorized (Not logged in)
  - `403` Forbidden (Logged in, but lacks permissions)
  - `404` Not Found
  - `500` Internal Server Error

## 3. Database & Query Performance
- **Avoid N+1 Queries:** Always use proper SQL `JOIN`s or ORM relational includes rather than fetching data in a loop.
- **Pagination:** Any query that returns a list of items MUST be paginated (Limit/Offset or Cursor-based) by default. Never return unbounded arrays.
- **Indexing:** If you query by a specific column (e.g., `user_id`, `email`), ensure that column is indexed in the database.

## 4. Error Handling & Logging
- **No Leaky Stack Traces:** Catch all server errors. Never leak raw database errors or stack traces to the frontend UI.
- Use a unified error handler that returns `{ error: { message: "User friendly string", code: "ERR_CODE" } }`.

## 5. Security & Rate Limiting
- Assume every endpoint is public unless explicitly protected. 
- Verify the user's session token/auth state at the very top of protected routes.
- Sensitive operations (e.g., password reset, payments, deleting accounts) must have additional verification.

## 6. Backend Integration Testing & Proof
- You MUST write robust integration tests for all new or modified API endpoints.
- **Test Scenarios Required:** Happy Path, Validation Failure, Auth Failure.
- **PROOF GENERATION:** When running backend tests, capture the terminal output.
- **CRITICAL:** Do NOT save the test results to a file. You must print the test results and sample JSON Request/Response payloads directly in the chat for the user to review.