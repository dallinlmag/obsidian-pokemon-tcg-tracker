import {Notice, Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, PluginSettings, PTTSettings} from "./settings";
import {TCGService} from "./api/tcgService";

export default class PokemonTCGTracker extends Plugin {
	settings: PluginSettings;
	tcgService: TCGService;

	async onload() {
		await this.loadSettings();
		this.tcgService = new TCGService("en");

		this.addSettingTab(new PTTSettings(this.app, this));
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

			const header = [
				"",
				(details.logo ? `![Set Logo](${details.logo}.webp)` : "") + "    " + (details.symbol ? `![Set Symbol](${details.symbol}.webp)` : ""),
				"",
				`**Release Date:**\t${details.releaseDate}`,
				`**Official Cards:**\t${details.cardCount.official}`,
				`**Total Cards:**\t${details.cardCount.total}`,
				`**Variants:**\t${variantList}`,
				`**Variant count:**\t${variantCountList}`,
				"",
			];

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

			const variantHeaders = variantKeys.map(k => ` ${k} |`).join("");
			const variantSeparators = variantKeys.map(() => " --- |").join("");

			const tableLines = [
				`| Number | Owned | Name | DexId | Rarity | Category | Variant |${variantHeaders}`,
				`| ------ | ----- | ---- | ----- | ------ | -------- | ------- |${variantSeparators}`,
				...details.cards.map((c) => {
					const variantCells = variantKeys.map(k =>
						` ${c.variants.includes(k) ? "0" : ""} |`
					).join("");
					return `| ${c.localId} | 0 | ${c.name} | ${c.dexId} | ${c.rarity} | ${c.category} | ${c.variants} |${variantCells}`;
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

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
