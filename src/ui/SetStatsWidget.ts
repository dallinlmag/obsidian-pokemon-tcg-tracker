import {normalizePath, TFile} from "obsidian";
import PokemonTCGTracker from "../main";

export class SetStatsWidget {
	private plugin: PokemonTCGTracker;

	constructor(plugin: PokemonTCGTracker) {
		this.plugin = plugin;
	}

	/** Render stats for a single set. Source should contain a set ID or set name. */
	async renderSetStats(source: string, el: HTMLElement): Promise<void> {
		const query = source.split("\n").find(l => l.trim() && !l.trim().startsWith("#"))?.trim() ?? "";
		if (!query) {
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			el.createEl("p", {text: "⚠️ Please specify a set ID or name. Set IDs can be found in the plugin settings.", cls: "ptt-stats-error"});
			return;
		}

		// Resolve by ID first, then by name (case-insensitive)
		let cached = this.plugin.settings.cachedSets.find(s => s.id === query);
		if (!cached) {
			const lower = query.toLowerCase();
			cached = this.plugin.settings.cachedSets.find(s => s.name.toLowerCase() === lower);
		}
		if (!cached) {
			el.createEl("p", {text: `⚠️ Unknown set: "${query}"`, cls: "ptt-stats-error"});
			return;
		}

		if (!this.plugin.settings.trackedSetIds.includes(cached.id)) {
			el.createEl("p", {text: `⚠️ Set not tracked: "${cached.name}"`, cls: "ptt-stats-error"});
			return;
		}

		const file = this.getSetFile(cached.name);
		if (!file) {
			el.createEl("p", {text: `⚠️ Set file not found: ${cached.name}`, cls: "ptt-stats-error"});
			return;
		}

		const tracking = await this.plugin.parseSetTracking(file);
		if (!tracking) {
			el.createEl("p", {text: `⚠️ No tracking data for ${cached.name}`, cls: "ptt-stats-error"});
			return;
		}

		// Extract logo URL from the set file
		const content = await this.plugin.app.vault.cachedRead(file);
		const logoMatch = content.match(/<img src="([^"]+)" alt="Set Logo"/);
		const logoUrl = logoMatch?.[1] ?? null;

		this.renderTracking(el, tracking, cached.name, logoUrl);
	}

	/** Render aggregate stats across all tracked sets. */
	async renderCollectionStats(el: HTMLElement): Promise<void> {
		const trackedSorted = this.plugin.settings.trackedSetIds
			.map(id => ({id, name: this.plugin.settings.cachedSets.find(s => s.id === id)?.name ?? id}))
			.sort((a, b) => a.name.localeCompare(b.name));

		if (trackedSorted.length === 0) {
			el.createEl("p", {text: "No sets tracked yet.", cls: "ptt-stats-error"});
			return;
		}

		let aggOfficialOwned = 0, aggOfficialMax = 0;
		let aggTotalOwned = 0, aggTotalMax = 0;
		let aggTotalOwnedSum = 0;
		const aggVariantOwned: Record<string, number> = {};
		const aggVariantMax: Record<string, number> = {};
		const aggVariantSums: Record<string, number> = {};

		for (const {name} of trackedSorted) {
			const file = this.getSetFile(name);
			if (!file) continue;

			const tracking = await this.plugin.parseSetTracking(file);
			if (!tracking) continue;

			aggOfficialOwned += tracking.officialOwned;
			aggOfficialMax += tracking.officialMax;
			aggTotalOwned += tracking.totalOwned;
			aggTotalMax += tracking.totalMax;
			aggTotalOwnedSum += tracking.totalOwnedSum;

			for (const [v, count] of Object.entries(tracking.variantOwned)) {
				aggVariantOwned[v] = (aggVariantOwned[v] ?? 0) + count;
			}
			for (const [v, max] of Object.entries(tracking.variantMax)) {
				aggVariantMax[v] = (aggVariantMax[v] ?? 0) + max;
			}
			for (const [v, sum] of Object.entries(tracking.variantSums)) {
				aggVariantSums[v] = (aggVariantSums[v] ?? 0) + sum;
			}
		}

		this.renderTracking(el, {
			officialOwned: aggOfficialOwned, officialMax: aggOfficialMax,
			totalOwned: aggTotalOwned, totalMax: aggTotalMax,
			totalOwnedSum: aggTotalOwnedSum,
			variantOwned: aggVariantOwned, variantMax: aggVariantMax,
			variantSums: aggVariantSums,
		}, "Total Collection");
	}

	private getSetFile(setName: string): TFile | null {
		const folder = this.plugin.settings.vaultFolder;
		const filePath = normalizePath(folder ? `${folder}/${setName}.md` : `${setName}.md`);
		const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
		return file instanceof TFile ? file : null;
	}

	/** Build DOM elements for tracking stats. */
	private renderTracking(
		el: HTMLElement,
		tracking: {
			officialOwned: number; officialMax: number;
			totalOwned: number; totalMax: number;
			totalOwnedSum: number;
			variantOwned: Record<string, number>;
			variantMax: Record<string, number>;
			variantSums: Record<string, number>;
		},
		title?: string,
		logoUrl?: string | null
	) {
		const container = el.createDiv({cls: "ptt-tracking"});

		if (logoUrl) {
			const img = container.createEl("img", {cls: "ptt-stats-logo"});
			img.src = logoUrl;
			img.alt = title ? `${title} logo` : "Set logo";
		}

		if (title) {
			container.createEl("h4", {text: title, cls: "ptt-stats-title"});
		}

		const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

		this.addProgressRow(container, "Official", tracking.officialOwned, tracking.officialMax);
		this.addProgressRow(container, "Total", tracking.totalOwned, tracking.totalMax);

		for (const v of Object.keys(tracking.variantMax)) {
			this.addProgressRow(container, cap(v), tracking.variantOwned[v] ?? 0, tracking.variantMax[v] ?? 0);
		}

		container.createEl("hr");

		this.addTotalRow(container, "Total Owned", tracking.totalOwnedSum);
		for (const v of Object.keys(tracking.variantMax)) {
			this.addTotalRow(container, cap(v) + " Total", tracking.variantSums[v] ?? 0);
		}
	}

	private addProgressRow(container: HTMLElement, label: string, owned: number, max: number) {
		const row = container.createDiv({cls: "ptt-progress-row"});
		row.createEl("span", {text: `${label}:`, cls: "ptt-progress-label"});
		row.createEl("span", {text: `${owned}/${max}`, cls: "ptt-progress-count"});
		const bar = row.createEl("progress", {cls: "ptt-progress-bar"});
		bar.value = owned;
		bar.max = max;
	}

	private addTotalRow(container: HTMLElement, label: string, count: number) {
		const row = container.createDiv({cls: "ptt-progress-row"});
		row.createEl("span", {text: `${label}:`, cls: "ptt-progress-label"});
		row.createEl("span", {text: `${count}`, cls: "ptt-progress-count"});
	}
}
