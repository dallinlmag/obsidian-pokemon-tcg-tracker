import {MarkdownPostProcessorContext, normalizePath, TFile} from "obsidian";
import PokemonTCGTracker from "../main";

interface CardEntry {
	cardNumber: string;
	variant: string;
}

export class CardEntryWidget {
	private plugin: PokemonTCGTracker;

	constructor(plugin: PokemonTCGTracker) {
		this.plugin = plugin;
	}

	/** Render the widget into the given container element. */
	render(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
		const container = el.createDiv({cls: "ptt-widget"});

		// --- Title ---
		container.createEl("h3", {text: "Add Pokémon cards", cls: "ptt-widget-title"});

		// Detect current set from the file path
		const currentSetId = this.detectSetFromFile(ctx.sourcePath);

		// --- Set dropdown ---
		const setRow = container.createDiv({cls: "ptt-widget-row ptt-widget-center"});
		const setSelect = setRow.createEl("select", {cls: "ptt-widget-set-select"});

		const trackedSets = this.plugin.settings.trackedSetIds
			.map(id => {
				const cached = this.plugin.settings.cachedSets.find(s => s.id === id);
				return cached ? {id, name: cached.name} : null;
			})
			.filter((s): s is {id: string; name: string} => s !== null)
			.sort((a, b) => a.name.localeCompare(b.name));

		for (const s of trackedSets) {
			const opt = setSelect.createEl("option", {text: s.name, value: s.id});
			if (s.id === currentSetId) opt.selected = true;
		}

		// --- + and +10 and Fast Mode buttons ---
		const addBtnRow = container.createDiv({cls: "ptt-widget-row ptt-widget-center"});
		const plusBtn = addBtnRow.createEl("button", {text: "+", cls: "ptt-widget-plus-btn"});
		const bulkBtn = addBtnRow.createEl("button", {text: "+10", cls: "ptt-widget-plus-btn"});
		const fastBtn = addBtnRow.createEl("button", {text: "⚡ Fast", cls: "ptt-widget-plus-btn"});

		// --- Card entry rows container ---
		const entriesContainer = container.createDiv({cls: "ptt-widget-entries"});
		const entries: {numInput: HTMLInputElement; variantToggles: {btn: HTMLButtonElement; variant: string}[]; selectedVariant: string; row: HTMLDivElement}[] = [];

		// --- Fast mode container (hidden by default) ---
		const fastContainer = container.createDiv({cls: "ptt-widget-fast-container"});
		fastContainer.style.display = "none";
		fastContainer.createEl("label", {
			text: "<Number><Variant>  e.g. 12n,14h,78r,5",
			cls: "ptt-widget-fast-label",
		});
		const fastInput = fastContainer.createEl("input", {
			cls: "ptt-widget-fast-input",
			type: "text",
			placeholder: "12n,14h,78r,5",
		});

		let fastMode = false;

		const updateVariantOptions= () => {
			const setId = setSelect.value;
			const folder = this.plugin.settings.vaultFolder;
			const setName = trackedSets.find(s => s.id === setId)?.name;
			if (!setName) return;
			const filePath = normalizePath(folder ? `${folder}/${setName}.md` : `${setName}.md`);
			const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile)) return;

			this.plugin.app.vault.cachedRead(file).then(content => {
				const headerMatch = content.match(/^\| Number .+$/m);
				if (!headerMatch) return;
				const headers = headerMatch[0].split("|").map(h => h.trim()).filter(Boolean);
				const variantColNames = ["normal", "holo", "reverse", "firstEdition"];
				const variants = variantColNames.filter(v => headers.includes(v));

				for (const entry of entries) {
					const toggleContainer = entry.row.querySelector(".ptt-widget-toggles");
					if (!toggleContainer) continue;
					toggleContainer.empty();
					entry.variantToggles = [];

					for (const v of variants) {
						const btn = toggleContainer.createEl("button", {
							text: v,
							cls: "ptt-widget-toggle-btn",
						});
						const isActive = entry.selectedVariant === v ||
							(!variants.includes(entry.selectedVariant) && v === "normal");
						if (isActive) {
							btn.addClass("ptt-widget-toggle-active");
							entry.selectedVariant = v;
						}
						btn.addEventListener("click", () => {
							entry.selectedVariant = v;
							for (const t of entry.variantToggles) {
								t.btn.removeClass("ptt-widget-toggle-active");
							}
							btn.addClass("ptt-widget-toggle-active");
						});
						entry.variantToggles.push({btn, variant: v});
					}
				}
			});
		};

		const addEntryRow = () => {
			const row = entriesContainer.createDiv({cls: "ptt-widget-row ptt-widget-entry-row"});

			const numInput = row.createEl("input", {
				cls: "ptt-widget-num-input",
				type: "number",
				placeholder: "#",
			});
			numInput.maxLength = 3;
			numInput.min = "1";
			numInput.max = "999";

			const toggleContainer = row.createDiv({cls: "ptt-widget-toggles"});

			const entry = {numInput, variantToggles: [] as {btn: HTMLButtonElement; variant: string}[], selectedVariant: "normal", row};
			entries.push(entry);

			updateVariantOptions();
			return entry;
		};

		// Add initial entry row
		addEntryRow();

		// Wire up + and +10 buttons
		plusBtn.addEventListener("click", () => { addEntryRow(); });
		bulkBtn.addEventListener("click", () => { for (let i = 0; i < 10; i++) addEntryRow(); });

		// Wire up fast mode toggle
		fastBtn.addEventListener("click", () => {
			fastMode = !fastMode;
			if (fastMode) {
				entriesContainer.style.display = "none";
				addBtnRow.querySelectorAll("button").forEach(b => {
					if (b !== fastBtn) (b as HTMLElement).style.display = "none";
				});
				fastContainer.style.display = "";
				fastBtn.addClass("ptt-widget-toggle-active");
			} else {
				entriesContainer.style.display = "";
				addBtnRow.querySelectorAll("button").forEach(b => {
					(b as HTMLElement).style.display = "";
				});
				fastContainer.style.display = "none";
				fastBtn.removeClass("ptt-widget-toggle-active");
			}
		});

		// Update variants when set changes
		setSelect.addEventListener("change", () => {
			updateVariantOptions();
		});

		// --- Add to Pokedex button ---
		const submitRow = container.createDiv({cls: "ptt-widget-row ptt-widget-center"});
		const submitBtn = submitRow.createEl("button", {text: "Add to Pokédex", cls: "ptt-widget-submit-btn"});

		const handleSubmit = async () => {
			const setId = setSelect.value;
			if (!setId) {
				new (await import("obsidian")).Notice("Please select a set.");
				return;
			}

			const cardEntries: CardEntry[] = [];

			if (fastMode) {
				// Parse fast mode input: "12n,14h,78r,5" → [{cardNumber:"12",variant:"normal"}, ...]
				const variantMap: Record<string, string> = {
					n: "normal", h: "holo", r: "reverse", f: "firstEdition",
				};
				const raw = fastInput.value.trim();
				if (!raw) {
					new (await import("obsidian")).Notice("Please enter cards in fast mode format.");
					return;
				}
				const tokens = raw.split(/[,\s]+/).filter(Boolean);
				for (const token of tokens) {
					const match = token.match(/^(\d+)([nhrf]?)$/i);
					if (!match) {
						new (await import("obsidian")).Notice(`Invalid token: "${token}". Use format like 12n, 14h, 78r, or 5`);
						return;
					}
					const num = match[1]!;
					const letter = (match[2] ?? "").toLowerCase();
					const variant = letter ? (variantMap[letter] ?? "normal") : "normal";
					cardEntries.push({cardNumber: num, variant});
				}
			} else {
				for (const entry of entries) {
					const num = entry.numInput.value.trim();
					const variant = entry.selectedVariant;
					if (num && variant) {
						cardEntries.push({cardNumber: num, variant});
					}
				}
			}

			if (cardEntries.length === 0) {
				new (await import("obsidian")).Notice("Please enter at least one card.");
				return;
			}

			await this.plugin.addCardsToSet(setId, cardEntries);

			// Clear inputs after success
			if (fastMode) {
				fastInput.value = "";
			} else {
				for (const entry of entries) {
					entry.numInput.value = "";
				}
				// Remove extra rows, keep first
				while (entries.length > 1) {
					const removed = entries.pop();
					removed?.row.remove();
				}
			}
		};

		submitBtn.addEventListener("click", handleSubmit);
		fastInput.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleSubmit();
			}
		});
		entriesContainer.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.target as HTMLElement)?.classList?.contains("ptt-widget-num-input")) {
				e.preventDefault();
				handleSubmit();
			}
		});
	}

	/** Detect the set ID from the current file path. */
	private detectSetFromFile(sourcePath: string): string | null {
		const folder = this.plugin.settings.vaultFolder;
		const expectedPrefix = folder ? folder + "/" : "";

		if (expectedPrefix && !sourcePath.startsWith(expectedPrefix)) return null;

		const fileName = sourcePath.slice(expectedPrefix.length).replace(/\.md$/, "");

		for (const setId of this.plugin.settings.trackedSetIds) {
			const cached = this.plugin.settings.cachedSets.find(s => s.id === setId);
			if (cached?.name === fileName) return setId;
		}
		return null;
	}
}
