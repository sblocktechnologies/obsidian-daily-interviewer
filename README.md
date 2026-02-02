# Obsidian Daily Interviewer

An AI-powered daily reflection plugin that reads your periodic notes and conducts personalized end-of-day interviews to help you process your experiences, celebrate wins, and identify insights.

## Features

- **Context-Aware Conversations** - Reads your daily, weekly, and monthly notes to personalize each interview
- **Sidebar Integration** - Lives in the right sidebar so you can reference notes while chatting
- **AI-Powered Reflection** - Uses OpenRouter to access top AI models (Claude, GPT, Gemini, and more)
- **Automatic Summaries** - Generates a brief reflection summary and appends it to your daily note
- **Full Transcripts** - Saves complete interview transcripts as linked notes in your vault
- **Flexible Configuration** - Customizable note paths, date formats, and AI model selection

## Installation

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/sblocktechnologies/obsidian-daily-interviewer/releases)
2. Create a folder called `obsidian-daily-interviewer` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the new folder
4. Restart Obsidian and enable the plugin in **Settings** → **Community plugins**

### From Source

```bash
git clone https://github.com/sblocktechnologies/obsidian-daily-interviewer.git
cd obsidian-interviewer
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-daily-interviewer/` folder.

## Setup

### 1. Get an OpenRouter API Key

1. Create an account at [OpenRouter](https://openrouter.ai)
2. Generate an API key from your dashboard
3. Add credits to your account (pay-as-you-go pricing)

### 2. Configure the Plugin

Open **Settings** → **Obsidian Daily Interviewer** and configure:

| Setting | Description |
|---------|-------------|
| **OpenRouter API Key** | Your API key from OpenRouter |
| **Model** | AI model to use (Claude Opus 4.5 recommended) |
| **Daily/Weekly/Monthly Note Folder** | Where your periodic notes are stored |
| **Daily/Weekly/Monthly Note Format** | Date format matching your note filenames (Moment.js) |
| **Interview Save Folder** | Where to save interview transcripts |
| **Custom Prompt** | Optional guidance to focus the interviewer |

### Common Date Formats

| Format | Example |
|--------|---------|
| `YYYY-MM-DD` | 2026-02-01 |
| `YYYY-MM` | 2026-02 |
| `YYYY-[W]WW` | 2026-W05 |
| `YYYY-[W]W` | 2026-W5 |
| `YYYY-M` | 2026-2 |

## Usage

### Starting an Interview

**Option 1:** Click the chat bubble icon in the left ribbon

**Option 2:** Open Command Palette (`Cmd/Ctrl + P`) and run "Obsidian Daily Interviewer: Start Daily Interview"

### During the Interview

1. Click **New Interview** to begin
2. The AI will recap what it noticed from your notes and ask an opening question
3. Type your responses and press Enter (or click Send)
4. The interview covers how you're feeling, wins, challenges, learnings, and what's ahead
5. After 5-7 exchanges, the AI will naturally wrap up

### Ending the Interview

Click **End & Save** to:
- Generate a summary of the conversation
- Save the full transcript to your Interviews folder
- Append the summary to your daily note with a link to the full interview

## Supported Models

The plugin includes popular models from major providers:

**Frontier Models**
- `anthropic/claude-opus-4.5` - Best overall quality (default)
- `anthropic/claude-sonnet-4.5` - Fast and capable
- `openai/gpt-5.1` - OpenAI's latest
- `openai/gpt-4o` - Great balance of speed/quality
- `google/gemini-2.5-pro-preview` - Google's flagship
- `google/gemini-2.5-flash` - Fast and affordable
- `x-ai/grok-4` - xAI's latest

**Value Models**
- `deepseek/deepseek-chat` - Excellent value
- `meta-llama/llama-3.3-70b-instruct` - Open source
- `qwen/qwen-2.5-72b-instruct` - Strong multilingual
- `mistralai/mistral-large-2` - European alternative

## Custom Prompts

Use the Custom Prompt setting to personalize your interviews:

```
Focus on work-life balance and creative projects.
Ask about my meditation practice.
Be direct and skip small talk.
```

## How It Works

1. **Context Gathering** - When you start an interview, the plugin reads your current daily, weekly, and monthly notes (based on your configured paths and date formats)

2. **AI Conversation** - The context is sent to the AI along with instructions to conduct a reflective interview. The AI references specific items from your notes.

3. **Saving Results** - When you end the interview:
   - A summary is generated
   - The full transcript is saved as a new note
   - Your daily note is updated with the summary and a link

## Privacy & Data

- Your notes are sent to OpenRouter's API for processing
- OpenRouter routes requests to your chosen model provider
- No data is stored by this plugin beyond your vault
- Review [OpenRouter's privacy policy](https://openrouter.ai/privacy) for details on data handling

## Troubleshooting

### "Please set your OpenRouter API key"
Add your API key in **Settings** → **Obsidian Daily Interviewer**

### Notes not being read
- Check that your folder paths match exactly (case-sensitive)
- Verify your date format matches your filenames
- Leave folder empty if notes are in vault root

### API errors
- Verify your OpenRouter account has credits
- Check that your API key is correct
- Try a different model (some may be temporarily unavailable)

## Development

```bash
# Install dependencies
npm install

# Build for development (with source maps)
npm run dev

# Build for production
npm run build

# Install to vault (edit install.sh with your vault path)
./install.sh
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

If you find this plugin useful, consider:
- Starring the repository on GitHub
- Reporting bugs or suggesting features via [Issues](https://github.com/sblocktechnologies/obsidian-daily-interviewer/issues)

## License

MIT License - see [LICENSE](LICENSE) for details

## Credits

Built with the [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api) and [OpenRouter](https://openrouter.ai).
