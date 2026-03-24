import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  moment,
  normalizePath,
  WorkspaceLeaf,
  requestUrl,
} from "obsidian";

const VIEW_TYPE_INTERVIEW = "obsidian-daily-interview-view";
const MAX_LINKED_NOTE_CANDIDATES = 50;

type ContextNoteType = "monthly" | "weekly" | "daily" | "linked";

interface ObsidianDailyInterviewerSettings {
  openRouterApiKey: string;
  model: string;
  readMonthlyNote: boolean;
  readWeeklyNote: boolean;
  readDailyNote: boolean;
  previousDailyNotesCount: number;
  expandLinkedContext: boolean;
  maxLinkedNotesToLoad: number;
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
  expandLinkedContext: true,
  maxLinkedNotesToLoad: 3,
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

interface NoteContextSectionOptions {
  heading: string;
  noteType: ContextNoteType;
  filePath: string;
  content: string;
  periodIdentifier?: string;
  displayLabel?: string;
  relativeTiming?: string;
  dateInterpretation?: string;
  periodRange?: string;
  additionalMetadataLines?: string[];
}

interface LoadedContextNote {
  file: TFile;
  section: NoteContextSectionOptions;
}

interface LinkedNoteCandidate {
  file: TFile;
  path: string;
  sourcePaths: string[];
}

interface LinkedNoteRequest {
  path: string;
  reason: string;
}

interface LinkedNoteLoadResult {
  path: string;
  reason: string;
}

interface PreparedInterviewContext {
  context: string;
  linkedNotesLoaded: LinkedNoteLoadResult[];
}

export default class ObsidianDailyInterviewerPlugin extends Plugin {
  settings: ObsidianDailyInterviewerSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_INTERVIEW,
      (leaf) => new InterviewView(leaf, this)
    );

    this.addRibbonIcon("message-circle", "Daily Interview", () => {
      this.activateView();
    });

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
      leaf = leaves[0];
    } else {
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

  async prepareInterviewContext(
    onStatus?: (status: string) => void
  ): Promise<PreparedInterviewContext> {
    onStatus?.("Reading your notes...");
    const primaryNotes = await this.gatherPrimaryContextNotes();
    const primarySections = primaryNotes.map((note) => note.section);
    const allSections = [...primarySections];
    let linkedNotesLoaded: LinkedNoteLoadResult[] = [];

    if (
      primarySections.length > 0 &&
      this.settings.expandLinkedContext &&
      this.settings.maxLinkedNotesToLoad > 0
    ) {
      try {
        onStatus?.("Reviewing linked notes for more context...");
        const linkedCandidates = this.collectLinkedNoteCandidates(primaryNotes);

        if (linkedCandidates.length > 0) {
          const primaryContext = this.formatContextSections(primarySections);
          const linkedRequests = await this.selectLinkedNotesForAdditionalContext(
            primaryContext,
            linkedCandidates
          );

          if (linkedRequests.length > 0) {
            onStatus?.("Loading linked notes...");
            const linkedSections = await this.loadLinkedContextSections(
              linkedCandidates,
              linkedRequests
            );

            allSections.push(...linkedSections.sections);
            linkedNotesLoaded = linkedSections.loaded;
          }
        }
      } catch (error) {
        console.warn("Failed to expand interview context with linked notes:", error);
      }
    }

    return {
      context: this.formatContextSections(allSections),
      linkedNotesLoaded,
    };
  }

  async gatherPrimaryContextNotes(): Promise<LoadedContextNote[]> {
    const notes: LoadedContextNote[] = [];
    const now = moment();

    if (this.settings.readMonthlyNote) {
      const monthId = now.format(this.settings.monthlyNoteFormat);
      const monthDisplay = now.format("MMMM YYYY");
      const monthStart = now.clone().startOf("month");
      const monthEnd = now.clone().endOf("month");
      const monthlyNote = await this.getNoteFileAndContent(
        this.settings.monthlyNoteFolder,
        monthId
      );

      if (monthlyNote) {
        notes.push({
          file: monthlyNote.file,
          section: {
            heading: `Current Monthly Note — ${monthDisplay} (${monthId})`,
            noteType: "monthly",
            periodIdentifier: monthId,
            displayLabel: monthDisplay,
            relativeTiming: "current month",
            periodRange: `${monthStart.format("dddd, MMMM D, YYYY")} to ${monthEnd.format("dddd, MMMM D, YYYY")}`,
            filePath: monthlyNote.file.path,
            dateInterpretation: `Relative time references in this note should be interpreted within ${monthDisplay}.`,
            content: monthlyNote.content,
          },
        });
      }
    }

    if (this.settings.readWeeklyNote) {
      const weekId = now.format(this.settings.weeklyNoteFormat);
      const weekStart = now.clone().startOf("isoWeek");
      const weekEnd = now.clone().endOf("isoWeek");
      const weekDisplay = `${weekStart.format("dddd, MMMM D, YYYY")} to ${weekEnd.format("dddd, MMMM D, YYYY")}`;
      const weeklyNote = await this.getNoteFileAndContent(
        this.settings.weeklyNoteFolder,
        weekId
      );

      if (weeklyNote) {
        notes.push({
          file: weeklyNote.file,
          section: {
            heading: `Current Weekly Note — ${weekId}`,
            noteType: "weekly",
            periodIdentifier: weekId,
            displayLabel: weekDisplay,
            relativeTiming: "current week",
            periodRange: weekDisplay,
            filePath: weeklyNote.file.path,
            dateInterpretation:
              "Relative time references in this note should be interpreted within the covered week above.",
            content: weeklyNote.content,
          },
        });
      }
    }

    if (this.settings.readDailyNote) {
      const dayId = now.format(this.settings.dailyNoteFormat);
      const dayDisplay = now.format("dddd, MMMM D, YYYY");
      const dailyNote = await this.getNoteFileAndContent(
        this.settings.dailyNoteFolder,
        dayId
      );

      if (dailyNote) {
        notes.push({
          file: dailyNote.file,
          section: {
            heading: `Current Daily Note — ${dayDisplay} (${dayId})`,
            noteType: "daily",
            periodIdentifier: dayId,
            displayLabel: dayDisplay,
            relativeTiming: "today",
            filePath: dailyNote.file.path,
            dateInterpretation: `Relative words inside this note such as "today", "yesterday", and "tomorrow" are written from the perspective of ${dayDisplay}.`,
            content: dailyNote.content,
          },
        });
      }
    }

    if (this.settings.previousDailyNotesCount > 0) {
      for (let i = 1; i <= this.settings.previousDailyNotesCount; i++) {
        const pastDate = moment().subtract(i, "days");
        const pastId = pastDate.format(this.settings.dailyNoteFormat);
        const pastDisplay = pastDate.format("dddd, MMMM D, YYYY");
        const previousDailyNote = await this.getNoteFileAndContent(
          this.settings.dailyNoteFolder,
          pastId
        );

        if (previousDailyNote) {
          notes.push({
            file: previousDailyNote.file,
            section: {
              heading: `Previous Daily Note — ${pastDisplay} (${pastId})`,
              noteType: "daily",
              periodIdentifier: pastId,
              displayLabel: pastDisplay,
              relativeTiming: i === 1 ? "1 day ago" : `${i} days ago`,
              filePath: previousDailyNote.file.path,
              dateInterpretation: `Relative words inside this note such as "today", "yesterday", and "tomorrow" are written from the perspective of ${pastDisplay}.`,
              content: previousDailyNote.content,
            },
          });
        }
      }
    }

    return notes;
  }

  collectLinkedNoteCandidates(primaryNotes: LoadedContextNote[]): LinkedNoteCandidate[] {
    const primaryPaths = new Set(primaryNotes.map((note) => note.file.path));
    const candidates = new Map<string, LinkedNoteCandidate>();

    for (const note of primaryNotes) {
      const linkTargets = this.extractInternalLinkTargets(note.section.content);

      for (const linkTarget of linkTargets) {
        const linkedFile = this.resolveLinkedNoteFile(linkTarget, note.file);

        if (!linkedFile || primaryPaths.has(linkedFile.path)) {
          continue;
        }

        const existing = candidates.get(linkedFile.path);
        if (existing) {
          if (!existing.sourcePaths.includes(note.file.path)) {
            existing.sourcePaths.push(note.file.path);
          }
        } else {
          candidates.set(linkedFile.path, {
            file: linkedFile,
            path: linkedFile.path,
            sourcePaths: [note.file.path],
          });
        }
      }
    }

    return Array.from(candidates.values())
      .sort((a, b) => {
        if (b.sourcePaths.length !== a.sourcePaths.length) {
          return b.sourcePaths.length - a.sourcePaths.length;
        }
        return a.path.localeCompare(b.path);
      })
      .slice(0, MAX_LINKED_NOTE_CANDIDATES);
  }

  extractInternalLinkTargets(content: string): string[] {
    const targets: string[] = [];
    const seen = new Set<string>();

    const addTarget = (target: string) => {
      const cleanedTarget = target.trim();
      if (!cleanedTarget || seen.has(cleanedTarget)) {
        return;
      }

      seen.add(cleanedTarget);
      targets.push(cleanedTarget);
    };

    const wikiLinkRegex = /!?\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiLinkRegex.exec(content)) !== null) {
      const rawTarget = match[1].split("|")[0].split("#")[0].trim();
      if (rawTarget) {
        addTarget(rawTarget);
      }
    }

    const markdownLinkRegex = /!?\[[^\]]*\]\(([^)]+)\)/g;
    while ((match = markdownLinkRegex.exec(content)) !== null) {
      let rawTarget = match[1].trim();

      if (!rawTarget) {
        continue;
      }

      if (rawTarget.startsWith("<") && rawTarget.endsWith(">")) {
        rawTarget = rawTarget.slice(1, -1).trim();
      }

      if (!rawTarget || rawTarget.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(rawTarget)) {
        continue;
      }

      rawTarget = rawTarget.split("#")[0].trim();

      try {
        rawTarget = decodeURIComponent(rawTarget);
      } catch {
        // Ignore malformed URI sequences and use the raw target.
      }

      if (rawTarget) {
        addTarget(rawTarget);
      }
    }

    return targets;
  }

  resolveLinkedNoteFile(linkTarget: string, sourceFile: TFile): TFile | null {
    const normalizedLinkTarget = linkTarget.trim().replace(/^\/+/, "");
    const withoutExtension = normalizedLinkTarget.replace(/\.md$/i, "");

    let resolved = this.app.metadataCache.getFirstLinkpathDest(
      withoutExtension,
      sourceFile.path
    );

    if (!resolved) {
      resolved = this.app.metadataCache.getFirstLinkpathDest(
        normalizedLinkTarget,
        sourceFile.path
      );
    }

    if (!resolved && (normalizedLinkTarget.startsWith("./") || normalizedLinkTarget.startsWith("../"))) {
      const sourceDirectory = sourceFile.parent?.path ?? "";
      const relativePath = normalizePath(
        sourceDirectory ? `${sourceDirectory}/${normalizedLinkTarget}` : normalizedLinkTarget
      );
      const relativeFile = this.app.vault.getAbstractFileByPath(relativePath);
      if (relativeFile instanceof TFile) {
        resolved = relativeFile;
      }
    }

    if (resolved instanceof TFile && resolved.extension === "md") {
      return resolved;
    }

    return null;
  }

  async selectLinkedNotesForAdditionalContext(
    primaryContext: string,
    candidates: LinkedNoteCandidate[]
  ): Promise<LinkedNoteRequest[]> {
    if (!primaryContext.trim() || candidates.length === 0) {
      return [];
    }

    const candidateLines = candidates
      .map((candidate, index) => {
        const sources = candidate.sourcePaths.join(", ");
        return `${index + 1}. ${candidate.path} (linked from: ${sources})`;
      })
      .join("\n");

    const messages: Message[] = [
      {
        role: "system",
        content: `You are preparing context for an Obsidian daily reflection interview. Review the primary notes and decide whether any additional linked notes should be loaded before the interview begins.

Only request additional notes if they are likely to provide meaningful context for the interview. Avoid templates, dashboards, indexes, archives, or general reference notes unless the primary notes make them clearly relevant. Request at most ${this.settings.maxLinkedNotesToLoad} notes.

Return ONLY valid JSON in this exact shape:
{"requestAdditionalContext":false,"notes":[]}
OR
{"requestAdditionalContext":true,"notes":[{"path":"Exact/Path.md","reason":"Brief reason"}]}

Use exact paths from the available linked notes list.`,
      },
      {
        role: "user",
        content: `Primary note context:\n\n${primaryContext}\n\nAvailable linked notes (use exact paths only):\n${candidateLines}`,
      },
    ];

    const responseText = await this.requestChatCompletion(messages);
    return this.parseLinkedNoteSelectionResponse(responseText).slice(
      0,
      this.settings.maxLinkedNotesToLoad
    );
  }

  parseLinkedNoteSelectionResponse(responseText: string): LinkedNoteRequest[] {
    const parsed = this.extractJsonObject(responseText);

    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    const parsedObject = parsed as Record<string, unknown>;
    const notes = Array.isArray(parsedObject.notes) ? parsedObject.notes : [];
    const wantsAdditionalContext =
      parsedObject.requestAdditionalContext === true || notes.length > 0;

    if (!wantsAdditionalContext || notes.length === 0) {
      return [];
    }

    const requests: LinkedNoteRequest[] = [];

    for (const note of notes) {
      if (typeof note === "string") {
        const path = note.trim();
        if (path) {
          requests.push({
            path,
            reason: "Additional context requested by the AI.",
          });
        }
        continue;
      }

      if (!note || typeof note !== "object") {
        continue;
      }

      const maybePath = (note as Record<string, unknown>).path;
      if (typeof maybePath !== "string" || !maybePath.trim()) {
        continue;
      }

      const maybeReason = (note as Record<string, unknown>).reason;
      requests.push({
        path: maybePath.trim(),
        reason:
          typeof maybeReason === "string" && maybeReason.trim()
            ? maybeReason.trim()
            : "Additional context requested by the AI.",
      });
    }

    return requests;
  }

  extractJsonObject(text: string): unknown | null {
    const candidates = [text.trim()];
    const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);

    if (fencedMatch?.[1]) {
      candidates.push(fencedMatch[1].trim());
    }

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidates.push(text.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }

      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next extraction strategy.
      }
    }

    return null;
  }

  async loadLinkedContextSections(
    candidates: LinkedNoteCandidate[],
    requests: LinkedNoteRequest[]
  ): Promise<{ sections: NoteContextSectionOptions[]; loaded: LinkedNoteLoadResult[] }> {
    const sections: NoteContextSectionOptions[] = [];
    const loaded: LinkedNoteLoadResult[] = [];
    const seenPaths = new Set<string>();

    for (const request of requests) {
      const candidate = this.findCandidateForRequest(candidates, request.path);

      if (!candidate || seenPaths.has(candidate.path)) {
        continue;
      }

      const content = await this.app.vault.read(candidate.file);
      sections.push({
        heading: `Linked Note — ${candidate.file.basename}`,
        noteType: "linked",
        periodIdentifier: candidate.file.basename,
        displayLabel: candidate.file.basename,
        relativeTiming: "linked reference note",
        filePath: candidate.path,
        dateInterpretation:
          "Treat time references in this note relative to the note itself unless the note makes a date explicit.",
        additionalMetadataLines: [
          `- Linked from: ${candidate.sourcePaths.join(", ")}`,
          `- Reason requested: ${request.reason}`,
        ],
        content,
      });

      loaded.push({
        path: candidate.path,
        reason: request.reason,
      });
      seenPaths.add(candidate.path);

      if (loaded.length >= this.settings.maxLinkedNotesToLoad) {
        break;
      }
    }

    return { sections, loaded };
  }

  findCandidateForRequest(
    candidates: LinkedNoteCandidate[],
    requestedPath: string
  ): LinkedNoteCandidate | null {
    const normalizedRequest = this.normalizeNotePathInput(requestedPath);
    const normalizedRequestWithoutExtension = normalizedRequest.replace(/\.md$/i, "");

    for (const candidate of candidates) {
      const normalizedCandidatePath = this.normalizeNotePathInput(candidate.path);
      const normalizedCandidateWithoutExtension = normalizedCandidatePath.replace(/\.md$/i, "");

      if (
        normalizedCandidatePath === normalizedRequest ||
        normalizedCandidateWithoutExtension === normalizedRequestWithoutExtension
      ) {
        return candidate;
      }
    }

    const lowercaseRequest = normalizedRequest.toLowerCase();
    const lowercaseRequestWithoutExtension = normalizedRequestWithoutExtension.toLowerCase();

    for (const candidate of candidates) {
      const lowercaseCandidatePath = candidate.path.toLowerCase();
      const lowercaseCandidateWithoutExtension = lowercaseCandidatePath.replace(/\.md$/i, "");

      if (
        lowercaseCandidatePath === lowercaseRequest ||
        lowercaseCandidateWithoutExtension === lowercaseRequestWithoutExtension
      ) {
        return candidate;
      }
    }

    return null;
  }

  normalizeNotePathInput(path: string): string {
    let normalized = path.trim();

    normalized = normalized
      .replace(/^\[\[/, "")
      .replace(/\]\]$/, "")
      .replace(/^['"`]+/, "")
      .replace(/['"`]+$/, "")
      .replace(/^\/+/, "")
      .replace(/\\/g, "/")
      .trim();

    try {
      normalized = decodeURIComponent(normalized);
    } catch {
      // Ignore malformed URI sequences and use the original string.
    }

    if (!normalized) {
      return "";
    }

    return normalizePath(normalized);
  }

  formatContextSections(sections: NoteContextSectionOptions[]): string {
    return sections.map((section) => this.formatNoteContextSection(section)).join("\n\n---\n\n");
  }

  buildNotePath(folder: string, filename: string): string {
    return folder ? `${folder}/${filename}.md` : `${filename}.md`;
  }

  formatNoteContextSection(options: NoteContextSectionOptions): string {
    const metadataLines = [`- Note type: ${options.noteType}`, `- File path: ${options.filePath}`];

    if (options.periodIdentifier) {
      metadataLines.push(`- Period identifier: ${options.periodIdentifier}`);
    }

    if (options.displayLabel) {
      metadataLines.push(`- Display label: ${options.displayLabel}`);
    }

    if (options.relativeTiming) {
      metadataLines.push(`- Relative timing: ${options.relativeTiming}`);
    }

    if (options.periodRange) {
      metadataLines.push(`- Covered range: ${options.periodRange}`);
    }

    if (options.dateInterpretation) {
      metadataLines.push(`- Date interpretation: ${options.dateInterpretation}`);
    }

    if (options.additionalMetadataLines?.length) {
      metadataLines.push(...options.additionalMetadataLines);
    }

    return [
      `## ${options.heading}`,
      "",
      "### Metadata",
      ...metadataLines,
      "",
      "### Note Content",
      options.content.trim(),
    ].join("\n");
  }

  async getNoteFileAndContent(
    folder: string,
    filename: string
  ): Promise<{ file: TFile; content: string } | null> {
    const path = this.buildNotePath(folder, filename);
    const file = this.app.vault.getAbstractFileByPath(path);

    if (file instanceof TFile) {
      return {
        file,
        content: await this.app.vault.read(file),
      };
    }

    return null;
  }

  async requestChatCompletion(messages: Message[]): Promise<string> {
    const response = await requestUrl({
      url: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://obsidian.md",
        "X-Title": "Obsidian Daily Interviewer",
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages,
      }),
    });

    return response.json.choices[0].message.content;
  }

  async saveInterview(conversation: Message[]): Promise<string> {
    const now = moment();
    const timestamp = now.format("YYYY-MM-DD_HHmmss");
    const folderPath = this.settings.interviewFolder;
    const filename = `Interview_${timestamp}.md`;
    const fullPath = folderPath ? `${folderPath}/${filename}` : filename;

    if (folderPath) {
      const folderExists = this.app.vault.getAbstractFileByPath(folderPath);
      if (!folderExists) {
        await this.app.vault.createFolder(folderPath);
      }
    }

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
  isPreparingInterview: boolean = false;
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

    const header = container.createDiv({ cls: "interview-header" });
    header.createEl("h4", { text: "Daily Interview" });

    const startBtn = header.createEl("button", {
      text: "New Interview",
      cls: "interview-start-btn",
    });
    startBtn.onclick = () => this.startNewInterview();

    this.chatContainer = container.createDiv({ cls: "interview-chat-container" });

    const inputContainer = container.createDiv({ cls: "interview-input-container" });

    this.inputEl = inputContainer.createEl("textarea", {
      placeholder: "Type your response...",
    });

    const buttonRow = inputContainer.createDiv({ cls: "interview-button-row" });

    const sendBtn = buttonRow.createEl("button", {
      text: "Send",
      cls: "interview-send-btn",
    });
    sendBtn.onclick = () => this.sendMessage();

    const endBtn = buttonRow.createEl("button", {
      text: "End & Save",
      cls: "interview-end-btn",
    });
    endBtn.onclick = () => this.endInterview();

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.showWelcome();
  }

  showWelcome() {
    this.context = "";
    this.chatContainer.empty();
    const welcome = this.chatContainer.createDiv({ cls: "interview-welcome" });
    welcome.createEl("p", { text: "Click 'New Interview' to start your daily reflection." });
    welcome.createEl("p", {
      text: "The AI will read your daily, weekly, and monthly notes, and can optionally pull in linked notes when they seem helpful.",
      cls: "interview-welcome-sub",
    });
  }

  async startNewInterview() {
    if (!this.plugin.settings.openRouterApiKey) {
      new Notice("Please set your OpenRouter API key in settings.");
      return;
    }

    if (this.isPreparingInterview || this.isLoading) {
      return;
    }

    this.messages = [];
    this.context = "";
    this.interviewStarted = false;
    this.chatContainer.empty();
    this.isPreparingInterview = true;

    const loadingEl = this.chatContainer.createDiv({ cls: "loading-message" });
    loadingEl.textContent = "Reading your notes...";
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

    try {
      const preparedContext = await this.plugin.prepareInterviewContext((status) => {
        loadingEl.textContent = status;
      });

      this.context = preparedContext.context;
      loadingEl.remove();

      if (preparedContext.linkedNotesLoaded.length > 0) {
        const noteList = preparedContext.linkedNotesLoaded
          .map((note) => `• ${note.path}`)
          .join("\n");
        this.addInfoMessageToChat(
          `Loaded additional context from linked notes:\n${noteList}`
        );
      }

      const systemPrompt = this.buildSystemPrompt();
      this.messages.push({ role: "system", content: systemPrompt });
      this.interviewStarted = true;

      await this.getAIResponse();
    } catch (error) {
      loadingEl.remove();
      console.error("Error preparing interview:", error);
      this.interviewStarted = false;
      this.messages = [];
      this.showWelcome();
      new Notice("Error preparing interview context. Please try again.");
    } finally {
      this.isPreparingInterview = false;
    }
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
      prompt += `\n\n---\n\nHere is context from their notes to inform your questions. This may include their primary daily, weekly, and monthly notes plus a small number of linked notes that were pulled in because they looked relevant:\n\n${this.context}`;
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
    if (!userInput || this.isLoading || this.isPreparingInterview) return;

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
      const assistantMessage = await this.plugin.requestChatCompletion(this.messages);

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
    const messageEl = this.chatContainer.createDiv({
      cls: `interview-message ${role}-message`,
    });

    const label = role === "user" ? "You" : "Interviewer";
    messageEl.createEl("strong", { text: label, cls: "message-label" });

    const contentEl = messageEl.createEl("div", { cls: "message-content" });
    contentEl.textContent = content;

    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }

  addInfoMessageToChat(content: string) {
    const infoEl = this.chatContainer.createDiv({ cls: "interview-info-message" });
    infoEl.textContent = content;
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
  }

  async endInterview() {
    if (this.messages.length < 2) {
      new Notice("No interview to save.");
      return;
    }

    if (this.isLoading || this.isPreparingInterview) {
      return;
    }

    const savingEl = this.chatContainer.createDiv({ cls: "loading-message" });
    savingEl.textContent = "Saving interview...";
    this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

    const summaryMessages: Message[] = [
      ...this.messages,
      {
        role: "user",
        content:
          "Please provide a brief 2-3 sentence summary of our conversation, highlighting the key themes and insights.",
      },
    ];

    try {
      const summary = await this.plugin.requestChatCompletion(summaryMessages);
      const interviewPath = await this.plugin.saveInterview(this.messages);

      await this.plugin.appendToDailyNote(summary, interviewPath.replace(".md", ""));

      savingEl.remove();
      new Notice("Interview saved successfully!");

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
    // Nothing to clean up.
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

    new Setting(containerEl)
      .setName("Expand Context with Linked Notes")
      .setDesc(
        "After reading your main notes, let the AI optionally request linked notes from them for more context. This adds one extra API call at interview start."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.expandLinkedContext)
          .onChange(async (value) => {
            this.plugin.settings.expandLinkedContext = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max Linked Notes to Load")
      .setDesc("Maximum number of linked notes the AI can pull in before the interview begins")
      .addSlider((slider) =>
        slider
          .setLimits(1, 8, 1)
          .setValue(this.plugin.settings.maxLinkedNotesToLoad)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxLinkedNotesToLoad = value;
            await this.plugin.saveSettings();
          })
      );

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
