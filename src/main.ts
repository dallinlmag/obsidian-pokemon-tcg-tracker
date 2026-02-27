import {Notice, Plugin, TFile} from 'obsidian';
import {DEFAULT_SETTINGS, PluginSettings, PTTSettings} from "./settings";
import {TCGService} from "./api/tcgService";

export default class PokemonTCGTracker extends Plugin {
	settings: PluginSettings;
	tcgService: TCGService;
	private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private isUpdatingTracking = false;

	async onload() {
		await this.loadSettings();
		this.tcgService = new TCGService("en");

		this.addSettingTab(new PTTSettings(this.app, this));

		// Listen for file modifications to update progress bars
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (this.isUpdatingTracking) return;
				if (file instanceof TFile && file.extension === "md") {
					this.debouncedUpdateTracking(file);
				}
			})
		);
	}

	onunload() {
	}

	/** Create a markdown file for a tracked set, listing every card name. */
	async createSetFile(setId: string, setName: string): Promise<void> {
		const folder = this.settings.vaultFolder;
		const filePath = folder ? `${folder}/${setName}.md` : `${setName}.md`;

		// Ensure the folder exists
		if (folder) {
			const existing = this.app.vault.getAbstractFileByPath(folder);
			if (!existing) {
				await this.app.vault.createFolder(folder);
			}
		}

		// Fetch set details
		let content: string;
		try {
			const details = await this.tcgService.getSetDetails(setId);
			if (!details) {
				new Notice(`Set not found: ${setName}`);
				return;
			}

			const variantList = Object.entries(details.variants)
				.filter(([, v]) => v)
				.map(([k]) => k)
				.join(", ") || "None";

			const variantCountList = [
				details.cardCount.normal > 0 ? `Normal: ${details.cardCount.normal}` : null,
				details.cardCount.reverse > 0 ? `Reverse: ${details.cardCount.reverse}` : null,
				details.cardCount.holo > 0 ? `Holo: ${details.cardCount.holo}` : null,
				details.cardCount.firstEd != null && details.cardCount.firstEd > 0 ? `First Ed: ${details.cardCount.firstEd}` : null,
			].filter((value): value is string => value !== null).join(", ") || "None";

			// Determine which variant columns this set has
			// Use set-level variants if available, otherwise derive from card data
			const variantKeys: string[] = [];
			const allVariantNames = ["normal", "holo", "reverse", "firstEdition"];
			if (details.variants && Object.values(details.variants).some(v => v)) {
				for (const k of allVariantNames) {
					if ((details.variants as Record<string, boolean | undefined>)[k]) {
						variantKeys.push(k);
					}
				}
			} else {
				// Derive from cards
				const found = new Set<string>();
				for (const c of details.cards) {
					for (const v of c.variants.split(", ").filter(Boolean)) {
						found.add(v);
					}
				}
				for (const k of allVariantNames) {
					if (found.has(k)) variantKeys.push(k);
				}
			}

			// --- Build progress tracking section ---
			const officialCount = details.cardCount.official;
			const totalCount = details.cardCount.total;

			const progressLine = (label: string, owned: number, total: number) =>
				`<div class="ptt-progress-row">` +
				`<span class="ptt-progress-label">${label}:</span>` +
				`<span class="ptt-progress-count">${owned}/${total}</span>` +
				`<progress class="ptt-progress-bar" value="${owned}" max="${total}"></progress>` +
				`</div>`;

			// Variant totals: count how many cards have each variant
			const variantTotals: Record<string, number> = {};
			for (const k of variantKeys) {
				variantTotals[k] = details.cards.filter(c => c.variants.includes(k)).length;
			}

			const totalLine = (label: string, count: number) =>
				`<div class="ptt-progress-row">` +
				`<span class="ptt-progress-label">${label}:</span>` +
				`<span class="ptt-progress-count">${count}</span>` +
				`</div>`;

			const trackingLines = [
				"<!-- ptt-tracking-start -->",
				`<div class="ptt-tracking">`,
				"",
				progressLine("Official", 0, officialCount),
				progressLine("Total", 0, totalCount),
				...variantKeys.map(k => progressLine(k.charAt(0).toUpperCase() + k.slice(1), 0, variantTotals[k] ?? 0)),
				"",
				`<hr>`,
				"",
				totalLine("Total Owned", 0),
				...variantKeys.map(k => totalLine(k.charAt(0).toUpperCase() + k.slice(1) + " Total", 0)),
				"",
				`</div>`,
				"<!-- ptt-tracking-end -->",
				"",
			];

			const header = [
				"",
				`<center>`,
				"",
				details.logo ? `![Set Logo|300](${details.logo}.webp)` : "",
				"",
				details.symbol ? `![Set Symbol|100](${details.symbol}.webp)` : "",
				"",
				`</center>`,
				"",
				`**Release Date:**\t${details.releaseDate}`,
				// `**Official Cards:**\t${details.cardCount.official}`,
				// `**Total Cards:**\t${details.cardCount.total}`,
				// `**Variants:**\t${variantList}`,
				// `**Variant count:**\t${variantCountList}`,
				// "",
				...trackingLines,
			];

			const variantHeaders = variantKeys.map(k => ` ${k} |`).join("");
			const variantSeparators = variantKeys.map(() => " --- |").join("");

			const tableLines = [
				`| Number | Owned | Name | DexId | Rarity | Category | Variant |${variantHeaders}`,
				`| ------ | ----- | ---- | ----- | ------ | -------- | ------- |${variantSeparators}`,
				...details.cards.map((c) => {
					const variantCells = variantKeys.map(k =>
						` ${c.variants.includes(k) ? "0" : ""} |`
					).join("");
					return `| ${c.localId} | 0 | **${c.name}** | ${c.dexId} | ${c.rarity} | ${c.category} | ${c.variants} |${variantCells}`;
				}),
			];

			content = [...header, ...tableLines].join("\n") + "\n";
		} catch (e) {
			new Notice(`Failed to fetch cards for ${setName}.`);
			return;
		}

		// Create or overwrite the file
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile) {
			await this.app.vault.modify(existingFile as any, content);
		} else {
			await this.app.vault.create(filePath, content);
		}

		new Notice(`Created file: ${filePath}`);
	}

	/** Debounce tracking updates to avoid excessive writes while editing. */
	private debouncedUpdateTracking(file: TFile) {
		if (this.updateDebounceTimer) clearTimeout(this.updateDebounceTimer);
		this.updateDebounceTimer = setTimeout(() => this.updateTracking(file), 1000);
	}

	/** Parse the table in a set file and update the progress bar HTML. */
	private async updateTracking(file: TFile) {
		// Only process files in the configured vault folder
		const folder = this.settings.vaultFolder;
		if (folder && !file.path.startsWith(folder + "/")) return;
		if (!folder && file.path.includes("/")) return;

		const content = await this.app.vault.cachedRead(file);

		// Only process files with our tracking markers and a card table
		if (!content.includes("<!-- ptt-tracking-start -->") || !content.includes("<!-- ptt-tracking-end -->")) return;

		// Parse the table header to find column indices
		const lines = content.split("\n");
		const headerLineIdx = lines.findIndex(l => l.startsWith("| Number"));
		if (headerLineIdx === -1) return;

		const headerLine = lines[headerLineIdx] ?? "";
		// Split preserving empty cells: remove first/last empty entries from leading/trailing |
		const splitRow = (row: string): string[] => {
			const parts = row.split("|").map(h => h.trim());
			// Remove first empty (before leading |) and last empty (after trailing |)
			if (parts.length > 0 && parts[0] === "") parts.shift();
			if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
			return parts;
		};
		const headers = splitRow(headerLine);
		const numIdx = headers.indexOf("Number");
		const ownedIdx = headers.indexOf("Owned");

		// Find variant column indices
		const variantColNames = ["normal", "holo", "reverse", "firstEdition"];
		const variantIndices: Record<string, number> = {};
		for (const v of variantColNames) {
			const idx = headers.indexOf(v);
			if (idx !== -1) variantIndices[v] = idx;
		}

		// Parse the official card count from the progress bar HTML
		const officialMatch = content.match(/ptt-progress-label">Official:<\/span><span class="ptt-progress-count">\d+\/(\d+)<\/span>/);
		const officialMax = officialMatch ? parseInt(officialMatch[1] ?? "0", 10) : 0;

		// First pass: compute Owned from variant columns and rebuild table rows
		const updatedLines = [...lines];
		for (let i = headerLineIdx + 2; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (!line.startsWith("|")) break;

			const cols = splitRow(line);
			if (cols.length < headers.length) continue;

			// Sum all variant columns to get the Owned value
			let variantSum = 0;
			for (const [, idx] of Object.entries(variantIndices)) {
				const val = parseInt(cols[idx] ?? "0", 10);
				if (!isNaN(val)) variantSum += val;
			}

			// Update the Owned column if it changed
			if (cols[ownedIdx] !== String(variantSum)) {
				cols[ownedIdx] = String(variantSum);
				updatedLines[i] = "| " + cols.join(" | ") + " |";
			}
		}

		// Rejoin content with updated Owned values
		let updatedContent = updatedLines.join("\n");

		// Second pass: parse updated table to compute progress
		const updatedTableLines = updatedContent.split("\n");
		let officialOwned = 0;
		let totalOwned = 0;
		let totalOwnedSum = 0;
		const variantOwned: Record<string, number> = {};
		const variantSums: Record<string, number> = {};
		for (const v of Object.keys(variantIndices)) {
			variantOwned[v] = 0;
			variantSums[v] = 0;
		}

		for (let i = headerLineIdx + 2; i < updatedTableLines.length; i++) {
			const line = updatedTableLines[i] ?? "";
			if (!line.startsWith("|")) break;

			const cols = splitRow(line);
			if (cols.length < headers.length) continue;

			const cardNum = parseInt(cols[numIdx] ?? "0", 10);
			const owned = parseInt(cols[ownedIdx] ?? "0", 10);

			if (!isNaN(owned)) totalOwnedSum += owned;

			if (!isNaN(owned) && owned > 0) {
				if (!isNaN(cardNum) && cardNum <= officialMax) {
					officialOwned++;
				}
				totalOwned++;
			}

			for (const [v, idx] of Object.entries(variantIndices)) {
				const val = parseInt(cols[idx] ?? "", 10);
				if (!isNaN(val)) {
					variantSums[v] = (variantSums[v] ?? 0) + val;
					if (val > 0) {
						variantOwned[v] = (variantOwned[v] ?? 0) + 1;
					}
				}
			}
		}

		// Rebuild the tracking section
		const trackingStart = updatedContent.indexOf("<!-- ptt-tracking-start -->");
		const trackingEnd = updatedContent.indexOf("<!-- ptt-tracking-end -->") + "<!-- ptt-tracking-end -->".length;
		if (trackingStart === -1 || trackingEnd === -1) return;

		const progressLine = (label: string, owned: number, total: number) =>
			`<div class="ptt-progress-row">` +
			`<span class="ptt-progress-label">${label}:</span>` +
			`<span class="ptt-progress-count">${owned}/${total}</span>` +
			`<progress class="ptt-progress-bar" value="${owned}" max="${total}"></progress>` +
			`</div>`;

		// Extract max values from existing progress bars
		const extractMax = (label: string): number => {
			const re = new RegExp(`ptt-progress-label">${label}:<\\/span><span class="ptt-progress-count">\\d+\\/(\\d+)<\\/span>`);
			const m = updatedContent.match(re);
			return m ? parseInt(m[1] ?? "0", 10) : 0;
		};

		const totalMax = extractMax("Total");
		const variantKeys = Object.keys(variantIndices);

		const totalLine = (label: string, count: number) =>
			`<div class="ptt-progress-row">` +
			`<span class="ptt-progress-label">${label}:</span>` +
			`<span class="ptt-progress-count">${count}</span>` +
			`</div>`;

		const newTracking = [
			"<!-- ptt-tracking-start -->",
			`<div class="ptt-tracking">`,
			"",
			progressLine("Official", officialOwned, officialMax),
			progressLine("Total", totalOwned, totalMax),
			...variantKeys.map(k => progressLine(
				k.charAt(0).toUpperCase() + k.slice(1),
				variantOwned[k] ?? 0,
				extractMax(k.charAt(0).toUpperCase() + k.slice(1))
			)),
			"",
			`<hr>`,
			"",
			totalLine("Total Owned", totalOwnedSum),
			...variantKeys.map(k => totalLine(
				k.charAt(0).toUpperCase() + k.slice(1) + " Total",
				variantSums[k] ?? 0
			)),
			"",
			`</div>`,
			"<!-- ptt-tracking-end -->",
		].join("\n");

		const oldTracking = updatedContent.substring(trackingStart, trackingEnd);
		if (oldTracking === newTracking && updatedContent === content) return; // No change needed

		const newContent = updatedContent.substring(0, trackingStart) + newTracking + updatedContent.substring(trackingEnd);
		this.isUpdatingTracking = true;
		try {
			await this.app.vault.modify(file, newContent);
		} finally {
			this.isUpdatingTracking = false;
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
