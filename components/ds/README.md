# ARGUS design system

Light, warm, neumorphic. Screens never use hex values or stock Tailwind colours — they use the tokens below through
the components in this folder. Change the look in **one** place:

| File | Role |
| --- | --- |
| `app/tokens.css` | Raw design tokens (palette, depth/shadows, radii, type, layout sizes) |
| `app/globals.css` | Maps tokens to Tailwind utilities (`bg-surface`, `text-ink-2`, `shadow-key`, `text-ui`, …), base styles, form-control CSS |
| `lib/design/tokens.ts` | JS mirror for `<canvas>`, SVG and Leaflet, which cannot use CSS classes |
| `components/ds/*` | Shared components (below) |

## Depth model
- `canvas` page → `surface` panels (`shadow-card`) → `raised` pressable things (`shadow-key`).
- `sunken` / inset (`shadow-inset`) = typed into, pressed, or selected. Selection is *pressed in*, with an accent label.
- Tables, maps and video stay flat. Video frames stay dark (`bg-video`) so footage is never washed out.

## Colour rules
- Orange (`accent`) = interaction: selection, focus, primary action. Never status.
- Green / amber / red (`ok` / `warn` / `crit`) = status only. Fills use `bg-ok`; text uses `text-ok-ink` (contrast ≥ 4.5:1).
- Text: `ink` → `ink-2` → `ink-3`. Nothing is pure black.

## Type scale (nothing below 12 px, sentence case)
`text-title` 24 · `text-headline` 17 · `text-section` 14/600 · `text-body` 14 · `text-ui` 13 · `text-caption` 12 · `text-stat` 22 ·
`font-data` (mono) only for IDs, IPs, timestamps and system values.

## Components
Layout: `AppShell`, `Sidebar`, `NavigationItem`, `Header`, `PageHeader`, `PageBody`, `SubNav*`
Surfaces: `Card`, `SectionHeader`, `Stat` / `StatStrip`, `KeyValue`, `EmptyState`, `SkeletonRows`
Controls: `Button`, `IconButton`, `Input`, `Select`, `Textarea`, `Checkbox`, `Switch`, `Field`, `Tabs`, `SegmentedControl`
Data: `Table` / `Th` / `Tr` / `Td`, `DataTable`, `Badge`, `StatusDot`, `StatusIndicator`, `HealthIndicator`
Overlays: `Modal`, `Drawer`, `Dropdown` / `MenuItem`, `Tooltip` (toasts: `components/gotham/Toast.tsx`)
Domain: `CameraTile`, `VideoChip`, `AlertRow`, `ClassTag`, `SeverityChip`, `StatusCell`
