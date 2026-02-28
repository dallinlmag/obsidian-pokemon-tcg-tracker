import {Notice, Plugin, TFile} from 'obsidian';
import {DEFAULT_SETTINGS, PluginSettings, PTTSettings} from "./settings";
import {TCGService} from "./api/tcgService";
import {CardEntryWidget} from "./ui/CardEntryWidget";

export default class PokemonTCGTracker extends Plugin {
	settings: PluginSettings;
	tcgService: TCGService;
	private updateDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	private isUpdatingTracking = false;

	async onload() {
		await this.loadSettings();
		this.tcgService = new TCGService("en");

		this.addSettingTab(new PTTSettings(this.app, this));

		// Register the portable card entry widget
		const widget = new CardEntryWidget(this);
		this.registerMarkdownCodeBlockProcessor("ptt-widget", (source, el, ctx) => {
			widget.render(el, ctx);
		});

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
				details.logo ? `<center><img src="${details.logo}.webp" alt="Set Logo" style="max-width:300px; max-height:300px;"></center>` : "",
				details.symbol ? `<center><img src="${details.symbol}.webp" alt="Set Symbol" style="max-width:100px; max-height:100px;"></center>` : "",
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

			const widgetBlock = [
				"",
				"```ptt-widget",
				"```",
				"",
			];

			content = [...header, ...widgetBlock, ...tableLines].join("\n") + "\n";
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

	/** Add cards to a set file by incrementing the appropriate variant columns. */
	async addCardsToSet(setId: string, cards: {cardNumber: string; variant: string}[]): Promise<void> {
		const setName = this.settings.cachedSets.find(s => s.id === setId)?.name;
		if (!setName) {
			new Notice("Set not found.");
			return;
		}

		const folder = this.settings.vaultFolder;
		const filePath = folder ? `${folder}/${setName}.md` : `${setName}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${filePath}`);
			return;
		}

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");

		const headerLineIdx = lines.findIndex(l => l.startsWith("| Number"));
		if (headerLineIdx === -1) {
			new Notice("Could not find card table in file.");
			return;
		}

		const splitRow = (row: string): string[] => {
			const parts = row.split("|").map(h => h.trim());
			if (parts.length > 0 && parts[0] === "") parts.shift();
			if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
			return parts;
		};

		const headers = splitRow(lines[headerLineIdx] ?? "");
		const numIdx = headers.indexOf("Number");
		const variantColNames = ["normal", "holo", "reverse", "firstEdition"];
		const variantIndices: Record<string, number> = {};
		for (const v of variantColNames) {
			const idx = headers.indexOf(v);
			if (idx !== -1) variantIndices[v] = idx;
		}

		// Group card additions: {cardNumber -> {variant -> count}}
		const additions: Record<string, Record<string, number>> = {};
		for (const card of cards) {
			if (!additions[card.cardNumber]) additions[card.cardNumber] = {};
			const entry = additions[card.cardNumber]!;
			entry[card.variant] = (entry[card.variant] ?? 0) + 1;
		}

		// Normalize card number for comparison (strip leading zeros)
		const normalize = (n: string) => String(parseInt(n, 10));

		let updatedCount = 0;
		const errors: string[] = [];
		for (let i = headerLineIdx + 2; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (!line.startsWith("|")) break;

			const cols = splitRow(line);
			if (cols.length < headers.length) continue;

			const cardNum = cols[numIdx] ?? "";
			const normalizedNum = normalize(cardNum);
			// Check all additions using normalized comparison
			const matchKey = Object.keys(additions).find(k => normalize(k) === normalizedNum);
			if (!matchKey) continue;

			for (const [variant, count] of Object.entries(additions[matchKey]!)) {
				const colIdx = variantIndices[variant];
				if (colIdx === undefined) continue;
				const cellValue = cols[colIdx] ?? "";
				// Empty cell means this card doesn't have that variant
				if (cellValue.trim() === "") {
					errors.push(`Card #${cardNum} does not have variant "${variant}"`);
					continue;
				}
				const current = parseInt(cellValue, 10);
				cols[colIdx] = String((isNaN(current) ? 0 : current) + count);
				updatedCount++;
			}

			lines[i] = "| " + cols.join(" | ") + " |";
		}

		if (errors.length > 0) {
			new Notice("⚠️ Skipped:\n" + errors.join("\n"), 8000);
		}

		if (updatedCount === 0) {
			new Notice("No matching cards found in the set.");
			return;
		}

		this.isUpdatingTracking = true;
		try {
			await this.app.vault.modify(file, lines.join("\n"));
		} finally {
			this.isUpdatingTracking = false;
		}

		new Notice(`Added ${cards.length} card(s) to ${setName}.`);

		// Trigger tracking update
		this.debouncedUpdateTracking(file);
	}

	/** Split a markdown table row into cells, preserving empty cells. */
	private splitRow(row: string): string[] {
		const parts = row.split("|").map(h => h.trim());
		if (parts.length > 0 && parts[0] === "") parts.shift();
		if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
		return parts;
	}

	/** Parse a set file and extract variant column data for each card. */
	private async parseSetFile(file: TFile): Promise<Record<string, Record<string, number>> | null> {
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");
		const headerLineIdx = lines.findIndex(l => l.startsWith("| Number"));
		if (headerLineIdx === -1) return null;

		const headers = this.splitRow(lines[headerLineIdx] ?? "");
		const numIdx = headers.indexOf("Number");
		const variantColNames = ["normal", "holo", "reverse", "firstEdition"];
		const variantIndices: Record<string, number> = {};
		for (const v of variantColNames) {
			const idx = headers.indexOf(v);
			if (idx !== -1) variantIndices[v] = idx;
		}

		const cards: Record<string, Record<string, number>> = {};
		for (let i = headerLineIdx + 2; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (!line.startsWith("|")) break;
			const cols = this.splitRow(line);
			if (cols.length < headers.length) continue;

			const cardNum = cols[numIdx] ?? "";
			if (!cardNum) continue;

			const variants: Record<string, number> = {};
			for (const [v, idx] of Object.entries(variantIndices)) {
				const cellValue = cols[idx] ?? "";
				if (cellValue.trim() === "") continue; // card doesn't have this variant
				const val = parseInt(cellValue, 10);
				variants[v] = isNaN(val) ? 0 : val;
			}
			cards[cardNum] = variants;
		}
		return cards;
	}

	/** Apply variant data to a set file, overwriting variant column values. */
	private async applyDataToSetFile(file: TFile, cardData: Record<string, Record<string, number>>): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		const lines = content.split("\n");
		const headerLineIdx = lines.findIndex(l => l.startsWith("| Number"));
		if (headerLineIdx === -1) return;

		const headers = this.splitRow(lines[headerLineIdx] ?? "");
		const numIdx = headers.indexOf("Number");
		const variantColNames = ["normal", "holo", "reverse", "firstEdition"];
		const variantIndices: Record<string, number> = {};
		for (const v of variantColNames) {
			const idx = headers.indexOf(v);
			if (idx !== -1) variantIndices[v] = idx;
		}

		for (let i = headerLineIdx + 2; i < lines.length; i++) {
			const line = lines[i] ?? "";
			if (!line.startsWith("|")) break;
			const cols = this.splitRow(line);
			if (cols.length < headers.length) continue;

			const cardNum = cols[numIdx] ?? "";
			const data = cardData[cardNum];
			if (!data) continue;

			for (const [v, idx] of Object.entries(variantIndices)) {
				const cellValue = cols[idx] ?? "";
				if (cellValue.trim() === "" && !(v in data)) continue; // card doesn't have this variant
				if (v in data) {
					cols[idx] = String(data[v]);
				}
			}
			lines[i] = "| " + cols.join(" | ") + " |";
		}

		this.isUpdatingTracking = true;
		try {
			await this.app.vault.modify(file, lines.join("\n"));
		} finally {
			this.isUpdatingTracking = false;
		}
		// Trigger tracking update to recalculate Owned and progress bars
		this.debouncedUpdateTracking(file);
	}

	/** Get the path to the backups folder. */
	private getBackupsFolder(): string {
		const folder = this.settings.vaultFolder;
		return folder ? `${folder}/backups` : "backups";
	}

	/** Get the backup file path for a specific set. */
	private getSetBackupPath(setName: string): string {
		return `${this.getBackupsFolder()}/${setName}.md`;
	}

	/** Ensure a folder path exists, creating it if needed. */
	private async ensureFolder(folderPath: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(folderPath);
		if (!existing) {
			await this.app.vault.createFolder(folderPath);
		}
	}

	/** Wrap JSON in a markdown code block. */
	private jsonToMarkdown(setName: string, data: any): string {
		return `# ${setName} — Backup\n\n\`\`\`json\n` + JSON.stringify(data, null, 2) + "\n```\n";
	}

	/** Extract JSON from a markdown code block. */
	private markdownToJson(content: string): any | null {
		const match = content.match(/```json\s*\n([\s\S]*?)\n```/);
		if (!match) return null;
		return JSON.parse(match[1]!);
	}

	/** Write a single set's backup to its own markdown file. */
	private async writeSetBackup(setId: string, setName: string, cards: Record<string, Record<string, number>>): Promise<string> {
		await this.ensureFolder(this.getBackupsFolder());
		const backupPath = this.getSetBackupPath(setName);
		const data = {exportDate: new Date().toISOString(), setId, setName, cards};
		const md = this.jsonToMarkdown(setName, data);
		const existingFile = this.app.vault.getAbstractFileByPath(backupPath);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, md);
		} else {
			await this.app.vault.create(backupPath, md);
		}
		return backupPath;
	}

	/** Read a single set's backup file. */
	private async readSetBackup(setName: string): Promise<{setId: string; setName: string; cards: Record<string, Record<string, number>>} | null> {
		const backupPath = this.getSetBackupPath(setName);
		const file = this.app.vault.getAbstractFileByPath(backupPath);
		if (!(file instanceof TFile)) {
			new Notice(`Backup not found: ${backupPath}`);
			return null;
		}
		try {
			const content = await this.app.vault.cachedRead(file);
			return this.markdownToJson(content);
		} catch {
			new Notice("Failed to parse backup file.");
			return null;
		}
	}

	/** Export all tracked set collection data, one backup file per set. */
	async exportCollectionData(): Promise<void> {
		let exportedCount = 0;
		for (const setId of this.settings.trackedSetIds) {
			const setName = this.settings.cachedSets.find(s => s.id === setId)?.name;
			if (!setName) continue;

			const folder = this.settings.vaultFolder;
			const filePath = folder ? `${folder}/${setName}.md` : `${setName}.md`;
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) continue;

			const cards = await this.parseSetFile(file);
			if (!cards) continue;

			await this.writeSetBackup(setId, setName, cards);
			exportedCount++;
		}

		new Notice(`Exported ${exportedCount} set(s) to ${this.getBackupsFolder()}/`);
	}

	/** Export a single set's collection data to its own backup file. */
	async exportSetData(setId: string): Promise<void> {
		const setName = this.settings.cachedSets.find(s => s.id === setId)?.name;
		if (!setName) {
			new Notice("Set not found.");
			return;
		}

		const folder = this.settings.vaultFolder;
		const filePath = folder ? `${folder}/${setName}.md` : `${setName}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${filePath}`);
			return;
		}

		const cards = await this.parseSetFile(file);
		if (!cards) {
			new Notice("Could not parse set file.");
			return;
		}

		const backupPath = await this.writeSetBackup(setId, setName, cards);
		new Notice(`Exported ${setName} to ${backupPath}`);
	}

	/** Import collection data from all backup files in the backups folder. */
	async importCollectionData(): Promise<void> {
		let importedCount = 0;
		for (const setId of this.settings.trackedSetIds) {
			const setName = this.settings.cachedSets.find(s => s.id === setId)?.name;
			if (!setName) continue;

			const data = await this.readSetBackup(setName);
			if (!data?.cards) continue;

			const folder = this.settings.vaultFolder;
			const filePath = folder ? `${folder}/${setName}.md` : `${setName}.md`;
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) continue;

			await this.applyDataToSetFile(file, data.cards);
			importedCount++;
		}

		new Notice(`Imported data for ${importedCount} set(s).`);
	}

	/** Import collection data from a single set's backup file. */
	async importSetData(setId: string): Promise<void> {
		const setName = this.settings.cachedSets.find(s => s.id === setId)?.name;
		if (!setName) {
			new Notice("Set not found.");
			return;
		}

		const data = await this.readSetBackup(setName);
		if (!data?.cards) return;

		const folder = this.settings.vaultFolder;
		const filePath = folder ? `${folder}/${setName}.md` : `${setName}.md`;
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (!(file instanceof TFile)) {
			new Notice(`File not found: ${filePath}`);
			return;
		}

		await this.applyDataToSetFile(file, data.cards);
		new Notice(`Imported data for ${setName}.`);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
