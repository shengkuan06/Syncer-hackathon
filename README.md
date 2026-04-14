# Syncer: The AI-Powered Task Orchestration Engine

## 🚀 The Problem
In the modern academic and professional landscape, tasks are rarely centralized. They are scattered across:
- **University Portals**: Deadlines buried in learning management systems like UMSpectrum (Moodle).
- **Chat Platforms**: Action items discussed in fast-moving Telegram or Discord groups.
- **Multimodal Noise**: Important instructions delivered via voice notes or whiteboard photos.
- **Manual Overhead**: The friction of manually copying these tasks into a "Source of Truth" often leads to missed deadlines and fragmented workflows.

## 🛠️ The Solution: Syncer
Syncer is an intelligent bridge that transforms unstructured communication into actionable productivity. It acts as a centralized "Intelligence Engine" that monitors your academic and professional streams to ensure no commitment is ever forgotten.

### Key Features
- **Multimodal Task Extraction**: Drop a syllabus (PDF), a lecture recording (Audio), or a dashboard screenshot (Image). Syncer uses Gemini 1.5 Flash to extract tasks, deadlines, and roadmaps.
- **Live Chat Intelligence**: Autonomous webhooks monitor your Discord and Telegram streams. It detects "Project Moments" (Decisions, Assignments, Blockers) in real-time, even in mixed-language (English/Malay/Chinese) environments.
- **UMSpectrum Direct Connect**: Sync your university dashboard directly using your private iCal feed. No more manual checking for upcoming quizzes or assignments.
- **One-Click Ecosystem Sync**: Seamlessly push detected tasks to **Notion** databases or **Google Tasks/Calendar** with a single click.
- **Linguistic Fluency**: Specialized support for "Manglish" and code-switching, ensuring voice notes in local dialects are accurately understood.
- **Intelligent Deadline Scheduling**: Automatically breaks down complex assignments into sub-tasks with a 5-day incremental schedule (Task 1: +5 days, Task 2: +10 days, etc.), perfectly aligning the final task with the actual assignment deadline.

## 💻 Tech Stack
- **Frontend**: React 18, Tailwind CSS, Framer Motion, Lucide React.
- **Backend**: Node.js (Express), Vite Middleware.
- **AI Engine**: Google Gemini 1.5 Flash & Pro (Multimodal & Multilingual).
- **Integrations**: Notion API, Google Tasks/Calendar API, Telegram (MTProto), Discord Webhooks.

## ⚙️ Setup & Environment Variables
To run Syncer, you need to configure the following secrets:

```env
# AI Engine
GEMINI_API_KEY=your_gemini_api_key

# Google Integration (OAuth)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Notion Integration (OAuth)
NOTION_CLIENT_ID=your_notion_client_id
NOTION_CLIENT_SECRET=your_notion_client_secret

# Telegram Integration (MTProto)
TELEGRAM_API_ID=your_telegram_api_id
TELEGRAM_API_HASH=your_telegram_api_hash
TELEGRAM_BOT_TOKEN=your_telegram_bot_token

# External Notifications
DISCORD_WEBHOOK_URL=your_discord_webhook_url

# App Configuration
APP_URL=your_deployed_app_url
```

## 📖 How to Use
1. **Ingest**: Upload a file or paste text in the "Manual Ingestion" tab.
2. **Connect**: Link your Notion or Google account via the header buttons.
3. **Sync**: Review the AI-extracted tasks and click the "Sync" icon to push them to your chosen platform.
4. **Live Stream**: Switch to the "Live Chat" tab to see tasks being detected from your connected Telegram/Discord groups in real-time.
5. **UMSpectrum**: Use the "UMSpectrum Direct Sync" button to link your university calendar for automated deadline tracking.
