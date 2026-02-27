import TCGdex from "@tcgdex/sdk";

export interface SetSummary {
	id: string;
	name: string;
}

export interface CardSummary {
	id: string;
	localId: string;
	name: string;
	dexId: string;
	rarity: string;
	variants: string;
	category: string;
}

export interface SetDetails {
	name: string;
	logo?: string;
	symbol?: string;
	releaseDate: string;
	cardCount: {
		total: number;
		official: number;
		normal: number;
		reverse: number;
		holo: number;
		firstEd?: number;
	};
	variants: {
		normal?: boolean;
		reverse?: boolean;
		holo?: boolean;
		firstEdition?: boolean;
	};
	cards: CardSummary[];
}

export class TCGService {
	private sdk: TCGdex;

	constructor(lang: "en" | "fr" | "es" | "it" | "pt" | "de" = "en") {
		this.sdk = new TCGdex(lang);
	}

	/** Fetch all available sets, sorted alphabetically by name. */
	async getSets(): Promise<SetSummary[]> {
		const sets = await this.sdk.set.list();
		if (!sets) return [];
		return sets
			.map((s) => ({ id: s.id, name: s.name }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** Fetch full set details including card count, variants, and all cards. */
	async getSetDetails(setId: string): Promise<SetDetails | null> {
		const set = await this.sdk.set.get(setId);
		if (!set) return null;

		const cards: CardSummary[] = [];
		for (const resume of set.cards) {
			const full = await resume.getCard();
			const variantStr = full?.variants
				? Object.entries(full.variants).filter(([, v]) => v).map(([k]) => k).join(", ")
				: "";
			const variants = variantStr || "normal";
			cards.push({
				id: resume.id,
				localId: resume.localId,
				name: resume.name,
				dexId: full?.dexId?.join(", ") ?? "",
				rarity: full?.rarity ?? "",
				variants,
				category: full?.category ?? "",
			});
		}

		return {
			name: set.name,
			logo: set.logo,
			symbol: set.symbol,
			releaseDate: set.releaseDate,
			cardCount: set.cardCount,
			variants: set.variants ?? {},
			cards,
		};
	}
}
