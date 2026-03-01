# Pokemon TCG Tracker — Project Guide

## What This Plugin Does

An Obsidian community plugin that tracks Pokémon TCG card collections. Users add sets from the TCGdex API, and the plugin generates markdown files with card tables, progress bars, and an inline card entry widget. There is also a Dashboard page that aggregates stats across all sets.

## Build & Run

```bash
npm install        # install dependencies
npm run build      # production build (tsc + esbuild → main.js)
npm run dev        # watch mode for development
```

Build output: `main.js` at project root. Obsidian loads this + `manifest.json` + `styles.css`.

## Project Structure

```
src/
  main.ts              # Plugin class (~845 lines) — lifecycle, file generation,
                       #   tracking updates, import/export, dashboard
  settings.ts          # PluginSettings interface, defaults, settings tab UI
  api/
    tcgService.ts      # TCGdex SDK wrapper (getSets, getSetDetails)
  ui/
    CardEntryWidget.ts # Inline card entry widget (normal + fast mode)
    FolderSuggest.ts   # Folder autocomplete using AbstractInputSuggest
styles.css             # All plugin CSS (.ptt-progress-*, .ptt-widget-*)
```

## Key Architecture Decisions

### Generated Markdown Files
- Each tracked set gets a `.md` file in the user's configured vault folder
- Files contain: logo/symbol images, progress bars (HTML), a `ptt-widget` code block, and a markdown table
- The **Dashboard** (`Dashboard.md`) aggregates stats from all set files

### HTML Markers Pattern
- Set files use `<!-- ptt-tracking-start -->` / `<!-- ptt-tracking-end -->` to mark the dynamic progress bar section
- Dashboard uses `<!-- ptt-dashboard-start -->` / `<!-- ptt-dashboard-end -->`
- Only content between markers is regenerated; everything outside is preserved

### Table Parsing — CRITICAL GOTCHAS
- **Never use `.filter(Boolean)` on split table rows** — empty cells get removed, shifting column indices
- Use `splitRow()` helper: splits by `|`, trims, removes only first/last empty strings from leading/trailing pipes
- `parseInt("", 10)` returns `NaN` — always guard with `isNaN()`
- Card numbers may be zero-padded (`001`, `002`) — normalize with `String(parseInt(n, 10))` when comparing

### Self-Modification Guard
- `isUpdatingTracking` flag prevents infinite loops when the plugin modifies a file (which triggers the `modify` event)
- Always set this flag before `vault.modify()` and clear it in a `finally` block

### File Operations
- Use `vault.create()` / `vault.modify()` for `.md` files (standard Obsidian vault API)
- Use `vault.cachedRead()` for reading in-memory content (what the editor has)
- Backups are stored as `.md` files with JSON inside a ` ```json ``` ` code block — this works with Obsidian's vault API

### TCGdex SDK
- Package: `@tcgdex/sdk` — constructor requires typed language literal: `"en"`, not `string`
- `sdk.set.get(id)` returns `CardResume[]` (only id/name/image)
- Full card details (category, rarity, variants, dexId) require `resume.getCard()` per card — N API calls per set
- Card `variants` object may exist with all `false` values — check the result string, not object existence

### Obsidian-Specific Patterns
- `AbstractInputSuggest`: has a reserved `onSelect` property — don't shadow it
- Markdown inside HTML block elements doesn't render — use `<img>` tags, not `![]()`
- `<center>` tags work for centering; `text-align: center` on divs doesn't always work
- Code block processors (`registerMarkdownCodeBlockProcessor`) render portable widgets

## Feature Map (main.ts methods)

| Method | Purpose |
|--------|---------|
| `createSetFile()` | Generate a set's markdown file from TCGdex API data |
| `updateTracking()` | Parse table, auto-sum Owned column, update progress bars |
| `addCardsToSet()` | Increment variant columns for specified cards |
| `parseSetFile()` | Extract card variant data from a set file (for export) |
| `applyDataToSetFile()` | Write variant values into a set file (for import) |
| `exportCollectionData()` | Export all sets to per-set backup files |
| `exportSetData()` | Export a single set's backup |
| `importCollectionData()` | Import all sets from backup files |
| `importSetData()` | Import a single set from its backup |
| `createDashboardFile()` | Generate the dashboard markdown |
| `updateDashboard()` | Rebuild dashboard stats from all set files |
| `ensureDashboard()` | Create dashboard if missing, else update it |
| `parseSetTracking()` | Extract progress data from a set file's tracking HTML |

## Settings (data.json)

```typescript
interface PluginSettings {
  vaultFolder: string;        // Where set files are created
  trackedSetIds: string[];    // TCGdex set IDs the user is tracking
  cachedSets: SetSummary[];   // Cached set list from TCGdex API
}
```

## Vault File Layout (user's vault)

```
<vaultFolder>/
  Dashboard.md                    # Aggregate stats + widget
  <Set Name>.md                   # Per-set card table + tracking + widget
  backups/
    <Set Name>.md                 # Per-set backup (JSON in code block, version: 1)
```

## CSS Classes

- `.ptt-tracking` — container for progress bars (centered flex column)
- `.ptt-progress-row` / `.ptt-progress-label` / `.ptt-progress-count` / `.ptt-progress-bar` — progress bar layout
- `.ptt-widget` — card entry widget container
- `.ptt-widget-toggle-btn` / `.ptt-widget-toggle-active` — variant toggle buttons
- `.ptt-widget-fast-*` — fast mode input elements

## Debounce Timers

- Set tracking updates: **1 second** debounce
- Dashboard updates: **2 second** debounce (reads multiple files)
