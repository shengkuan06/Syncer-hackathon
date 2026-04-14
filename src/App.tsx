import React, { useState, useEffect, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { 
  Calendar as CalendarIcon, 
  CheckCircle2, 
  FileUp, 
  Link2, 
  Loader2, 
  Plus, 
  Send, 
  AlertCircle,
  CheckCircle,
  Database,
  CalendarDays,
  MessageSquare,
  Zap,
  ShieldAlert,
  Image as ImageIcon,
  Bell,
  Mic
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";
import { extractTasks } from "./services/geminiService";
import { analyzeChatStream } from "./services/chatIntelligenceService";
import { Task, GoogleTokens, NotionTokens, ExtractedData, ChatMessage, ProjectMoment } from "./types";
import axios from "axios";
import mammoth from "mammoth";

export default function App() {
  const [googleTokens, setGoogleTokens] = useState<GoogleTokens | null>(() => {
    const saved = localStorage.getItem("google_tokens");
    return saved ? JSON.parse(saved) : null;
  });
  const [notionTokens, setNotionTokens] = useState<NotionTokens | null>(() => {
    const saved = localStorage.getItem("notion_tokens");
    return saved ? JSON.parse(saved) : null;
  });
  const [files, setFiles] = useState<File[]>([]);
  const [additionalPrompt, setAdditionalPrompt] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [syncStatus, setSyncStatus] = useState<Record<string, "idle" | "syncing" | "success" | "error">>({});
  const [syncErrors, setSyncErrors] = useState<Record<string, { msg: string; tip: string }>>({});
  const [showNotionModal, setShowNotionModal] = useState(false);
  const [showConnectionGuide, setShowConnectionGuide] = useState(false);
  const [notionDatabaseId, setNotionDatabaseId] = useState(() => localStorage.getItem("notion_database_id") || "");
  const [tempDatabaseId, setTempDatabaseId] = useState("");
  const [umspectrumUrl, setUmspectrumUrl] = useState(() => localStorage.getItem("umspectrum_url") || "");
  const [tempUmspectrumUrl, setTempUmspectrumUrl] = useState("");
  const [showUmspectrumModal, setShowUmspectrumModal] = useState(false);
  const [isSyncingUmspectrum, setIsSyncingUmspectrum] = useState(false);

  const [telegramPhone, setTelegramPhone] = useState("");
  const [telegramCode, setTelegramCode] = useState("");
  const [telegramStep, setTelegramStep] = useState<"phone" | "code" | "success">("phone");
  const [telegramSession, setTelegramSession] = useState("");
  const [isTelegramLoading, setIsTelegramLoading] = useState(false);
  const [telegramError, setTelegramError] = useState("");

  const [activeTab, setActiveTab] = useState<"ingestion" | "chat">("ingestion");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: "1", author: "Sarah", content: "Okay, let's go with the blue theme for the landing page.", timestamp: new Date(Date.now() - 1000000).toISOString(), platform: "Discord" },
    { id: "2", author: "Mike", content: "Sounds good. Sarah will draft the proposal by tomorrow morning.", timestamp: new Date(Date.now() - 500000).toISOString(), platform: "Discord" },
    { id: "3", author: "Sarah", content: "I'm stuck on the database schema though, waiting on the API docs.", timestamp: new Date(Date.now() - 100000).toISOString(), platform: "Discord" }
  ]);
  const [detectedMoments, setDetectedMoments] = useState<ProjectMoment[]>([]);
  const [isAnalyzingChat, setIsAnalyzingChat] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [newChatMessage, setNewChatMessage] = useState("");
  const lastMessageIdRef = React.useRef<string | null>(null);
  const lastAnalysisTimeRef = React.useRef<number>(0);
  const isAnalyzingRef = React.useRef<boolean>(false);

  // Update localStorage when database ID changes
  useEffect(() => {
    localStorage.setItem("notion_database_id", notionDatabaseId);
  }, [notionDatabaseId]);

  useEffect(() => {
    localStorage.setItem("umspectrum_url", umspectrumUrl);
  }, [umspectrumUrl]);

  // Initial Analysis on Mount
  useEffect(() => {
    if (chatMessages.length > 0 && detectedMoments.length === 0) {
      handleAnalyzeChat();
    }
  }, []);

  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // OAuth Message Listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "GOOGLE_AUTH_SUCCESS") {
        setGoogleTokens(event.data.tokens);
        localStorage.setItem("google_tokens", JSON.stringify(event.data.tokens));
      }
      if (event.data?.type === "NOTION_AUTH_SUCCESS") {
        setNotionTokens(event.data.tokens);
        localStorage.setItem("notion_tokens", JSON.stringify(event.data.tokens));
        
        // If OAuth provides a database ID (e.g. from template duplication), use it
        if (event.data.tokens.duplicated_template_id) {
          setNotionDatabaseId(event.data.tokens.duplicated_template_id);
          setShowNotionModal(false);
        } else {
          // If no database ID, keep modal open so they can paste it
          alert("Login successful! Now please paste your Notion Database ID below.");
        }
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Update localStorage when tokens change
  useEffect(() => {
    if (googleTokens) {
      localStorage.setItem("google_tokens", JSON.stringify(googleTokens));
    } else {
      localStorage.removeItem("google_tokens");
    }
  }, [googleTokens]);

  useEffect(() => {
    if (notionTokens) {
      localStorage.setItem("notion_tokens", JSON.stringify(notionTokens));
    } else {
      localStorage.removeItem("notion_tokens");
    }
  }, [notionTokens]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(prev => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop,
    multiple: true
  } as any);

  const [isTestingConnection, setIsTestingConnection] = useState(false);

  const handleConnectGoogle = async () => {
    console.log("Google Tasks connect clicked");
    try {
      const res = await axios.get("/api/auth/google/url");
      if (!res.data.url || res.data.url.includes("undefined")) {
        console.error("Google OAuth URL is invalid:", res.data.url);
        return;
      }
      window.open(res.data.url, "google_auth", "width=600,height=700");
    } catch (e) {
      console.error("Failed to start Google OAuth:", e);
    }
  };

  const handleStartNotionOAuth = async () => {
    try {
      const res = await axios.get("/api/auth/notion/url");
      if (!res.data.url || res.data.url.includes("undefined")) {
        alert("Notion OAuth is not configured yet. Please add NOTION_CLIENT_ID and NOTION_CLIENT_SECRET to your AI Studio Secrets.");
        return;
      }
      window.open(res.data.url, "notion_auth", "width=600,height=700");
    } catch (e) {
      alert("Failed to start Notion OAuth. Please check your configuration.");
    }
  };

  const handleConnectNotion = () => {
    console.log("Notion connect clicked, tokens:", notionTokens);
    setTempDatabaseId(notionDatabaseId);
    setShowNotionModal(true);
  };

  const handleTelegramSendCode = async () => {
    setIsTelegramLoading(true);
    setTelegramError("");
    try {
      const res = await axios.post("/api/telegram/send-code", { phoneNumber: telegramPhone });
      if (res.data.success) {
        setTelegramStep("code");
      }
    } catch (err: any) {
      setTelegramError(err.response?.data?.error || "Failed to send code");
    } finally {
      setIsTelegramLoading(false);
    }
  };

  const handleTelegramSignIn = async () => {
    setIsTelegramLoading(true);
    setTelegramError("");
    try {
      const res = await axios.post("/api/telegram/sign-in", { code: telegramCode });
      if (res.data.success) {
        setTelegramSession(res.data.sessionString);
        setTelegramStep("success");
      }
    } catch (err: any) {
      setTelegramError(err.response?.data?.error || "Failed to sign in");
    } finally {
      setIsTelegramLoading(false);
    }
  };

  const handleDisconnectNotion = () => {
    setNotionTokens(null);
    setNotionDatabaseId("");
    setShowNotionModal(false);
  };

  const handleSaveNotionSecret = () => {
    const trimmedDbId = tempDatabaseId.trim();

    if (!trimmedDbId) {
      alert("Please provide a Notion Database ID.");
      return;
    }

    if (!notionTokens?.access_token) {
      alert("Please login with Notion first.");
      return;
    }

    setNotionDatabaseId(trimmedDbId);
    setShowNotionModal(false);
  };

  const handleSyncUmspectrum = async () => {
    if (!umspectrumUrl) {
      setTempUmspectrumUrl(umspectrumUrl);
      setShowUmspectrumModal(true);
      return;
    }

    setIsSyncingUmspectrum(true);
    try {
      const res = await axios.post("/api/umspectrum/sync", { calendarUrl: umspectrumUrl });
      if (res.data.tasks && res.data.tasks.length > 0) {
        setExtractedData({
          tasks: res.data.tasks,
          roadmap: "Directly synced from UMSpectrum Dashboard Timeline.",
          gapAnalysis: "No gaps detected. This is a direct sync of your university deadlines.",
          category: "Other",
          sourceSummary: "UMSpectrum Dashboard Sync"
        });
        alert(`Successfully synced ${res.data.tasks.length} upcoming tasks from UMSpectrum!`);
        setActiveTab("ingestion");
        setTimeout(() => {
          window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
        }, 500);
      } else {
        alert("No upcoming tasks found in your UMSpectrum calendar.");
      }
    } catch (error: any) {
      const msg = error.response?.data?.helpfulMessage || error.response?.data?.error || "Failed to sync UMSpectrum. Please check your Calendar URL.";
      alert(msg);
    } finally {
      setIsSyncingUmspectrum(false);
    }
  };

  const handleSaveUmspectrumUrl = () => {
    if (!tempUmspectrumUrl.trim()) {
      alert("Please provide a valid UMSpectrum Calendar URL.");
      return;
    }
    setUmspectrumUrl(tempUmspectrumUrl.trim());
    setShowUmspectrumModal(false);
    alert("UMSpectrum URL saved! You can now click 'Sync' to fetch your dashboard tasks.");
  };

  const handleTestNotionConnection = async () => {
    const trimmedDbId = tempDatabaseId.trim();
    const token = notionTokens?.access_token;

    if (!token) {
      alert("Please login with Notion first.");
      return;
    }
    if (!trimmedDbId) {
      alert("Please provide a Database ID to test.");
      return;
    }

    setIsTestingConnection(true);
    try {
      const res = await axios.post("/api/notion/test-connection", {
        token: token,
        databaseId: trimmedDbId
      });
      alert(`Success! Connected to: ${res.data.title}\n\nDon't forget to click "Connect & Save" to save these settings.`);
    } catch (error: any) {
      console.error("Test connection error:", error);
      const notionError = error.response?.data?.error;
      const msg = notionError?.message || error.message;
      const code = notionError?.code;

      let tip = "Make sure you've added the integration to your database in Notion (click '...' -> 'Add connections').";
      
      if (code === "object_not_found") {
        tip = "Database not found. Double check your Database ID. Ensure you are using a DATABASE ID, not a Page ID. In Notion, your database must be a 'Full Page' database or a 'Database' block, and the integration must be added directly to it.";
      } else if (code === "unauthorized") {
        tip = "Invalid Secret. Ensure you copied the 'Internal Integration Secret' correctly from the Notion Developer portal and that it belongs to the correct workspace.";
      } else if (code === "restricted_resource") {
        tip = "The integration doesn't have access to this database. Please re-check the 'Add connections' step in Notion.";
      }

      alert(`Connection Failed: ${msg}\n\nTip: ${tip}`);
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleExtract = async () => {
    console.log("Starting extraction with files:", files.map(f => f.name));
    setIsExtracting(true);
    try {
      let docxText = "";
      const otherFiles: File[] = [];

      // Separate DOCX files to extract text manually (Gemini doesn't support them directly)
      for (const file of files) {
        if (file.name.endsWith(".docx") || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          console.log("Parsing DOCX:", file.name);
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          docxText += `\n--- Content from ${file.name} ---\n${result.value}\n`;
        } else {
          otherFiles.push(file);
        }
      }

      const fileData = await Promise.all(
        otherFiles.map(async (file) => {
          const reader = new FileReader();
          return new Promise<{ mimeType: string; data: string }>((resolve) => {
            reader.onload = () => {
              const base64 = (reader.result as string).split(",")[1];
              resolve({ mimeType: file.type, data: base64 });
            };
            reader.readAsDataURL(file);
          });
        })
      );

      console.log("Calling Gemini with docxText length:", docxText.length, "and other files:", otherFiles.length);
      
      let result;
      let retries = 0;
      const maxRetries = 4;
      
      while (retries <= maxRetries) {
        try {
          result = await extractTasks(docxText, additionalPrompt, fileData);
          break;
        } catch (e: any) {
          const isQuotaError = e.message?.includes("429") || e.message?.includes("RESOURCE_EXHAUSTED");
          if (isQuotaError && retries < maxRetries) {
            retries++;
            const delay = Math.pow(2, retries) * 7500; // 15s, 30s, 60s, 120s
            console.warn(`Gemini quota exceeded. Retrying in ${delay}ms... (Attempt ${retries}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw e;
        }
      }

      if (!result) throw new Error("Failed to get result from AI engine.");

      console.log("Extraction result:", result);
      setExtractedData(result);
      
      // Scroll to results
      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
      }, 500);
    } catch (error: any) {
      console.error("Extraction error:", error);
      const isQuotaError = error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED");
      if (isQuotaError) {
        alert("The AI engine is currently busy (Rate Limit Exceeded). Please wait a minute and try again.");
      } else {
        alert("Failed to extract tasks. Please check the console for details.");
      }
    } finally {
      setIsExtracting(false);
    }
  };

  const syncToNotion = async (task: Task, index: number): Promise<boolean> => {
    console.log(`Syncing task ${index} to Notion:`, task.title);
    if (!notionTokens) {
      alert("Please connect to Notion first.");
      return false;
    }
    
    const key = `notion-${index}`;
    if (syncStatus[key] === "syncing") return false;

    setSyncStatus(prev => ({ ...prev, [key]: "syncing" }));
    try {
      const databaseId = notionDatabaseId;
      if (!databaseId) {
        alert("Notion Database ID is missing. Please reconnect to Notion.");
        setShowNotionModal(true);
        setSyncStatus(prev => ({ ...prev, [key]: "idle" }));
        return false;
      }

      console.log("Sending request to /api/notion/create-task with DB ID:", databaseId);
      // Validate deadline
      const deadlineDate = new Date(task.deadline);
      if (isNaN(deadlineDate.getTime())) {
        throw new Error(`Invalid deadline date: ${task.deadline}`);
      }

      const response = await axios.post("/api/notion/create-task", {
        token: notionTokens.access_token,
        databaseId,
        task: {
          ...task,
          deadline: deadlineDate.toISOString()
        },
        category: extractedData?.category,
        sourceSummary: extractedData?.sourceSummary
      });
      console.log("Notion sync success:", response.data);
      setSyncStatus(prev => ({ ...prev, [key]: "success" }));
      return true;
    } catch (error: any) {
      console.error("Notion sync error:", error);
      setSyncStatus(prev => ({ ...prev, [key]: "error" }));
      
      const notionError = error.response?.data?.error;
      const msg = notionError?.message || error.message;
      const code = notionError?.code;

      let tip = "Check your Notion connection and database setup.";
      if (code === "object_not_found") {
        tip = "Database not found. Ensure the Database ID is correct and the integration is added to your Notion database (via the '...' menu -> Add Connections).";
      } else if (code === "unauthorized") {
        tip = "Connection expired. Please click the Notion button in the header to reconnect.";
      } else if (code === "validation_error") {
        tip = "Property mismatch. Ensure your Notion database has properties named 'Name' (Title), 'Description' (Text), 'Deadline' (Date), and 'Status' (Status or Select).";
        if (msg.includes("Status")) {
          tip = "The 'Status' property in your Notion database might be missing the expected options (To Do, In Progress, Done). I've tried to auto-map it, but please check your database settings.";
        }
      }

      setSyncErrors(prev => ({ ...prev, [key]: { msg, tip } }));
      alert(`Notion Sync Failed\n\nError: ${msg}\n\nTip: ${tip}`);
      return false;
    }
  };

  const syncAllToNotion = async () => {
    if (!extractedData) return;
    
    if (!notionTokens?.access_token) {
      alert("Please connect to Notion first.");
      setShowNotionModal(true);
      return;
    }
    
    const databaseId = notionDatabaseId;
    if (!databaseId) {
      alert("Notion Database ID is missing. Please reconnect to Notion.");
      setShowNotionModal(true);
      return;
    }

    setIsSyncingAll(true);
    let successCount = 0;
    try {
      for (let i = 0; i < extractedData.tasks.length; i++) {
        // Skip already synced tasks
        if (syncStatus[`notion-${i}`] === "success") continue;
        const success = await syncToNotion(extractedData.tasks[i], i);
        if (success) successCount++;
      }
      
      if (successCount > 0) {
        alert(`Successfully synced ${successCount} tasks to Notion!`);
      }
    } finally {
      setIsSyncingAll(false);
    }
  };

  const syncToGoogle = async (task: Task, index: number, type: "task" | "event" = "task") => {
    const serviceName = type === "task" ? "Google Tasks" : "Google Calendar";
    console.log(`Syncing task ${index} to ${serviceName}:`, task.title);
    
    if (!googleTokens) {
      alert(`Please connect to ${serviceName} first.`);
      return;
    }
    
    const key = `${type}-${index}`;
    if (syncStatus[key] === "syncing") return;

    setSyncStatus(prev => ({ ...prev, [key]: "syncing" }));
    try {
      const deadlineDate = new Date(task.deadline);
      const endpoint = type === "task" ? "/api/google/create-task" : "/api/google/create-event";

      const response = await axios.post(endpoint, {
        tokens: googleTokens,
        task: {
          title: task.title,
          description: task.description,
          deadline: isNaN(deadlineDate.getTime()) ? new Date().toISOString() : deadlineDate.toISOString()
        }
      });
      alert(`${serviceName} Sync Success!\n\nYour task has been sent to the ${type === 'task' ? 'Tasks sidebar' : 'Calendar'}. You may need to refresh your Google Calendar page to see it.`);
      setSyncStatus(prev => ({ ...prev, [key]: "success" }));
    } catch (error: any) {
      console.error(`${serviceName} sync error:`, error);
      setSyncStatus(prev => ({ ...prev, [key]: "error" }));
      
      const serverData = error.response?.data;
      const helpfulMessage = serverData?.helpfulMessage;
      let msg = helpfulMessage || serverData?.message || error.message;
      
      if (typeof msg !== 'string') {
        msg = JSON.stringify(msg);
      }

      let tip = `Check your ${serviceName} connection and permissions.`;
      if (helpfulMessage) {
        tip = helpfulMessage;
      } else if (msg.toLowerCase().includes("scope") || msg.toLowerCase().includes("permission")) {
        tip = `Missing permissions. Please click the 'Google Tasks' button in the header to reconnect and grant '${type === 'task' ? 'Tasks' : 'Calendar'}' access.`;
      }

      setSyncErrors(prev => ({ ...prev, [key]: { msg, tip } }));
      alert(`${serviceName} Sync Failed\n\nError: ${msg}\n\nTip: ${tip}`);
    }
  };

  const handleAnalyzeChat = async (msgsOverride?: ChatMessage[]) => {
    let msgsToAnalyze = msgsOverride || chatMessages;
    if (msgsToAnalyze.length === 0) return;
    
    // Limit to last 15 messages to save tokens and avoid TPM limits
    if (msgsToAnalyze.length > 15) {
      msgsToAnalyze = msgsToAnalyze.slice(-15);
    }
    
    // Rate limit protection: Don't analyze more than once every 30 seconds unless manually triggered (no msgsOverride)
    const now = Date.now();
    if (msgsOverride && now - lastAnalysisTimeRef.current < 30000) {
      console.log("Skipping analysis due to rate limit protection (too soon)");
      return;
    }
    
    if (isAnalyzingRef.current) {
      console.log("Skipping analysis: already in progress");
      return;
    }

    console.log("Triggering chat analysis for", msgsToAnalyze.length, "messages");
    setIsAnalyzingChat(true);
    isAnalyzingRef.current = true;
    lastAnalysisTimeRef.current = now;

    try {
      let moments;
      let retries = 0;
      const maxRetries = 4;
      
      while (retries <= maxRetries) {
        try {
          moments = await analyzeChatStream(msgsToAnalyze);
          break;
        } catch (e: any) {
          const errorStr = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
          const isQuotaError = errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED");
          
          if (isQuotaError && retries < maxRetries) {
            retries++;
            const delay = Math.pow(2, retries) * 7500; // 15s, 30s, 60s, 120s
            console.warn(`Gemini quota exceeded in chat analysis. Retrying in ${delay}ms... (Attempt ${retries}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw e;
        }
      }

      if (!moments) return;

      console.log("Analysis successful, found", moments.length, "moments");
      setDetectedMoments(moments);
      
      // Autonomous Execution Protocol
      for (let i = 0; i < moments.length; i++) {
        const moment = moments[i];
        if (moment.isCommitment && moment.confidence > 0.8 && moment.suggestedTask) {
          console.log("Autonomous commitment detected:", moment.summary);
          handleAutoSync(moment, i);
        }
      }
    } catch (e: any) {
      console.error("Analysis error:", e);
      const errorStr = typeof e === 'string' ? e : (e.message || JSON.stringify(e));
      if (errorStr.includes("GEMINI_API_KEY")) {
        alert("AI Analysis Error: Gemini API Key is missing. Please check your AI Studio secrets.");
      } else if (errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED")) {
        console.error("Quota still exceeded after retries.");
        setIsRateLimited(true);
        setTimeout(() => setIsRateLimited(false), 60000); // Reset after 1 minute
      }
    } finally {
      setIsAnalyzingChat(false);
      isAnalyzingRef.current = false;
    }
  };

  const handleAutoSync = async (moment: ProjectMoment, index: number) => {
    if (!moment.suggestedTask) return;
    
    // 1. Conflict Resolution (Google Calendar)
    if (googleTokens && moment.suggestedTask.deadline) {
      try {
        const deadline = new Date(moment.suggestedTask.deadline);
        const timeMin = new Date(deadline.getTime() - 30 * 60 * 1000).toISOString(); // 30 mins before
        const timeMax = new Date(deadline.getTime() + 30 * 60 * 1000).toISOString(); // 30 mins after
        
        const conflicts = await axios.post("/api/google/list-events", {
          tokens: googleTokens,
          timeMin,
          timeMax
        });
        
        if (conflicts.data.length > 0) {
          const conflictNames = conflicts.data.map((e: any) => e.summary).join(", ");
          await axios.post("/api/chat/send-notification", {
            platform: "Discord",
            channelId: "proj-sync-1",
            message: `⚠️ CONFLICT DETECTED: "${moment.suggestedTask.title}" deadline conflicts with existing events: ${conflictNames}. Please check your schedule!`
          });
          return; // Stop auto-sync if conflict
        }
      } catch (e) {
        console.error("Conflict check failed", e);
      }
    }

    // 2. Auto-Sync to Notion
    const success = await syncMomentToNotion(moment, index, true);
    if (success) {
      const source = moment.priority === "High" ? "Visual context" : "Chat commitment";
      await axios.post("/api/chat/send-notification", {
        platform: "Discord",
        channelId: "proj-sync-1",
        message: `✅ AUTONOMOUS SYNC: ${source} processed. "${moment.suggestedTask.title}" added to Notion`,
        owner: moment.assignee || "the team"
      });
    }
  };

  const sendChatNotification = async (moment: ProjectMoment, customMessage?: string) => {
    try {
      await axios.post("/api/chat/send-notification", {
        platform: "Discord",
        channelId: "proj-sync-1",
        message: customMessage || `Synced: ${moment.summary} added to Notion`,
        owner: moment.assignee || "the team"
      });
    } catch (e) {
      console.error("Failed to send notification");
    }
  };

  const syncMomentToNotion = async (moment: ProjectMoment, index: number, isAuto = false) => {
    if (!moment.suggestedTask) return false;
    
    const key = `moment-${index}`;
    if (syncStatus[key] === "syncing") return false;

    setSyncStatus(prev => ({ ...prev, [key]: "syncing" }));
    try {
      if (!notionTokens) {
        if (!isAuto) alert("Please connect to Notion first.");
        setSyncStatus(prev => ({ ...prev, [key]: "idle" }));
        return false;
      }

      await axios.post("/api/notion/create-task", {
        token: notionTokens.access_token,
        databaseId: notionDatabaseId,
        task: moment.suggestedTask,
        category: "Other",
        sourceSummary: `Detected from chat: ${moment.summary}\nPriority: ${moment.priority}\nCommitment: ${moment.isCommitment}`
      });
      
      setSyncStatus(prev => ({ ...prev, [key]: "success" }));
      if (!isAuto) {
        sendChatNotification(moment);
        alert("Synced moment to Notion!");
      }
      return true;
    } catch (error) {
      setSyncStatus(prev => ({ ...prev, [key]: "error" }));
      if (!isAuto) alert("Failed to sync moment to Notion.");
      return false;
    }
  };

  const handleAddChatMessage = () => {
    if (!newChatMessage.trim()) return;
    const msg: ChatMessage = {
      id: Date.now().toString(),
      author: "Me",
      content: newChatMessage,
      timestamp: new Date().toISOString(),
      platform: "Discord"
    };
    const newMessages = [...chatMessages, msg];
    setChatMessages(newMessages);
    setNewChatMessage("");
    
    // Trigger analysis for the new message
    handleAnalyzeChat(newMessages);
  };

  const handleVoiceSimulation = () => {
    const voiceMsg: ChatMessage = {
      id: Date.now().toString(),
      author: "Me",
      content: "🎤 [Voice Message: 'I'll finish the design by this Friday wei, don't worry lah.']",
      timestamp: new Date().toISOString(),
      platform: "Discord",
      isVoice: true
    };
    const newMessages = [...chatMessages, voiceMsg];
    setChatMessages(newMessages);
    alert("Simulated voice message sent to stream.");
    
    // Trigger analysis
    handleAnalyzeChat(newMessages);
  };

  const handleChatImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(",")[1];
      const msg: ChatMessage = {
        id: Date.now().toString(),
        author: "Me",
        content: "Shared an image",
        timestamp: new Date().toISOString(),
        platform: "Discord",
        attachments: [{ mimeType: file.type, data: base64 }]
      };
      const newMessages = [...chatMessages, msg];
      setChatMessages(newMessages);
      
      // Trigger analysis
      handleAnalyzeChat(newMessages);
    };
    reader.readAsDataURL(file);
  };

  // Live Chat Polling
  useEffect(() => {
    if (activeTab !== "chat") return;
    
    const poll = async () => {
      try {
        const res = await axios.get("/api/chat/live");
        if (res.data.messages && res.data.messages.length > 0) {
          const latestMsg = res.data.messages[0];
          const hasNewMessages = latestMsg.id !== lastMessageIdRef.current;
          
          lastMessageIdRef.current = latestMsg.id;
          setChatMessages(res.data.messages);
          
          // If we have messages but no moments, or if new messages arrived, trigger analysis
          if (hasNewMessages || detectedMoments.length === 0) {
            handleAnalyzeChat(res.data.messages);
          }
        }
        if (res.data.moments && res.data.moments.length > 0) {
          setDetectedMoments(res.data.moments);
        }
      } catch (e) {
        console.error("Polling error:", e);
      }
    };
    
    const interval = setInterval(poll, 20000);
    poll(); // Initial poll
    return () => clearInterval(interval);
  }, [activeTab, detectedMoments.length]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#1E293B] font-sans selection:bg-blue-100">
      {/* Header / Connection Status */}
      <header className="max-w-4xl mx-auto pt-12 px-6 flex justify-between items-center relative z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-200">
            <Link2 className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Syncer</h1>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={handleConnectGoogle}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border active:scale-95 hover:scale-105",
              googleTokens?.access_token 
                ? "bg-green-500 border-green-600 text-white shadow-sm" 
                : "bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600"
            )}
            title={googleTokens?.access_token ? "Connected! Click to reconnect if sync fails." : "Connect to Google Tasks"}
          >
            {googleTokens?.access_token ? <CheckCircle className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
            Google Tasks
          </button>
          <button 
            onClick={() => {
              console.log("Notion header button clicked");
              handleConnectNotion();
            }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 border active:scale-95 hover:scale-105",
              notionTokens?.access_token 
                ? "bg-green-500 border-green-600 text-white shadow-sm" 
                : "bg-white border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-600"
            )}
          >
            {notionTokens?.access_token ? <CheckCircle className="w-4 h-4" /> : <Database className="w-4 h-4" />}
            Notion
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto py-12 px-6 space-y-12">
        {/* Tab Navigation */}
        <div className="flex bg-slate-100 p-1 rounded-2xl w-fit mx-auto">
          <button 
            onClick={() => setActiveTab("ingestion")}
            className={cn(
              "px-6 py-2 rounded-xl text-sm font-bold transition-all",
              activeTab === "ingestion" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            Manual Ingestion
          </button>
          <button 
            onClick={() => setActiveTab("chat")}
            className={cn(
              "px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
              activeTab === "chat" ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Zap className="w-4 h-4" />
            Passive Chat Intelligence
          </button>
        </div>

        {activeTab === "ingestion" ? (
          <>
            {/* Data Input Section */}
            <section className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-700">Data Ingestion</h2>
                <div className="flex gap-2">
                  <button 
                    onClick={handleSyncUmspectrum}
                    disabled={isSyncingUmspectrum}
                    className="text-[10px] bg-red-50 text-red-600 px-3 py-1 rounded-full font-bold border border-red-100 hover:bg-red-100 transition-colors flex items-center gap-1"
                  >
                    {isSyncingUmspectrum ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                    UMSpectrum Direct Sync
                  </button>
                  {umspectrumUrl && (
                    <button 
                      onClick={() => {
                        setTempUmspectrumUrl(umspectrumUrl);
                        setShowUmspectrumModal(true);
                      }}
                      className="text-[10px] bg-slate-100 text-slate-500 px-3 py-1 rounded-full font-bold border border-slate-200 hover:bg-slate-200 transition-colors"
                    >
                      Settings
                    </button>
                  )}
                  <span className="text-xs text-slate-400 uppercase tracking-widest font-bold">Multimodal</span>
                </div>
              </div>
              
              <div 
                {...getRootProps()} 
                className={cn(
                  "relative group cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-500 flex flex-col items-center justify-center p-12",
                  isDragActive 
                    ? "border-blue-500 bg-blue-50/50" 
                    : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50/50"
                )}
              >
                <input {...getInputProps()} />
                <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-500">
                  <FileUp className="w-8 h-8 text-slate-400 group-hover:text-blue-500" />
                </div>
                <p className="text-slate-600 font-medium">Drop syllabi, briefs, or notes here</p>
                <p className="text-slate-400 text-sm mt-1">PDF, Images, Text, or Audio</p>
                
                {additionalPrompt.includes("UMSpectrum") && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="mt-4 px-4 py-2 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-2"
                  >
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-xs font-bold text-red-600 uppercase tracking-wider">UMSpectrum Mode Active</span>
                  </motion.div>
                )}
                  <div className="mt-6 flex flex-wrap gap-2 justify-center">
                    {files.map((file, i) => (
                      <span key={i} className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                        {file.name}
                      </span>
                    ))}
                  </div>
              </div>
            </section>

            {/* Additional Prompt Section */}
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-700">Additional Context</h2>
              <div className="relative">
                <textarea
                  value={additionalPrompt}
                  onChange={(e) => setAdditionalPrompt(e.target.value)}
                  placeholder="e.g., 'Prioritize group projects' or 'Set all deadlines to 6 PM'"
                  className="w-full h-32 bg-white border border-slate-200 rounded-3xl p-6 text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none shadow-sm"
                />
                <div className="absolute bottom-4 right-4">
                  <button 
                    onClick={handleExtract}
                    disabled={isExtracting || files.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white px-8 py-3 rounded-2xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-95 flex items-center gap-2"
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Reasoning...
                      </>
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        Extract
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>

            {/* Results Section */}
            <AnimatePresence>
              {extractedData && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-12 pb-24"
                >
                  {/* Task List */}
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <CheckCircle2 className="text-blue-500" />
                        Extracted Task List
                      </h2>
                      <button 
                        onClick={syncAllToNotion}
                        disabled={isSyncingAll}
                        className="text-sm font-bold text-blue-600 hover:text-blue-700 flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-xl transition-colors disabled:opacity-50"
                      >
                        {isSyncingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                        {isSyncingAll ? "Syncing..." : "Sync All to Notion"}
                      </button>
                    </div>
                    
                    {extractedData.tasks.length === 0 && (
                      <div className="bg-white border border-slate-100 rounded-3xl p-12 text-center space-y-4">
                        <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto">
                          <AlertCircle className="w-8 h-8 text-slate-300" />
                        </div>
                        <p className="text-slate-500 font-medium">No tasks were found in the document.</p>
                        <p className="text-slate-400 text-sm">Try adding more context or a different file.</p>
                      </div>
                    )}

                    <div className="grid gap-4">
                      {extractedData.tasks.map((task, i) => (
                        <motion.div 
                          key={i}
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="bg-white border border-slate-100 rounded-3xl p-6 shadow-sm hover:border-blue-200 transition-all group"
                        >
                          <div className="flex items-start justify-between mb-4">
                            <div className="space-y-1">
                              <h3 className="font-bold text-slate-800 text-lg group-hover:text-blue-600 transition-colors">{task.title}</h3>
                              <p className="text-slate-500 text-sm leading-relaxed">{task.description}</p>
                            </div>
                            <div className="flex flex-col items-end gap-2">
                              <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-1 rounded-full uppercase tracking-wider">
                                {task.status}
                              </span>
                              <div className="flex items-center gap-1 text-blue-600 font-bold text-xs">
                                <CalendarIcon className="w-3 h-3" />
                                {new Date(task.deadline).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex gap-3">
                            <button 
                              onClick={() => syncToNotion(task, i)}
                              disabled={syncStatus[`notion-${i}`] === "syncing" || syncStatus[`notion-${i}`] === "success"}
                              className={cn(
                                "flex-1 py-3 rounded-2xl text-[10px] font-bold transition-all flex items-center justify-center gap-2",
                                syncStatus[`notion-${i}`] === "success" 
                                  ? "bg-green-500 text-white" 
                                  : "bg-slate-900 text-white hover:bg-slate-800 active:scale-95"
                              )}
                            >
                              {syncStatus[`notion-${i}`] === "syncing" ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : syncStatus[`notion-${i}`] === "success" ? (
                                <CheckCircle className="w-4 h-4" />
                              ) : (
                                <Database className="w-4 h-4" />
                              )}
                              {syncStatus[`notion-${i}`] === "success" ? "Synced to Notion" : "Sync to Notion"}
                            </button>
                            
                            <button 
                              onClick={() => syncToGoogle(task, i, "task")}
                              disabled={syncStatus[`task-${i}`] === "syncing" || syncStatus[`task-${i}`] === "success"}
                              className={cn(
                                "flex-1 py-3 rounded-2xl text-[10px] font-bold transition-all flex items-center justify-center gap-2 border",
                                syncStatus[`task-${i}`] === "success"
                                  ? "bg-blue-500 border-blue-600 text-white"
                                  : "bg-white border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-600 active:scale-95"
                              )}
                            >
                              {syncStatus[`task-${i}`] === "syncing" ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : syncStatus[`task-${i}`] === "success" ? (
                                <CheckCircle className="w-4 h-4" />
                              ) : (
                                <CalendarDays className="w-4 h-4" />
                              )}
                              {syncStatus[`task-${i}`] === "success" ? "Synced to Task" : "Sync to Task"}
                            </button>

                            <button 
                              onClick={() => syncToGoogle(task, i, "event")}
                              disabled={syncStatus[`event-${i}`] === "syncing" || syncStatus[`event-${i}`] === "success"}
                              className={cn(
                                "flex-1 py-3 rounded-2xl text-[10px] font-bold transition-all flex items-center justify-center gap-2 border",
                                syncStatus[`event-${i}`] === "success"
                                  ? "bg-slate-100 text-slate-400 border-slate-200"
                                  : "bg-white border-slate-200 text-slate-400 hover:border-slate-400 hover:text-slate-600 active:scale-95"
                              )}
                              title="Sync as Calendar Event"
                            >
                              {syncStatus[`event-${i}`] === "syncing" ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : syncStatus[`event-${i}`] === "success" ? (
                                <CheckCircle className="w-4 h-4" />
                              ) : (
                                <CalendarIcon className="w-4 h-4" />
                              )}
                              {syncStatus[`event-${i}`] === "success" ? "Synced to Event" : "Sync to Event"}
                            </button>
                          </div>
                          
                          {syncErrors[`notion-${i}`] && (
                            <p className="mt-3 text-[10px] text-red-500 font-medium bg-red-50 p-2 rounded-lg border border-red-100">
                              {syncErrors[`notion-${i}`].tip}
                            </p>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  {/* Roadmap & Analysis */}
                  <div className="grid md:grid-cols-2 gap-8">
                    <div className="bg-white border border-slate-100 rounded-3xl p-8 space-y-4 shadow-sm">
                      <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <Zap className="text-amber-500" />
                        Project Roadmap
                      </h2>
                      <div className="prose prose-slate prose-sm max-w-none text-slate-600 leading-relaxed">
                        {extractedData.roadmap.split('\n').map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </div>
                    </div>

                    <div className="bg-slate-900 rounded-3xl p-8 space-y-4 shadow-xl">
                      <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <ShieldAlert className="text-red-400" />
                        Gap Analysis
                      </h2>
                      <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed">
                        {extractedData.gapAnalysis.split('\n').map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="space-y-8">
            {/* Chat Intelligence View */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Chat Stream */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                    <MessageSquare className="w-5 h-5 text-blue-500" />
                    Live Stream
                  </h2>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setShowConnectionGuide(true)}
                      className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full font-bold hover:bg-slate-200 transition-colors flex items-center gap-1"
                    >
                      <Link2 className="w-2.5 h-2.5" />
                      Connect API
                    </button>
                    <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold animate-pulse">MONITORING</span>
                  </div>
                </div>
                
                <div className="bg-white border border-slate-200 rounded-3xl h-[500px] flex flex-col shadow-sm overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-6 space-y-4 scrollbar-hide">
                    {chatMessages.map((msg) => (
                      <div key={msg.id} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-400">{msg.platform}</span>
                          <span className="text-xs font-bold text-blue-600">{msg.author}</span>
                          <span className="text-[10px] text-slate-300">{new Date(msg.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-2xl rounded-tl-none text-sm text-slate-700 border border-slate-100">
                          {msg.content}
                          {msg.attachments?.map((att, i) => (
                            <div key={i} className="mt-2 rounded-lg overflow-hidden border border-slate-200">
                              {att.mimeType.startsWith("image/") ? (
                                <img src={`data:${att.mimeType};base64,${att.data}`} alt="attachment" className="max-w-full h-auto" referrerPolicy="no-referrer" />
                              ) : att.mimeType.startsWith("audio/") ? (
                                <div className="p-3 bg-blue-50 flex items-center gap-3">
                                  <Mic className="w-5 h-5 text-blue-500" />
                                  <audio controls className="h-8 max-w-full">
                                    <source src={`data:${att.mimeType};base64,${att.data}`} type={att.mimeType} />
                                    Your browser does not support the audio element.
                                  </audio>
                                </div>
                              ) : (
                                <div className="p-3 text-xs text-slate-400 italic flex items-center gap-2">
                                  <FileUp className="w-4 h-4" />
                                  Attachment: {att.mimeType}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex gap-2">
                    <input 
                      type="text" 
                      value={newChatMessage}
                      onChange={(e) => setNewChatMessage(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddChatMessage()}
                      placeholder="Simulate a message..."
                      className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <label className="cursor-pointer p-2 hover:bg-slate-200 rounded-xl transition-colors">
                      <ImageIcon className="w-5 h-5 text-slate-400" />
                      <input type="file" className="hidden" accept="image/*" onChange={handleChatImageUpload} />
                    </label>
                    <button 
                      onClick={handleVoiceSimulation}
                      className="p-2 hover:bg-slate-200 rounded-xl transition-colors"
                      title="Simulate Voice Message"
                    >
                      <Mic className="w-5 h-5 text-slate-400" />
                    </button>
                    <button 
                      onClick={handleAddChatMessage}
                      className="bg-blue-600 text-white p-2 rounded-xl hover:bg-blue-700 transition-colors"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </section>

              {/* Detected Moments */}
              <section className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                    <Zap className="w-5 h-5 text-amber-500" />
                    Project Moments
                  </h2>
                  <div className="flex items-center gap-2">
                    {isRateLimited && (
                      <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-bold animate-pulse">
                        AI COOLING DOWN (60s)
                      </span>
                    )}
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">AUTONOMOUS MODE</span>
                    <button 
                      onClick={handleAnalyzeChat}
                      disabled={isAnalyzingChat}
                      className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
                    >
                      {isAnalyzingChat ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                      Refresh Analysis
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  {detectedMoments.length === 0 && !isAnalyzingChat && (
                    <div className="bg-white border border-slate-100 rounded-3xl p-12 text-center space-y-4">
                      <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center mx-auto">
                        <ShieldAlert className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="text-slate-400 text-sm">No project moments detected yet. Try simulating a decision or assignment.</p>
                    </div>
                  )}

                  {isAnalyzingChat && (
                    <div className="space-y-4">
                      {[1, 2].map(i => (
                        <div key={i} className="bg-white border border-slate-100 rounded-3xl p-6 animate-pulse space-y-3">
                          <div className="h-4 w-24 bg-slate-100 rounded" />
                          <div className="h-4 w-full bg-slate-50 rounded" />
                          <div className="h-8 w-32 bg-slate-100 rounded-xl" />
                        </div>
                      ))}
                    </div>
                  )}

                  {detectedMoments.map((moment, i) => (
                    <motion.div 
                      key={i}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm hover:border-blue-200 transition-all group"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                          moment.type === "Decision" ? "bg-purple-100 text-purple-700" :
                          moment.type === "Assignment" ? "bg-blue-100 text-blue-700" :
                          moment.type === "Deadline" ? "bg-amber-100 text-amber-700" :
                          "bg-red-100 text-red-700"
                        )}>
                          {moment.type}
                        </span>
                        <div className="flex items-center gap-2">
                          {moment.isCommitment && (
                            <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                              <CheckCircle className="w-2.5 h-2.5" />
                              Commitment
                            </span>
                          )}
                          {moment.priority === "High" && (
                            <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                              <ShieldAlert className="w-2.5 h-2.5" />
                              High Priority
                            </span>
                          )}
                          <div className="flex items-center gap-1">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                            <span className="text-[10px] font-bold text-slate-400">{Math.round(moment.confidence * 100)}% Confidence</span>
                          </div>
                        </div>
                      </div>
                      
                      <p className="text-slate-800 font-medium mb-4">{moment.summary}</p>
                      
                      <div className="flex items-center gap-3">
                        {moment.suggestedTask && (
                          <button 
                            onClick={() => syncMomentToNotion(moment, i)}
                            disabled={syncStatus[`moment-${i}`] === "success"}
                            className={cn(
                              "flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2",
                              syncStatus[`moment-${i}`] === "success" 
                                ? "bg-green-500 text-white" 
                                : "bg-slate-900 text-white hover:bg-slate-800"
                            )}
                          >
                            {syncStatus[`moment-${i}`] === "success" ? (
                              <><CheckCircle className="w-3 h-3" /> Synced to Notion</>
                            ) : (
                              <><Database className="w-3 h-3" /> Sync to Notion</>
                            )}
                          </button>
                        )}
                        <button 
                          onClick={() => sendChatNotification(moment)}
                          className="p-2 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200 transition-colors"
                          title="Send chat confirmation"
                        >
                          <Bell className="w-4 h-4" />
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Footer Branding */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-md border-t border-slate-100 py-4 px-6 flex justify-center items-center gap-2">
        <span className="text-xs text-slate-400 font-medium uppercase tracking-widest">Powered by</span>
        <span className="text-sm font-bold text-blue-600">Syncer Intelligence Engine</span>
      </footer>

      {/* UMSpectrum Modal */}
      <AnimatePresence>
        {showUmspectrumModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6"
            >
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <Zap className="text-red-500 w-5 h-5" />
                  UMSpectrum Direct Connect
                </h3>
                <p className="text-slate-500 text-sm">
                  Sync your university dashboard directly using your private Calendar URL.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Calendar URL (iCal)</label>
                  <input 
                    type="text"
                    placeholder="https://umspectrum.um.edu.my/calendar/export_execute.php?..."
                    value={tempUmspectrumUrl}
                    onChange={(e) => setTempUmspectrumUrl(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 outline-none transition-all text-xs"
                  />
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl space-y-2 border border-slate-100">
                  <h4 className="text-xs font-bold text-slate-700">How to find your URL:</h4>
                  <ol className="list-decimal list-inside text-[10px] text-slate-500 space-y-1">
                    <li>Log in to <b>UMSpectrum</b>.</li>
                    <li>Go to <b>Calendar</b> from the sidebar.</li>
                    <li>Click <b>Export calendar</b> at the bottom.</li>
                    <li>Select <b>All events</b> and <b>Recent and next 60 days</b>.</li>
                    <li>Click <b>Get calendar URL</b> and copy the link here.</li>
                  </ol>
                </div>
              </div>
              
              <div className="flex flex-col gap-3 pt-2">
                <button 
                  onClick={handleSaveUmspectrumUrl}
                  className="w-full px-4 py-3 rounded-xl bg-red-600 text-white font-medium hover:bg-red-700 transition-colors shadow-lg shadow-red-200"
                >
                  Save & Connect
                </button>
                <button 
                  onClick={() => setShowUmspectrumModal(false)}
                  className="w-full py-2 text-slate-400 text-sm hover:text-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Notion Secret Modal */}
      <AnimatePresence>
        {showNotionModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6"
            >
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-800">
                  {notionTokens?.access_token ? "Notion Settings" : "Connect to Notion"}
                </h3>
                <p className="text-slate-500 text-sm">
                  {notionTokens?.access_token 
                    ? "Your Notion integration is active. You can update your settings or disconnect below."
                    : "Connect your Notion workspace to sync tasks directly to your databases."}
                </p>
              </div>

              <div className="space-y-6">
                <button 
                  onClick={handleStartNotionOAuth}
                  className="w-full py-4 rounded-2xl bg-slate-900 text-white font-bold flex items-center justify-center gap-3 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
                >
                  <Database className="w-5 h-5" />
                  {notionTokens?.access_token ? "Reconnect with Notion" : "Login with Notion"}
                </button>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Database ID</label>
                    <input 
                      type="text"
                      placeholder="e.g. 1234567890abcdef..."
                      value={tempDatabaseId}
                      onChange={(e) => setTempDatabaseId(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Found in your database URL: notion.so/workspace/<b>[ID]</b>?v=...
                      <br/>
                      <span className="text-blue-500 italic">Tip: Ensure you use the ID of the <b>Database</b> itself, not the parent Page.</span>
                    </p>
                  </div>
                </div>
                
                <div className="flex flex-col gap-3 pt-2">
                  <div className="flex gap-3">
                    <button 
                      onClick={handleTestNotionConnection}
                      disabled={isTestingConnection}
                      className="flex-1 px-4 py-3 rounded-xl border border-blue-200 text-blue-600 font-medium hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
                    >
                      {isTestingConnection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                      Test
                    </button>
                    <button 
                      onClick={handleSaveNotionSecret}
                      className="flex-[2] px-4 py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
                    >
                      {notionTokens?.access_token ? "Update Settings" : "Connect & Save"}
                    </button>
                  </div>
                  
                  {notionTokens?.access_token && (
                    <button 
                      onClick={handleDisconnectNotion}
                      className="w-full py-3 rounded-xl border border-red-100 text-red-500 font-medium hover:bg-red-50 transition-colors"
                    >
                      Disconnect Notion
                    </button>
                  )}

                  <button 
                    onClick={() => setShowNotionModal(false)}
                    className="w-full py-2 text-slate-400 text-sm hover:text-slate-600 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
        {/* Connection Guide Modal */}
        {showConnectionGuide && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              onClick={() => setShowConnectionGuide(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="relative bg-white rounded-[2.5rem] w-full max-w-2xl p-10 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-slate-800">Live Integration Setup</h2>
                  <p className="text-slate-500 mt-1">Connect your Discord or Telegram to enable autonomous monitoring.</p>
                </div>
                <button 
                  onClick={() => setShowConnectionGuide(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <Plus className="w-6 h-6 text-slate-400 rotate-45" />
                </button>
              </div>

              <div className="space-y-8">
                {/* Discord Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                      <MessageSquare className="w-6 h-6 text-indigo-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">Discord Webhook</h3>
                  </div>
                  <div className="bg-slate-50 rounded-2xl p-6 space-y-4 border border-slate-100">
                    <ol className="list-decimal list-inside text-sm text-slate-600 space-y-3">
                      <li>Go to your Discord Server Settings &gt; Integrations.</li>
                      <li>Create a new Webhook and copy the <b>Webhook URL</b>.</li>
                      <li>In your AI Studio project, add a secret named <code>DISCORD_WEBHOOK_URL</code>.</li>
                      <li>The agent will now automatically send notifications to this channel.</li>
                    </ol>
                  </div>
                </div>

                {/* Telegram Section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-sky-50 rounded-xl flex items-center justify-center">
                      <Send className="w-6 h-6 text-sky-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800">Telegram Options</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-slate-50 rounded-2xl p-6 space-y-4 border border-slate-100">
                      <h4 className="font-bold text-slate-700 text-sm">Option A: Bot (Recommended)</h4>
                      <ol className="list-decimal list-inside text-xs text-slate-600 space-y-2">
                        <li>Message <b>@BotFather</b> to create a bot.</li>
                        <li>Add token as <code>TELEGRAM_BOT_TOKEN</code>.</li>
                        <li>Add bot to group as admin.</li>
                      </ol>
                    </div>
                    
                    <div className="bg-blue-50 rounded-2xl p-6 space-y-4 border border-blue-100">
                      <h4 className="font-bold text-blue-800 text-sm">Option B: User Account</h4>
                      <p className="text-[10px] text-blue-600">Monitor chats without adding a bot. Requires API ID/Hash.</p>
                      
                      {telegramStep === "phone" && (
                        <div className="space-y-3">
                          <input 
                            type="text"
                            placeholder="+60123456789"
                            value={telegramPhone}
                            onChange={(e) => setTelegramPhone(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg text-xs border border-blue-200 outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                          <button 
                            onClick={handleTelegramSendCode}
                            disabled={isTelegramLoading}
                            className="w-full py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                          >
                            {isTelegramLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                            Send Code
                          </button>
                        </div>
                      )}

                      {telegramStep === "code" && (
                        <div className="space-y-3">
                          <p className="text-[10px] text-blue-500">Enter the code sent to your Telegram app.</p>
                          <input 
                            type="text"
                            placeholder="12345"
                            value={telegramCode}
                            onChange={(e) => setTelegramCode(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg text-xs border border-blue-200 outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                          <button 
                            onClick={handleTelegramSignIn}
                            disabled={isTelegramLoading}
                            className="w-full py-2 bg-blue-600 text-white text-xs font-bold rounded-lg hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                          >
                            {isTelegramLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                            Sign In
                          </button>
                        </div>
                      )}

                      {telegramStep === "success" && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-xs font-bold">Login Successful!</span>
                          </div>
                          <p className="text-[9px] text-slate-500">Copy this session string and save it as a secret named <code>TELEGRAM_SESSION</code> in AI Studio:</p>
                          <div className="bg-white p-2 rounded border border-slate-200 font-mono text-[8px] break-all max-h-20 overflow-y-auto">
                            {telegramSession}
                          </div>
                        </div>
                      )}

                      {telegramError && (
                        <p className="text-[10px] text-red-500 mt-1">{telegramError}</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Webhook Endpoint */}
                <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                  <h4 className="text-sm font-bold text-blue-800 mb-2">Your Webhook Endpoint:</h4>
                  <code className="block bg-white p-3 rounded-xl text-xs text-blue-600 font-mono break-all border border-blue-200">
                    {window.location.origin}/api/chat/webhook
                  </code>
                  <p className="text-[10px] text-blue-500 mt-2 italic">
                    * Note: For Discord, use the Webhook URL provided by Discord. For Telegram, set your bot's webhook to this URL.
                  </p>
                </div>

                <button 
                  onClick={() => setShowConnectionGuide(false)}
                  className="w-full py-4 rounded-2xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-all"
                >
                  Got it!
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
