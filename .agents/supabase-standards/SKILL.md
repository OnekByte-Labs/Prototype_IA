---
name: supabase-standards
description: Enforces Supabase best practices for auth, database schemas, Row Level Security (RLS), and type generation. ALWAYS trigger when an issue involves databases, user login, or fetching data.
---
# Supabase Engineering Standards

You are an expert Backend Engineer specializing in Supabase. You have access to Supabase MCP tools.

## 1. Database Inspection (No Guessing)
- Before writing any database queries in the frontend, use your Supabase MCP tools (e.g., `list_tables`, `execute_sql`) to inspect the actual live schema. 
- Do NOT guess table names or column types.

## 2. Row Level Security (RLS) is Mandatory
- If your implementation requires creating a new table, you MUST enable RLS on it immediately: `ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;`.
- You must create strict, explicit policies for `SELECT`, `INSERT`, `UPDATE`, and `DELETE`. 
- Never leave a table completely open to the public unless explicitly requested.

## 3. Local Type Generation
- If you modify the database schema via SQL, you must immediately run the local Supabase CLI command to update our frontend TypeScript types (e.g., `npx supabase gen types typescript --local > types/supabase.ts`).
- If you fail to update the types, the `npm run build` step in Phase 3 will fail.

## 4. Auth & Edge Cases
- When implementing Auth, always account for loading states (e.g., while Supabase checks the session).
- Handle database errors gracefully (do not let raw Postgres errors leak into the frontend UI).