---
name: ui-replication
description: Use this skill when asked to create a 1:1 UI replica of a live Next.js or React website by extracting its compiled HTML and CSS.
---

# UI Replication Skill

When the user requests to create a 1:1 replica of a live website (or specifically says "how you created this dashboard"), follow this precise extraction and adaptation methodology. This approach guarantees an exact visual match without needing to manually rewrite complex styling from scratch.

## 1. Extract Global Assets
- **CSS**: Fetch the compiled CSS from the live site (e.g., `_next/static/...css`).
- **Implementation**: Save the entire CSS payload directly to the local `src/app/globals.css`.
- **Media Paths**: If the CSS references external media (like fonts or images via `../media/...`), run a script to replace those relative paths with absolute URLs pointing to the live CDN so the local build can resolve them without downloading all asset files.

## 2. Replicate the Global Layout
- **HTML Structure**: Inspect the live site's DOM to identify the root wrapper elements (e.g., `<div class="site-frame">`, `<header class="site-header">`, `<footer class="site-footer">`).
- **Implementation**: Recreate this exact structure in `src/app/layout.tsx`. Ensure all `class=` attributes are converted to `className=`.

## 3. Extract and Parse Page Payloads
- **Fetch HTML**: Use `curl` to fetch the raw HTML for the target routes.
- **Isolate Content**: Extract the core page content (usually inside a `<main>` tag or specific wrapper).
- **JSX Conversion Pipeline**:
  Since live HTML is not valid JSX, you must run a transformation pipeline. Use a Node.js script to automate this:
  1. Convert `class=` to `className=`.
  2. Convert `for=` to `htmlFor=`.
  3. Convert `charset=` to `charSet=`.
  4. Fix unclosed HTML tags (`<img>`, `<input>`, `<hr>`, `<br>`) to be self-closing (e.g., `<img />`).
  5. Strip out HTML comments (`<!-- ... -->`) as they break JSX compilation.
  6. Fix `tabindex=` to `tabIndex={0}` or `tabIndex={-1}`.
  7. Convert boolean attributes with empty strings (e.g., `disabled=""`) to standard JSX boolean props (e.g., `disabled`).
  8. Fix SVG specific attributes (e.g., `stroke-width` to `strokeWidth`, `viewBox`, `aria-hidden="true"` to `aria-hidden={true}`).
  9. Strip inline styles if they are too complex or rely entirely on the global CSS.

## 4. Scaffold the Routes
- Map the extracted JSX payloads into their respective Next.js App Router endpoints (e.g., `src/app/page.tsx`, `src/app/dashboard/page.tsx`).

## 5. Verification
- Run `npm run build` to catch any lingering JSX compilation errors (like invalid SVG attributes or unclosed tags).
- Fix errors iteratively until the build passes.
- Run a visual snapshot test (e.g., using Playwright) to confirm the local build is a 1:1 match of the live site.
