import {
	App,
	Modal,
	Notice,
	RequestUrlParam,
	Plugin,
	PluginSettingTab,
	Setting,
	TextComponent,
	Vault,
	request,
	htmlToMarkdown,
} from "obsidian";

interface GetChostSettings {
	importPostTags: boolean;
	importPostComments: boolean;
	tagSpaceReplacer: "-" | "_";
}

const DEFAULT_SETTINGS: GetChostSettings = {
	importPostTags: false,
	importPostComments: false,
	tagSpaceReplacer: "-",
};

interface Chost {
	postURL: string;
	postAuthorUsername: string;
	postTitle: string | undefined;
	postTags: string | undefined;
	postContent: string;
	// postComments: string[];
}

export default class GetChost extends Plugin {
	settings: GetChostSettings;

	async onload() {
		await this.loadSettings();

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "import-chost-from-URL",
			name: "Import a Chost from URL (creates a new note)",
			callback: () => {
				new urlInputModal(this.app, this).open();
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		// TODO
		this.addSettingTab(new GetChostSettingsTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async fetchChost(postURL: string): Promise<Chost | undefined> {
		const requestParam: RequestUrlParam = {
			url: postURL,
		};
		let body: string = "";
		const resp = await request(requestParam)
			.then((r) => (body = r.toString()))
			.catch(() => {
				new Notice(
					"Failed to get post. Check your internet connection and the URL."
				);
				return undefined;
			});
		const extract = this.parseChost(body, postURL);
		return extract;
	}

	async parseChost(html: string, url: string): Promise<Chost> {
		const parsedHTML = new DOMParser().parseFromString(html, "text/html");
		const post: HTMLElement = parsedHTML.querySelector(
			"article.co-post-box"
		);
		/// cleanup title section, detect and format asks
		// check for post title
		if (post.querySelector("a > h3")) {
			let newEle = document.createElement("h3");
			newEle.appendText(post.querySelector("a > h3")?.innerHTML);
			post.querySelector("a:has(h3)")?.replaceWith(newEle);
		}
		// check for ask
		if (post.querySelector("div.co-embedded-ask")) {
			let children = post.querySelector("div.co-embedded-ask")?.children;
			let newEle = document.createElement("blockquote"); //.append(..post.querySelector("div.co-embedded-ask")?.innerHTML)
			while (
				post.querySelector("div.co-embedded-ask")?.childNodes.length
			) {
				newEle.appendChild(
					post.querySelector("div.co-embedded-ask")?.firstChild
				);
			}
			post.querySelector("div.co-embedded-ask")?.replaceWith(newEle);
		}

		// strip empty <a> tag (login link)
		post.querySelector('a[href="https://cohost.org/rc/login"]')?.remove();

		// parse tags if
		let frontmatterTags: string = "";
		if (this.settings.importPostTags) {
			const tags = post.querySelector("div.co-tags > div");
			frontmatterTags = "---\ntags:";
			tags?.childNodes.forEach((tagLink) => {
				frontmatterTags = frontmatterTags.concat(
					"\n  - " +
						tagLink.textContent
							?.substring(1)
							.replace(" ", this.settings.tagSpaceReplacer)
				);
			});
			frontmatterTags = frontmatterTags.concat("\n---\n");
		} else {
			frontmatterTags = "";
		}

		const postMarkdown = htmlToMarkdown(post);
		const title = parsedHTML.querySelector("h3:not([class])")?.innerHTML;
		const author =
			parsedHTML.querySelector("a[rel=author]")?.innerHTML || "not found";
		if (author === "not found") {
			this.handleNotFound("author");
		}
		// const comments: string[] = [];

		let chost: Chost = {
			postURL: url,
			postAuthorUsername: author,
			postTitle: title,
			postTags: frontmatterTags,
			postContent: postMarkdown,
			// postComments: [],
		};

		return chost;
	}

	async writeChostToFile(targetURL: string, vault: Vault) {
		const chost: Chost | undefined = await this.fetchChost(targetURL);
		if (!chost) {
			this.handleNotFound(targetURL);
			return;
		}

		if (chost.postTitle == undefined || chost.postTitle == "") {
			vault
				.create(
					chost.postAuthorUsername +
						" - " +
						chost.postURL.replace(
							"https://cohost.org/" +
								chost.postAuthorUsername +
								"/post/",
							""
						) +
						".md",
					chost.postTags + chost.postContent
				)
				.catch((_e) => this.handleFileExists());
		} else {
			vault
				.create(
					chost.postAuthorUsername + " - " + chost.postTitle + ".md",
					chost.postTags + chost.postContent
				)
				.catch((_e) => this.handleFileExists());
		}
	}

	handleNotFound(searchTerm: string) {
		new Notice(`Post ${searchTerm} not found!`);
	}

	handleFileExists() {
		new Notice(`Note with that title already exists!`);
	}
}

class urlInputModal extends Modal {
	urlToFetch: string;
	plugin: GetChost;

	constructor(app: App, plugin: GetChost) {
		super(app);
		this.plugin = plugin;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "input cohost.org URL here" });

		const inputs = contentEl.createDiv("inputs");
		const urlInput = new TextComponent(inputs).onChange((urlToFetch) => {
			this.urlToFetch = urlToFetch;
		});
		urlInput.inputEl.focus();
		urlInput.inputEl.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				this.close();
			}
		});

		const controls = contentEl.createDiv("controls");
		const searchButton = controls.createEl("button", {
			text: "Search",
			cls: "mod-cta",
			attr: {
				autofocus: true,
			},
		});
		searchButton.addEventListener("click", this.close.bind(this));

		const cancelButton = controls.createEl("button", { text: "Cancel" });
		cancelButton.addEventListener("click", this.close.bind(this));
	}
	async onClose() {
		let { contentEl } = this;
		contentEl.empty();
		if (this.urlToFetch) {
			this.plugin.writeChostToFile(
				this.urlToFetch,
				this.plugin.app.vault
			);
		}
	}
}

class GetChostSettingsTab extends PluginSettingTab {
	plugin: GetChost;

	constructor(app: App, plugin: GetChost) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Import post tags")
			.setDesc("Import post tags (if any exist) as Obsidian tags.")
			.addToggle((component) =>
				component
					.setValue(this.plugin.settings.importPostTags)
					.onChange(async (value) => {
						this.plugin.settings.importPostTags = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Tag Space Replacement Character")
			.setDesc(
				"While cohost.org tags support spaces, Obsidian tags do not. Choose your prefered replacement."
			)
			.addDropdown((component) => {
				component
					.addOption("-", "Dash (-)")
					.addOption("_", "Underscore (_)")
					.setValue(this.plugin.settings.tagSpaceReplacer)
					.onChange(async (value) => {
						this.plugin.settings.tagSpaceReplacer = value;
						await this.plugin.saveSettings();
					});
			});

		// new Setting(containerEl)
		// .setName("Import post comments")
		// .setDesc("Import post comments (if any exist).")
		// .addToggle((component) =>
		// component
		// .setValue(this.plugin.settings.importPostComments)
		// .onChange(async (value) => {
		// this.plugin.settings.importPostComments = value;
		// await this.plugin.saveSettings();
		// })
		// );
	}
}
