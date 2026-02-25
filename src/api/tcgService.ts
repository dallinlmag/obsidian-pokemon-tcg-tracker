import TCGdex from "@tcgdex/sdk";

export interface SetSummary {
	id: string;
	name: string;
}

export interface CardSummary {
	id: string;
	localId: string;
	name: string;
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

	/** Fetch all cards in a set, ordered by localId. */
	async getCardsInSet(setId: string): Promise<CardSummary[]> {
		const set = await this.sdk.set.get(setId);
		if (!set || !set.cards) return [];
		return set.cards.map((c) => ({
			id: c.id,
			localId: c.localId,
			name: c.name,
		}));
	}
}
