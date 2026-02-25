import {AbstractInputSuggest, App, TFolder} from "obsidian";

/** Autocomplete suggest that lists all folders in the vault. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private selectCallback: (folder: TFolder) => void;

	constructor(app: App, inputEl: HTMLInputElement, onSelectFolder: (folder: TFolder) => void) {
		super(app, inputEl);
		this.selectCallback = onSelectFolder;
	}

	getSuggestions(query: string): TFolder[] {
		const lowerQuery = query.toLowerCase();
		const folders: TFolder[] = [];
		const allFiles = this.app.vault.getAllLoadedFiles();
		for (const f of allFiles) {
			if (f instanceof TFolder && f.path.toLowerCase().includes(lowerQuery)) {
				folders.push(f);
			}
		}
		return folders.sort((a, b) => a.path.localeCompare(b.path));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path || "/");
	}

	selectSuggestion(folder: TFolder): void {
		this.setValue(folder.path);
		this.selectCallback(folder);
		this.close();
	}
}
