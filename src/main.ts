import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  moment,
  WorkspaceLeaf,
  requestUrl,
} from "obsidian";

const VIEW_TYPE_INTERVIEW = "obsidian-daily-interview-view";

interface ObsidianDailyInterviewerSettings {
  openRouterApiKey: string;
  model: string;
  readMonthlyNote: boolean;
  readWeeklyNote: boolean;
  readDailyNote: boolean;
  previousDailyNotesCount: number;
  customPrompt: string;
  monthlyNoteFormat: string;
  weeklyNoteFormat: string;
  dailyNoteFormat: string;
  monthlyNoteFolder: string;
  weeklyNoteFolder: string;
  dailyNoteFolder: string;
  interviewFolder: string;
}

const DEFAULT_SETTINGS: ObsidianDailyInterviewerSettings = {
  openRouterApiKey: "",
  model: "anthropic/claude-opus-4.5",
  readMonthlyNote: true,
  readWeeklyNote: true,
  readDailyNote: true,
  previousDailyNotesCount: 0,
  customPrompt: "",
  monthlyNoteFormat: "YYYY-MM",
  weeklyNoteFormat: "YYYY-[W]WW",
  dailyNoteFormat: "YYYY-MM-DD",
  monthlyNoteFolder: "",
  weeklyNoteFolder: "",
  dailyNoteFolder: "",
  interviewFolder: "Interviews",
};

const POPULAR_MODELS = [
  // Top-tier frontier models
  "anthropic/claude-opus-4.5",
  "anthropic/claude-sonnet-4.5",
  "openai/gpt-5.1",
  "openai/gpt-4o",
  "google/gemini-2.5-pro-preview",
  "google/gemini-2.5-flash",
  "x-ai/grok-4",
  // Great value / specialized models
  "deepseek/deepseek-chat",
  "anthropic/claude-sonnet-4",
  "meta-llama/llama-3.3-70b-instruct",
  "qwen/qwen-2.5-72b-instruct",
  "mistralai/mistral-large-2",
];

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export default class ObsidianDailyInterviewerPlugin extends Plugin {
  settings: ObsidianDailyInterviewerSettings;

  async onload() {
    await this.loadSettings();

    // Register the custom view
    this.registerView(
      VIEW_TYPE_INTERVIEW,
      (leaf) => new InterviewView(leaf, this)
    );

    // Add ribbon icon
    this.addRibbonIcon("message-circle", "Daily Interview", () => {
      this.activateView();
    });

    // Keep the command as well
    this.addCommand({
      id: "start-daily-interview",
      name: "Start Daily Interview",
      callback: () => {
        this.activateView();
      },
    });

    this.addSettingTab(new ObsidianDailyInterviewerSettingTab(this.app, this));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_INTERVIEW);
  }

  async activateView() {
    const { workspace } = this.app;

    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(VIEW_TYPE_INTERVIEW);

    if (leaves.length > 0) {
      // View already exists, reveal it
      leaf = leaves[0];
    } else {
      // Create new leaf in right sidebar
      leaf = workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: VIEW_TYPE_INTERVIEW, active: true });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async gatherContext(): Promise<string> {
    const parts: string[] = [];
    const now = moment();

    if (this.settings.readMonthlyNote) {
      const monthlyContent = await this.getNoteContent(
        this.settings.monthlyNoteFolder,
        now.format(this.settings.monthlyNoteFormat)
      );
      if (monthlyContent) {
        parts.push(`## Monthly Note (${now.format(this.settings.monthlyNoteFormat)})\n${monthlyContent}`);
      }
    }

    if (this.settings.readWeeklyNote) {
      const weeklyContent = await this.getNoteContent(
        this.settings.weeklyNoteFolder,
        now.format(this.settings.weeklyNoteFormat)
      );
      if (weeklyContent) {
        parts.push(`## Weekly Note (${now.format(this.settings.weeklyNoteFormat)})\n${weeklyContent}`);
      }
    }

    if (this.settings.readDailyNote) {
      const dailyContent = await this.getNoteContent(
        this.settings.dailyNoteFolder,
        now.format(this.settings.dailyNoteFormat)
      );
      if (dailyContent) {
        parts.push(`## Daily Note (${now.format(this.settings.dailyNoteFormat)})\n${dailyContent}`);
      }
    }

    // Read previous daily notes if configured
    if (this.settings.previousDailyNotesCount > 0) {
      const previousNotes: string[] = [];
      for (let i = 1; i <= this.settings.previousDailyNotesCount; i++) {
        const pastDate = moment().subtract(i, 'days');
        const pastContent = await this.getNoteContent(
          this.settings.dailyNoteFolder,
          pastDate.format(this.settings.dailyNoteFormat)
        );
        if (pastContent) {
          previousNotes.push(`### ${pastDate.format("dddd, MMMM D, YYYY")} (${pastDate.format(this.settings.dailyNoteFormat)})\n${pastContent}`);
        }
      }
      if (previousNotes.length > 0) {
        parts.push(`## Previous Daily Notes\n\n${previousNotes.join("\n\n---\n\n")}`);
      }
    }

    return parts.join("\n\n---\n\n");
  }

  async getNoteContent(folder: string, filename: string): Promise<string | null> {
    const path = folder ? `${folder}/${filename}.md` : `${filename}.md`;
    const file = this.app.vault.getAbstractFileByPath(path);

    if (file instanceof TFile) {
      return await this.app.vault.read(file);
    }
    return null;
  }

  async saveInterview(conversation: Message[]): Promise<string> {
    const now = moment();
    const timestamp = now.format("YYYY-MM-DD_HHmmss");
    const folderPath = this.settings.interviewFolder;
    const filename = `Interview_${timestamp}.md`;
    const fullPath = folderPath ? `${folderPath}/${filename}` : filename;

    // Ensure folder exists
    if (folderPath) {
      const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }
    }

    // Format conversation as markdown
    let content = `# Daily Interview - ${now.format("MMMM D, YYYY h:mm A")}\n\n`;

    for (const msg of conversation) {
      if (msg.role === "user") {
        content += `**You:** ${msg.content}\n\n`;
      } else if (msg.role === "assistant") {
        content += `**Interviewer:** ${msg.content}\n\n`;
      }
    }

    await this.app.vault.create(fullPath, content);
    return fullPath;
  }

  async appendToDailyNote(summary: string, interviewLink: string) {
    const now = moment();
    const dailyNotePath = this.settings.dailyNoteFolder
      ? `${this.settings.dailyNoteFolder}/${now.format(this.settings.dailyNoteFormat)}.md`
      : `${now.format(this.settings.dailyNoteFormat)}.md`;

    const file = this.app.vault.getAbstractFileByPath(dailyNotePath);

    if (file instanceof TFile) {
      const currentContent = await this.app.vault.read(file);
      const appendContent = `\n\n---\n\n## Evening Reflection\n\n${summary}\n\n[[${interviewLink}|Full Interview]]`;
      await this.app.vault.modify(file, currentContent + appendContent);
      new Notice("Interview summary added to daily note!");
    } else {
      new Notice("Could not find daily note to append summary.");
    }
  }
}

class InterviewView extends ItemView {
  plugin: ObsidianDailyInterviewerPlugin;
  messages: Message[] = [];
  chatContainer: HTMLElement;
  inputEl: HTMLTextAreaElement;
  isLoading: boolean = false;
  context: string = "";
  interviewStarted: boolean = false;

  constructor(leaf: WorkspaceLeaf, plugin: ObsidianDailyInterviewerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return VIEW_TYPE_INTERVIEW;
  }

  getDisplayText() {
    return "Daily Interview";
  }

  getIcon() {
    return "message-circle";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("interview-view-container");

    // Header
    const header = container.createDiv({ cls: "interview-header" });
    header.createEl("h4", { text: "Daily Interview" });

    // Start/New Interview button
    const startBtn = header.createEl("button", { text: "New Interview", cls: "interview-start-btn" });
    startBtn.onclick = () => this.startNewInterview();

    // Chat container
    this.chatContainer = container.createDiv({ cls: "interview-chat-container" });

    // Input area
    const inputContainer = container.createDiv({ cls: "interview-input-container" });

    this.inputEl = inputContainer.createEl("textarea", {
      placeholder: "Type your response...",
    });

    const buttonRow = inputContainer.createDiv({ cls: "interview-button-row" });

    const sendBtn = buttonRow.createEl("button", { text: "Send", cls: "interview-send-btn" });
    sendBtn.onclick = () => this.sendMessage();

    const endBtn = buttonRow.createEl("button", { text: "End & Save", cls: "interview-end-btn" });
    endBtn.onclick = () => this.endInterview();

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // Show welcome message
    this.showWelcome();
  }

  showWelcome() {
    this.chatContainer.empty();
    const welcome = this.chatContainer.createDiv({ cls: "interview-welcome" });
    welcome.createEl("p", { text: "Click 'New Interview' to start your daily reflection." });
    welcome.createEl("p", {
      text: "The AI will read your daily, weekly, and monthly notes to personalize the conversation.",
      cls: "interview-welcome-sub"
    });
  }

  async startNewInterview() {
    if (!this.plugin.settings.openRouterApiKey) {
      new Notice("Please set your OpenRouter API key in settings.");
      return;
    }

    // Reset state
    this.messages = [];
    this.chatContainer.empty();
    this.interviewStarted = true;

    // Gather context
    this.context = await this.plugin.gatherContext();

    // Build system prompt and start
    const systemPrompt = this.buildSystemPrompt();
    this.messages.push({ role: "system", content: systemPrompt });

    // Get initial greeting from AI
    await this.getAIResponse();
  }

  buildSystemPrompt(): string {
    const now = moment();
    const dateInfo = `Current date: ${now.format("dddd, MMMM D, YYYY")} at ${now.format("h:mm A")}`;

    let prompt = `You are a thoughtful and empathetic interviewer helping someone reflect on their day. Your goal is to help them process their experiences, celebrate wins, acknowledge challenges, and identify insights.

${dateInfo}

Be conversational, warm, and genuinely curious. Ask follow-up questions based on their responses. Keep your responses concise but meaningful.

The interview should cover:
1. How they're feeling right now
2. What went well today
3. What challenges they faced
4. What they learned or would do differently
5. What they're looking forward to

After 5-7 exchanges, naturally wrap up the conversation and provide a brief summary of the key points discussed.`;

    if (this.plugin.settings.customPrompt) {
      prompt += `\n\nAdditional guidance: ${this.plugin.settings.customPrompt}`;
    }

    if (this.context) {
      prompt += `\n\n---\n\nHere is context from their notes to inform your questions:\n\n${this.context}`;
      prompt += `\n\n---\n\nIMPORTANT: Start the conversation by briefly recapping what you noticed from their notes that seems relevant or interesting - mention specific things like goals, tasks, events, or themes you observed. Then use this context to ask your opening question. This shows you've read their notes and helps focus the conversation on what matters to them today.`;
    }

    return prompt;
  }

  async sendMessage() {
    if (!this.interviewStarted) {
      new Notice("Click 'New Interview' to start.");
      return;
    }

    const userInput = this.inputEl.value.trim();
    if (!userInput || this.isLoading) return;

    this.inputEl.value = "";
    this.addMessageToChat("user", userInput);
    this.messages.push({ role: "user", content: userInput });

    await this.getAIResponse();
  }

  async getAIResponse() {
    this.isLoading = true;
    const loadingEl = this.chatContainer.createDiv({ cls: "loading-message" });
    loadingEl.textContent = "Thinking...";
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

    try {
      const response = await requestUrl({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.plugin.settings.openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://obsidian.md",
          "X-Title": "Obsidian Daily Interviewer",
        },
        body: JSON.stringify({
          model: this.plugin.settings.model,
          messages: this.messages,
        }),
      });

      const data = response.json;
      const assistantMessage = data.choices[0].message.content;

      loadingEl.remove();
      this.addMessageToChat("assistant", assistantMessage);
      this.messages.push({ role: "assistant", content: assistantMessage });
    } catch (error) {
      loadingEl.remove();
      console.error("OpenRouter API error:", error);
      new Notice("Error communicating with AI. Check your API key and try again.");
    }

    this.isLoading = false;
  }

  addMessageToChat(role: "user" | "assistant", content: string) {
    const messageEl = this.chatContainer.createDiv({ cls: `interview-message ${role}-message` });

    const label = role === "user" ? "You" : "Interviewer";
    messageEl.createEl("strong", { text: label, cls: "message-label" });

    const contentEl = messageEl.createEl("div", { cls: "message-content" });
    contentEl.textContent = content;

    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }

  async endInterview() {
    if (this.messages.length < 2) {
      new Notice("No interview to save.");
      return;
    }

    // Show saving indicator
    const savingEl = this.chatContainer.createDiv({ cls: "loading-message" });
    savingEl.textContent = "Saving interview...";
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

    // Get a summary from the AI
    const summaryMessages: Message[] = [
      ...this.messages,
      {
        role: "user",
        content: "Please provide a brief 2-3 sentence summary of our conversation, highlighting the key themes and insights.",
      },
    ];

    try {
      const response = await requestUrl({
        url: "https://openrouter.ai/api/v1/chat/completions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.plugin.settings.openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://obsidian.md",
          "X-Title": "Obsidian Daily Interviewer",
        },
        body: JSON.stringify({
          model: this.plugin.settings.model,
          messages: summaryMessages,
        }),
      });

      const data = response.json;
      const summary = data.choices[0].message.content;

      // Save full interview
      const interviewPath = await this.plugin.saveInterview(this.messages);

      // Append to daily note
      await this.plugin.appendToDailyNote(summary, interviewPath.replace(".md", ""));

      savingEl.remove();
      new Notice("Interview saved successfully!");

      // Reset for next interview
      this.interviewStarted = false;
      this.messages = [];
      this.showWelcome();
    } catch (error) {
      savingEl.remove();
      console.error("Error saving interview:", error);
      new Notice("Error saving interview. Please try again.");
    }
  }

  async onClose() {
    // Nothing to clean up
  }
}

class ObsidianDailyInterviewerSettingTab extends PluginSettingTab {
  plugin: ObsidianDailyInterviewerPlugin;

  constructor(app: App, plugin: ObsidianDailyInterviewerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Daily Interviewer Settings" });

    // API Settings
    containerEl.createEl("h3", { text: "OpenRouter Configuration" });

    new Setting(containerEl)
      .setName("OpenRouter API Key")
      .setDesc("Your OpenRouter API key for AI conversations")
      .addText((text) =>
        text
          .setPlaceholder("sk-or-...")
          .setValue(this.plugin.settings.openRouterApiKey)
          .onChange(async (value) => {
            this.plugin.settings.openRouterApiKey = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Select the AI model to use for interviews")
      .addDropdown((dropdown) => {
        POPULAR_MODELS.forEach((model) => {
          dropdown.addOption(model, model);
        });
        dropdown.setValue(this.plugin.settings.model);
        dropdown.onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        });
      });

    // Note Reading Settings
    containerEl.createEl("h3", { text: "Note Sources" });

    new Setting(containerEl)
      .setName("Read Monthly Note")
      .setDesc("Include your monthly note as context for the interview")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.readMonthlyNote)
          .onChange(async (value) => {
            this.plugin.settings.readMonthlyNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Monthly Note Folder")
      .setDesc("Folder where monthly notes are stored (leave empty for vault root)")
      .addText((text) =>
        text
          .setPlaceholder("Monthly")
          .setValue(this.plugin.settings.monthlyNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.monthlyNoteFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Monthly Note Format")
      .setDesc("Date format for monthly notes (Moment.js format)")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM")
          .setValue(this.plugin.settings.monthlyNoteFormat)
          .onChange(async (value) => {
            this.plugin.settings.monthlyNoteFormat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Read Weekly Note")
      .setDesc("Include your weekly note as context for the interview")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.readWeeklyNote)
          .onChange(async (value) => {
            this.plugin.settings.readWeeklyNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Weekly Note Folder")
      .setDesc("Folder where weekly notes are stored (leave empty for vault root)")
      .addText((text) =>
        text
          .setPlaceholder("Weekly")
          .setValue(this.plugin.settings.weeklyNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.weeklyNoteFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Weekly Note Format")
      .setDesc("Date format for weekly notes (Moment.js format)")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-[W]WW")
          .setValue(this.plugin.settings.weeklyNoteFormat)
          .onChange(async (value) => {
            this.plugin.settings.weeklyNoteFormat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Read Daily Note")
      .setDesc("Include your daily note as context for the interview")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.readDailyNote)
          .onChange(async (value) => {
            this.plugin.settings.readDailyNote = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Daily Note Folder")
      .setDesc("Folder where daily notes are stored (leave empty for vault root)")
      .addText((text) =>
        text
          .setPlaceholder("Daily")
          .setValue(this.plugin.settings.dailyNoteFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Daily Note Format")
      .setDesc("Date format for daily notes (Moment.js format)")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.dailyNoteFormat)
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteFormat = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Previous Daily Notes")
      .setDesc("Number of previous daily notes to include as context (0 to disable)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 14, 1)
          .setValue(this.plugin.settings.previousDailyNotesCount)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.previousDailyNotesCount = value;
            await this.plugin.saveSettings();
          })
      );

    // Interview Settings
    containerEl.createEl("h3", { text: "Interview Settings" });

    new Setting(containerEl)
      .setName("Interview Save Folder")
      .setDesc("Folder where interview transcripts will be saved")
      .addText((text) =>
        text
          .setPlaceholder("Interviews")
          .setValue(this.plugin.settings.interviewFolder)
          .onChange(async (value) => {
            this.plugin.settings.interviewFolder = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Custom Prompt")
      .setDesc("Additional instructions for the interviewer (optional)")
      .addTextArea((text) =>
        text
          .setPlaceholder("E.g., Focus on work-life balance, ask about creative projects, etc.")
          .setValue(this.plugin.settings.customPrompt)
          .onChange(async (value) => {
            this.plugin.settings.customPrompt = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
