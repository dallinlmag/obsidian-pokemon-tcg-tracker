# Pokémon TCG Tracker

An [Obsidian](https://obsidian.md) plugin that helps you track your Pokémon Trading Card Game collection using simple markdown files inside your vault.

> **Network use:** This plugin connects to the [TCGdex API](https://tcgdex.dev/) to fetch Pokémon TCG set and card data (names, images, rarities, variants). No personal or vault data is sent. Requests are made when you add a new set or refresh the set list from settings.

<p align="center">
  <img src="media/example.png" alt="Pokémon TCG Tracker example" />
</p>

## Features

### Set tracking
- Browse and add any Pokémon TCG set from the complete card database.
- Each tracked set generates a markdown file with a full card table including card number, name, Pokédex ID, rarity, category, and variants.
- Set pages display the official set logo and symbol, release date, and live-updating progress bars showing your collection completion.

### Collection management
- **Card entry widget** — An inline widget on each set page for quickly logging new cards. Supports:
  - Individual card entry with variant toggle buttons (normal, holo, reverse, etc.)
  - Bulk entry with a `+10` button for opening booster packs.
  - **Fast mode** — Type cards in shorthand like `12n,14h,78r,5` for rapid data entry. Numbers without a letter will be the normal variant.
  
<p align="center">
  <img src="media/fast.png" alt="Fast mode example" />
</p>

### Progress tracking
- Per-set progress bars for official cards, total cards, and each variant type.
- Running totals for owned cards and variants.

### Portable widgets
The plugin provides code block widgets you can embed in **any** note in your vault.

#### Card entry widget
Add a card entry form anywhere:

````markdown
```ptt-widget
```
````

#### Set stats widget
Display progress bars for a single tracked set. Specify the set by its TCGdex ID or by name. Set IDs can be found in the plugin settings under each tracked set.

````markdown
```ptt-set-stats
# Set ID can be found in plugin settings
sv3pt5
```
````

````markdown
```ptt-set-stats
Scarlet & Violet 151
```
````

#### Collection stats widget
Display aggregate progress bars across all tracked sets:

````markdown
```ptt-collection-stats
```
````

These widgets render live when the note is opened, so they always reflect your latest collection data. Use them to build custom dashboards or embed stats in your daily notes.

### Backup & restore
- **Export / import** — Back up your entire collection or individual sets to markdown files in a `backups/` folder within your vault.
- **Auto-backup on reset** — Resetting a set file automatically exports a backup first, so you never lose data.
- Backup files are portable markdown with embedded JSON, so they sync with your vault and can be transferred between vaults.

## Settings
- **Vault folder** — Choose where set files are created in your vault (with folder autocomplete).
- **Set management** — Add, remove, reset, export, or import tracked sets.
- **Cached set list** — Sets are fetched once from the API and cached locally to minimize network calls. Refresh manually when needed.

## Future plans
- **Pricing info** — Pricing info so you can view the total worth of your sets, most valuable card, etc.
- **Pokédex page** — A page specifically set to track your progress if you are doing a full Pokédex challenge.
- **Import/export to other apps** — The ability to import and export to other apps.

## Ideas? Issues?
- Open a feature request or bug report on the [GitHub repository](https://github.com/dallinlmag/obsidian-pokemon-tcg-tracker).

## Acknowledgements

Card data is provided by **[TCGdex](https://tcgdex.dev/)** — a free, open-source Pokémon TCG API. Huge thanks to the TCGdex team for maintaining such a comprehensive and accessible database of Pokémon card data. This plugin would not be possible without their work.

- TCGdex Website: [https://tcgdex.dev](https://tcgdex.dev)
- TCGdex GitHub: [https://github.com/tcgdex](https://github.com/tcgdex)
- TCGdex TypeScript SDK: [@tcgdex/sdk](https://www.npmjs.com/package/@tcgdex/sdk)

Pokémon and Pokémon TCG are trademarks of Nintendo, Creatures Inc., and GAME FREAK Inc. This plugin is not affiliated with or endorsed by any of these companies.
