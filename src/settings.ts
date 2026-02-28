import {App, Notice, PluginSettingTab, Setting} from "obsidian";
import PokemonTCGTracker from "./main";
import {SetSummary} from "./api/tcgService";
import {FolderSuggest} from "./ui/FolderSuggest";

export interface PluginSettings {
	/** Vault folder path for plugin-generated files (empty = vault root) */
	vaultFolder: string;
	/** IDs of sets the user is tracking */
	trackedSetIds: string[];
	/** Cached set list from TCGdex */
	cachedSets: SetSummary[];
}

export const DEFAULT_SETTINGS: PluginSettings = {
	vaultFolder: "",
	trackedSetIds: [],
	cachedSets: [],
};

export class PTTSettings extends PluginSettingTab {
	plugin: PokemonTCGTracker;
	private sets: SetSummary[] = [];

	constructor(app: App, plugin: PokemonTCGTracker) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const {containerEl} = this;
		containerEl.empty();

		containerEl.createEl("h2", {text: "Pokemon TCG Tracker"});

		// Use cached sets; fetch from network only on first use or refresh
		if (this.plugin.settings.cachedSets.length === 0) {
			await this.refreshSets();
		}
		this.sets = this.plugin.settings.cachedSets;

		// --- Vault folder ---
		new Setting(containerEl)
			.setName("Vault folder")
			.setDesc("Folder in your vault where plugin files will be saved. Leave empty for the vault root.")
			.addText(text => {
				text.setPlaceholder("e.g. Pokemon/TCG")
					.setValue(this.plugin.settings.vaultFolder);
				new FolderSuggest(this.app, text.inputEl, async (folder) => {
					this.plugin.settings.vaultFolder = folder.path;
					await this.plugin.saveSettings();
				});
				text.onChange(async (value) => {
					this.plugin.settings.vaultFolder = value.trim().replace(/\/+$/, "");
					await this.plugin.saveSettings();
				});
			});

		// --- Add set dropdown ---
		const tracked = new Set(this.plugin.settings.trackedSetIds);
		const options: Record<string, string> = {"": "— Select a set to add —"};
		for (const s of this.sets) {
			if (!tracked.has(s.id)) {
				options[s.id] = s.name;
			}
		}

		new Setting(containerEl)
			.setName("Add a set")
			.setDesc(`Choose a set to track. ${this.sets.length} sets available.`)
			.addDropdown(dropdown => dropdown
				.addOptions(options)
				.setValue("")
				.onChange(async (value) => {
					if (!value) return;
					this.plugin.settings.trackedSetIds.push(value);
					await this.plugin.saveSettings();
					const name = this.sets.find(s => s.id === value)?.name ?? value;
					new Notice(`Added set: ${name}`);
					await this.plugin.createSetFile(value, name);
					this.display();
				}))
			.addExtraButton(btn => btn
				.setIcon("refresh-cw")
				.setTooltip("Refresh sets from TCGdex")
				.onClick(async () => {
					await this.refreshSets();
					this.sets = this.plugin.settings.cachedSets;
					this.display();
				}));

		// --- Tracked sets list ---
		containerEl.createEl("h3", {text: "Tracked Sets"});

		if (this.plugin.settings.trackedSetIds.length === 0) {
			containerEl.createEl("p", {
				text: "No sets tracked yet. Use the dropdown above to add one.",
				cls: "setting-item-description",
			});
		}

		for (const setId of this.plugin.settings.trackedSetIds) {
			const name = this.sets.find(s => s.id === setId)?.name ?? setId;
			new Setting(containerEl)
				.setName(name)
				.setDesc(setId)
				.addExtraButton(btn => btn
					.setIcon("download")
					.setTooltip("Export set to backup")
					.onClick(async () => {
						await this.plugin.exportSetData(setId);
					}))
				.addExtraButton(btn => btn
					.setIcon("import")
					.setTooltip("Import set from backup")
					.onClick(async () => {
						await this.plugin.importSetData(setId);
					}))
				.addExtraButton(btn => btn
					.setIcon("refresh-cw")
					.setTooltip("Reset set file (auto-exports backup first)")
					.onClick(async () => {
						new Notice(`Exporting backup before reset…`);
						await this.plugin.exportSetData(setId);
						new Notice(`Resetting ${name}…`);
						await this.plugin.createSetFile(setId, name);
					}))
				.addExtraButton(btn => btn
					.setIcon("cross")
					.setTooltip("Remove set")
					.onClick(async () => {
						this.plugin.settings.trackedSetIds =
							this.plugin.settings.trackedSetIds.filter(id => id !== setId);
						await this.plugin.saveSettings();
						new Notice(`Removed set: ${name}`);
						this.display();
					}));
		}

		// --- Import / Export ---
		containerEl.createEl("h3", {text: "Import / Export"});

		new Setting(containerEl)
			.setName("Export Collection")
			.setDesc("Export all tracked set data to a JSON backup file in your vault.")
			.addButton(btn => btn
				.setButtonText("Export")
				.onClick(async () => {
					await this.plugin.exportCollectionData();
				}));

		new Setting(containerEl)
			.setName("Import Collection")
			.setDesc("Import all set data from the backup file, overwriting current values.")
			.addButton(btn => btn
				.setButtonText("Import")
				.onClick(async () => {
					await this.plugin.importCollectionData();
				}));
	}

	/** Fetch sets from TCGdex and persist to cache. */
	private async refreshSets(): Promise<void> {
		try {
			const sets = await this.plugin.tcgService.getSets();
			this.plugin.settings.cachedSets = sets;
			await this.plugin.saveSettings();
			new Notice(`Refreshed: ${sets.length} sets loaded from TCGdex.`);
		} catch (e) {
			new Notice("TCGdex: failed to fetch sets. Check your internet connection.");
		}
	}
}
