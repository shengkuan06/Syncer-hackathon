export interface Task {
  title: string;
  description: string;
  deadline: string;
  status: string;
}

export interface ExtractedData {
  tasks: Task[];
  roadmap: string;
  gapAnalysis: string;
  category: "Assignment" | "Tutorial" | "Other";
  sourceSummary?: string;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

export interface NotionTokens {
  access_token: string;
  bot_id: string;
  duplicated_template_id: string | null;
  owner: any;
  workspace_icon: string | null;
  workspace_id: string;
  workspace_name: string;
}

export interface ChatMessage {
  id: string;
  author: string;
  content: string;
  timestamp: string;
  platform: "Discord" | "Telegram";
  attachments?: { mimeType: string; data: string }[];
  isVoice?: boolean;
}

export interface ProjectMoment {
  type: "Decision" | "Assignment" | "Deadline" | "Blocker";
  summary: string;
  assignee?: string;
  deadline?: string;
  confidence: number;
  originalMessages: string[];
  suggestedTask?: Task;
  isCommitment: boolean;
  priority: "High" | "Medium" | "Low";
}
