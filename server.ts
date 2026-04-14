import express from "express";
import dotenv from "dotenv";
dotenv.config();

import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { OAuth2Client } from "google-auth-library";
import { google } from "googleapis";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage } from "telegram/events";
import ical from "node-ical";
import { ChatMessage, ProjectMoment } from "./src/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json());

// Google OAuth Setup
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/google/callback`
);

// Notion OAuth Setup
const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID;
const NOTION_CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET;
const NOTION_REDIRECT_URI = `${process.env.APP_URL}/auth/notion/callback`;

// Telegram User Setup
let telegramClient: TelegramClient | null = null;
let phoneCodeHash: string | null = null;
let telegramPhoneNumber: string | null = null;

// In-memory store for live chat messages (for frontend polling)
let liveChatMessages: ChatMessage[] = [];
let liveProjectMoments: ProjectMoment[] = [];

async function initTelegram() {
  const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
  const apiHash = process.env.TELEGRAM_API_HASH || "";
  const session = new StringSession(process.env.TELEGRAM_SESSION || "");

  if (apiId && apiHash) {
    telegramClient = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 5,
    });
    
    if (process.env.TELEGRAM_SESSION) {
      await telegramClient.connect();
      console.log("Telegram User connected via session");
      
      telegramClient.addEventHandler(async (event) => {
        const message = event.message;
        
        let name = "User";
        try {
          const sender: any = await message.getSender();
          name = sender?.firstName || sender?.username || "User";
        } catch (e) {
          console.error("Failed to get sender:", e);
        }

        let content = message.message || "";
        let attachments: { mimeType: string; data: string }[] = [];
        let isVoice = false;

        // Handle Media (Voice Notes, Photos)
        if (message.media) {
          try {
            console.log(`[TELEGRAM] Downloading media for message from ${name}...`);
            const buffer = await telegramClient!.downloadMedia(message.media, {});
            if (buffer) {
              let mimeType = "application/octet-stream";
              
              if (message.media instanceof Api.MessageMediaDocument) {
                const doc = message.media.document as Api.Document;
                mimeType = doc.mimeType;
                
                // Check if it's a voice note
                const isVoiceNote = doc.attributes.some(attr => 
                  attr instanceof Api.DocumentAttributeAudio && attr.voice
                );
                if (isVoiceNote) {
                  isVoice = true;
                  content = content || "[Voice Message]";
                  console.log(`[TELEGRAM] Voice message detected from ${name}`);
                }
              } else if (message.media instanceof Api.MessageMediaPhoto) {
                mimeType = "image/jpeg";
                content = content || "[Photo]";
              }

              attachments.push({
                mimeType: mimeType,
                data: buffer.toString("base64")
              });
            }
          } catch (e) {
            console.error("Failed to download Telegram media:", e);
          }
        }

        if (content || attachments.length > 0) {
          const newMessage: ChatMessage = {
            id: Math.random().toString(36).substr(2, 9),
            author: name,
            content: content,
            timestamp: new Date().toISOString(),
            platform: "Telegram",
            attachments: attachments.length > 0 ? attachments : undefined,
            isVoice: isVoice
          };
          
          liveChatMessages.unshift(newMessage);
          if (liveChatMessages.length > 50) liveChatMessages.pop();
          console.log(`[TELEGRAM USER] ${name}: ${content} ${isVoice ? "(Voice)" : ""}`);
        }
      }, new NewMessage({}));
    }
  }
}
initTelegram();

// --- Auth Routes ---

// Google Auth URL
app.get("/api/auth/google/url", (req, res) => {
  const url = googleClient.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/tasks"
    ],
    prompt: "consent",
  });
  res.json({ url });
});

// Google Auth Callback
app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await googleClient.getToken(code as string);
    // In a real app, store these in a database. 
    // For this demo, we'll send them back to the frontend via postMessage.
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(500).send("Authentication failed");
  }
});

// Notion Auth URL
app.get("/api/auth/notion/url", (req, res) => {
  const url = `https://api.notion.com/v1/oauth/authorize?client_id=${NOTION_CLIENT_ID}&response_type=code&owner=user&redirect_uri=${encodeURIComponent(NOTION_REDIRECT_URI)}`;
  res.json({ url });
});

// Notion Auth Callback
app.get("/auth/notion/callback", async (req, res) => {
  const { code } = req.query;
  try {
    const response = await axios.post("https://api.notion.com/v1/oauth/token", {
      grant_type: "authorization_code",
      code,
      redirect_uri: NOTION_REDIRECT_URI,
    }, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
    });

    const tokens = response.data;
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'NOTION_AUTH_SUCCESS', tokens: ${JSON.stringify(tokens)} }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Notion Auth Error:", error);
    res.status(500).send("Authentication failed");
  }
});

// --- Telegram User Auth ---

app.post("/api/telegram/send-code", async (req, res) => {
  const { phoneNumber } = req.body;
  if (!telegramClient) return res.status(500).json({ error: "Telegram client not initialized" });

  try {
    await telegramClient.connect();
    const result = await telegramClient.sendCode(
      {
        apiId: parseInt(process.env.TELEGRAM_API_ID!),
        apiHash: process.env.TELEGRAM_API_HASH!,
      },
      phoneNumber
    );
    phoneCodeHash = result.phoneCodeHash;
    telegramPhoneNumber = phoneNumber;
    res.json({ success: true });
  } catch (error: any) {
    console.error("Telegram Send Code Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/telegram/sign-in", async (req, res) => {
  const { code } = req.body;
  if (!telegramClient || !phoneCodeHash || !telegramPhoneNumber) {
    return res.status(400).json({ error: "Invalid session or missing code hash" });
  }

  try {
    await telegramClient.invoke(
      new Api.auth.SignIn({
        phoneNumber: telegramPhoneNumber,
        phoneCodeHash: phoneCodeHash,
        phoneCode: code,
      })
    );
    
    const sessionString = telegramClient.session.save() as unknown as string;
    res.json({ success: true, sessionString });
  } catch (error: any) {
    console.error("Telegram Sign In Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- API Proxy for Notion/Google (to keep secrets hidden) ---
// Actually, since we pass tokens to the client, the client can call them directly if they have the token.
// But Notion requires a secret for some things? No, just the token.
// However, to avoid CORS issues, a proxy is often better.

function extractDatabaseId(input: string) {
  const trimmed = input.trim();
  // Matches 32-char hex string in a Notion URL or as a standalone string
  const match = trimmed.match(/([a-f0-9]{32})/i);
  if (match) return match[1];
  return trimmed;
}

app.post("/api/notion/test-connection", async (req, res) => {
  const { token, databaseId: rawId } = req.body;
  const databaseId = extractDatabaseId(rawId);
  
  try {
    const response = await axios.get(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });
    res.json({ status: "ok", title: response.data.title?.[0]?.plain_text || "Untitled Database" });
  } catch (error: any) {
    const notionError = error.response?.data;
    console.error("Notion Test Connection Error:", notionError || error.message);
    res.status(500).json({ error: notionError || { message: error.message } });
  }
});

app.post("/api/google/list-events", async (req, res) => {
  const { tokens, timeMin, timeMax } = req.body;
  if (!tokens) return res.status(400).json({ error: "Missing tokens" });

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth });
    const response = await calendar.events.list({
      calendarId: "primary",
      timeMin: timeMin || new Date().toISOString(),
      timeMax: timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });
    res.json(response.data.items || []);
  } catch (error: any) {
    const { message, status } = getGoogleErrorMessage(error);
    res.status(status).json({ error: message });
  }
});

app.post("/api/notion/create-task", async (req, res) => {
  const { token, databaseId: rawId, task, category, sourceSummary } = req.body;
  const databaseId = extractDatabaseId(rawId);
  
  try {
    // First, let's try to find the title property name (usually 'Name' or 'title')
    const dbInfo = await axios.get(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });

    const properties: any = {};
    const dbProps = dbInfo.data.properties;

    const mapProperty = (propName: string, value: any, type: string) => {
      if (!value && type !== "title") return null;
      
      try {
        if (type === "title") {
          return { title: [{ text: { content: String(value || "Untitled Task") } }] };
        }
        if (type === "rich_text") {
          return { rich_text: [{ text: { content: String(value || "") } }] };
        }
        if (type === "date") {
          const d = new Date(value);
          if (isNaN(d.getTime())) return null;
          return { date: { start: d.toISOString() } };
        }
        if (type === "select") {
          return { select: { name: String(value) } };
        }
        if (type === "status") {
          return { status: { name: String(value) } };
        }
        if (type === "multi_select") {
          return { multi_select: [{ name: String(value) }] };
        }
        if (type === "url") {
          return { url: String(value) };
        }
        if (type === "email") {
          return { email: String(value) };
        }
        if (type === "phone_number") {
          return { phone_number: String(value) };
        }
        if (type === "checkbox") {
          return { checkbox: Boolean(value) };
        }
        if (type === "number") {
          const num = Number(value);
          return isNaN(num) ? null : { number: num };
        }
      } catch (e) {
        console.warn(`Failed to map property ${propName} of type ${type}:`, e);
      }
      return null;
    };

    // Find and map properties based on their actual types in the database
    Object.keys(dbProps).forEach(propName => {
      const prop = dbProps[propName];
      const lowerName = propName.toLowerCase();

      if (prop.type === "title") {
        properties[propName] = mapProperty(propName, task.title, "title");
      } else if (["description", "notes", "content", "body", "details"].includes(lowerName)) {
        const mapped = mapProperty(propName, task.description, prop.type);
        if (mapped) properties[propName] = mapped;
      } else if (["deadline", "date", "due date", "due", "time"].includes(lowerName)) {
        const mapped = mapProperty(propName, task.deadline, prop.type);
        if (mapped) properties[propName] = mapped;
      } else if (["created", "creation", "created date", "date created", "created at"].includes(lowerName)) {
        const mapped = mapProperty(propName, new Date().toISOString(), prop.type);
        if (mapped) properties[propName] = mapped;
      } else if (["status", "state", "progress", "stage", "priority"].includes(lowerName)) {
        let statusValue = task.status || "To Do";
        
        if (prop.type === "status" && prop.status?.options) {
          const options = prop.status.options.map((o: any) => o.name);
          if (options.length > 0 && !options.includes(statusValue)) {
            statusValue = options.find((o: string) => o.toLowerCase() === statusValue.toLowerCase()) || options[0];
          }
        } else if (prop.type === "select" && prop.select?.options) {
          const options = prop.select.options.map((o: any) => o.name);
          if (options.length > 0 && !options.includes(statusValue)) {
            statusValue = options.find((o: string) => o.toLowerCase() === statusValue.toLowerCase()) || options[0];
          }
        } else if (prop.type === "multi_select" && prop.multi_select?.options) {
          const options = prop.multi_select.options.map((o: any) => o.name);
          if (options.length > 0 && !options.includes(statusValue)) {
            statusValue = options.find((o: string) => o.toLowerCase() === statusValue.toLowerCase()) || options[0];
          }
        }
        
        const mapped = mapProperty(propName, statusValue, prop.type);
        if (mapped) properties[propName] = mapped;
      }
    });

    // Final check: Ensure we have a title property. If not, Notion will reject.
    const hasTitle = Object.values(properties).some((p: any) => p.title);
    if (!hasTitle) {
      const titlePropName = Object.keys(dbProps).find(k => dbProps[k].type === "title");
      if (titlePropName) {
        properties[titlePropName] = mapProperty(titlePropName, task.title || "Untitled Task", "title");
      }
    }

    // Prepare children blocks if it's a tutorial
    const children: any[] = [];
    if (category === "Tutorial" && sourceSummary) {
      children.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ text: { content: "Tutorial Reference" } }]
        }
      });
      children.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ text: { content: sourceSummary } }]
        }
      });
      children.push({
        object: "block",
        type: "callout",
        callout: {
          rich_text: [{ text: { content: "This task was extracted from a tutorial document. The summary above provides the core context." } }],
          icon: { emoji: "📖" }
        }
      });
    }

    const response = await axios.post("https://api.notion.com/v1/pages", {
      parent: { database_id: databaseId },
      properties,
      children: children.length > 0 ? children : undefined
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
      },
    });
    res.json(response.data);
  } catch (error: any) {
    const notionError = error.response?.data;
    console.error("Notion Create Task Error Details:", {
      status: error.response?.status,
      code: notionError?.code,
      message: notionError?.message,
      fullError: JSON.stringify(notionError, null, 2)
    });
    
    // Extract a more helpful message if it's a validation error
    let message = error.message;
    if (notionError) {
      message = notionError.message;
      if (notionError.code === "validation_error") {
        message = `Notion Validation Error: ${notionError.message}. This usually means a property type mismatch or a missing required field in your database.`;
      }
    }
    
    res.status(500).json({ 
      error: notionError || { message: error.message },
      helpfulMessage: message
    });
  }
});

// Helper to safely extract Google error messages
function getGoogleErrorMessage(error: any): { message: string, status: number, raw: any } {
  const data = error.response?.data;
  const status = error.response?.status || 500;
  
  let message = error.message || "An unknown error occurred";
  
  if (data?.error?.message) {
    message = data.error.message;
  } else if (data?.message) {
    message = data.message;
  } else if (Array.isArray(data?.errors) && data.errors[0]?.message) {
    message = data.errors[0].message;
  } else if (Array.isArray(error.errors) && error.errors[0]?.message) {
    message = error.errors[0].message;
  }

  return { message, status, raw: data || error };
}

app.post("/api/google/create-task", async (req, res) => {
  const { tokens, task } = req.body;
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ 
      error: "Server configuration error", 
      helpfulMessage: "Google Client ID or Secret is missing in server environment variables." 
    });
  }

  if (!tokens) {
    return res.status(400).json({ error: "Missing Google tokens" });
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials(tokens);
    
    const tasks = google.tasks({ version: "v1", auth });
    
    const now = new Date();
    // Set the primary "due" date to today as requested
    const dueTimestamp = now.getUTCFullYear() + "-" + 
                        String(now.getUTCMonth() + 1).padStart(2, '0') + "-" + 
                        String(now.getUTCDate()).padStart(2, '0') + "T00:00:00Z";
    
    let deadlineText = "";
    if (task.deadline) {
      const d = new Date(task.deadline);
      if (!isNaN(d.getTime())) {
        deadlineText = `\n\nDeadline: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
      }
    }

    const response = await tasks.tasks.insert({
      tasklist: "@default",
      requestBody: {
        title: task.title || "Untitled Task",
        notes: (task.description || "") + deadlineText + `\nCreated on: ${now.toLocaleDateString()}`,
        due: dueTimestamp,
      },
    });
    
    res.json(response.data);
  } catch (error: any) {
    const { message, status, raw } = getGoogleErrorMessage(error);
    console.error("Google Create Task Error:", { 
      status, 
      message, 
      stack: error.stack,
      raw: JSON.stringify(raw).substring(0, 500) // Limit size
    });
    
    let helpfulMessage = message;
    const lowerMsg = message.toLowerCase();

    if (status === 403) {
      if (lowerMsg.includes("disabled") || lowerMsg.includes("not been used")) {
        helpfulMessage = "The Google Tasks API is not enabled for this project. Please enable it in the Google Cloud Console.";
      } else {
        helpfulMessage = "Missing permissions. Please click the 'Google Tasks' button in the header to reconnect and grant 'Tasks' access.";
      }
    } else if (status === 401) {
      helpfulMessage = "Session expired or invalid. Please reconnect your Google account in the header.";
    } else if (lowerMsg.includes("invalid") && lowerMsg.includes("due")) {
      helpfulMessage = "Invalid deadline format. Google Tasks requires a very specific date format (YYYY-MM-DDT00:00:00Z).";
    }

    res.status(status).json({ 
      error: raw, 
      message,
      helpfulMessage 
    });
  }
});

app.post("/api/google/create-event", async (req, res) => {
  const { tokens, task } = req.body;
  
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ 
      error: "Server configuration error", 
      helpfulMessage: "Google Client ID or Secret is missing in server environment variables." 
    });
  }

  if (!tokens) {
    return res.status(400).json({ error: "Missing Google tokens" });
  }

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    auth.setCredentials(tokens);
    
    const calendar = google.calendar({ version: "v3", auth });
    
    const deadline = new Date(task.deadline);
    const now = new Date();
    
    // If deadline is valid and in the future, set start to now and end to deadline
    // This represents the "time to complete" the task.
    // Otherwise, fallback to a 1-hour event at the deadline or now.
    let start: Date;
    let end: Date;

    if (!isNaN(deadline.getTime())) {
      if (deadline > now) {
        start = now;
        end = deadline;
      } else {
        // Deadline is in the past, just make it a 1-hour event at the deadline
        start = deadline;
        end = new Date(deadline.getTime() + 60 * 60 * 1000);
      }
    } else {
      start = now;
      end = new Date(now.getTime() + 60 * 60 * 1000);
    }

    const response = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: task.title || "Untitled Task",
        description: task.description || "",
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      },
    });
    
    res.json(response.data);
  } catch (error: any) {
    const { message, status, raw } = getGoogleErrorMessage(error);
    console.error("Google Create Event Error:", { 
      status, 
      message, 
      stack: error.stack,
      raw: JSON.stringify(raw).substring(0, 500) // Limit size
    });
    
    let helpfulMessage = message;
    const lowerMsg = message.toLowerCase();

    if (status === 403) {
      if (lowerMsg.includes("disabled") || lowerMsg.includes("not been used")) {
        helpfulMessage = "The Google Calendar API is not enabled for this project. Please enable it in the Google Cloud Console.";
      } else {
        helpfulMessage = "Missing permissions. Please click the 'Google Tasks' button in the header to reconnect and grant 'Calendar' access.";
      }
    } else if (status === 401) {
      helpfulMessage = "Session expired or invalid. Please reconnect your Google account in the header.";
    }

    res.status(status).json({ 
      error: raw, 
      message,
      helpfulMessage 
    });
  }
});

app.post("/api/chat/send-notification", async (req, res) => {
  const { platform, channelId, message, owner } = req.body;
  
  const finalMessage = owner ? `${message} for **${owner}**` : message;
  console.log(`[CHAT NOTIFICATION] Sending to ${platform} (${channelId}): ${finalMessage}`);
  
  try {
    if (platform === "Discord" && process.env.DISCORD_WEBHOOK_URL) {
      await axios.post(process.env.DISCORD_WEBHOOK_URL, {
        content: finalMessage,
        username: "Syncer Agent",
        avatar_url: "https://picsum.photos/seed/syncer/200/200"
      });
    }
    // Telegram implementation would go here if TELEGRAM_BOT_TOKEN and a chatId were provided
    
    res.json({ status: "ok", sent: true, platform, message: finalMessage });
  } catch (error) {
    console.error("Failed to send external notification:", error);
    res.json({ status: "partial_success", sent: false, error: "External API call failed", message: finalMessage });
  }
});

app.post("/api/chat/webhook", async (req, res) => {
  // This endpoint handles incoming messages from Discord or Telegram
  const body = req.body;
  
  let platform = "Unknown";
  let author = "System";
  let content = "";
  let timestamp = new Date().toISOString();

  // Handle Telegram Webhook
  if (body.message) {
    platform = "Telegram";
    author = body.message.from?.first_name || "Telegram User";
    content = body.message.text || "";
    timestamp = new Date(body.message.date * 1000).toISOString();
  } 
  // Handle Discord Webhook (if configured to send to this URL)
  else if (body.content || body.username) {
    platform = "Discord";
    author = body.username || body.author?.username || "Discord User";
    content = body.content || "";
  }
  // Handle generic/manual payload
  else {
    platform = body.platform || platform;
    author = body.author || author;
    content = body.content || content;
  }

  console.log(`[CHAT WEBHOOK] Received from ${platform}: ${author}: ${content}`);
  
  const newMessage: ChatMessage = {
    id: Math.random().toString(36).substr(2, 9),
    author,
    content,
    timestamp,
    platform: platform as "Discord" | "Telegram"
  };
  
  liveChatMessages.unshift(newMessage);
  if (liveChatMessages.length > 50) liveChatMessages.pop();
  
  res.json({ status: "received", processed: { platform, author, content } });
});

app.get("/api/chat/live", (req, res) => {
  res.json({
    messages: liveChatMessages,
    moments: liveProjectMoments
  });
});

// --- UMSpectrum Direct Connect ---
app.post("/api/umspectrum/sync", async (req, res) => {
  const { calendarUrl } = req.body;
  if (!calendarUrl) return res.status(400).json({ error: "Missing Calendar URL" });

  try {
    console.log(`[UMSPECTRUM] Fetching calendar from: ${calendarUrl}`);
    
    // Use axios for the fetch to have better control over headers and timeouts
    const response = await axios.get(calendarUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/calendar'
      },
      timeout: 10000 // 10s timeout
    });

    const events = ical.parseICS(response.data);
    const tasks = [];

    for (const k in events) {
      if (events.hasOwnProperty(k)) {
        const ev = events[k];
        if (ev.type === 'VEVENT') {
          // Filter for upcoming events (within last 7 days or future)
          const now = new Date();
          const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          
          if (ev.start && ev.start >= sevenDaysAgo) {
            tasks.push({
              title: ev.summary || "Untitled Event",
              description: ev.description || `Course event from UMSpectrum`,
              deadline: ev.start.toISOString(),
              status: "To Do",
              source: "UMSpectrum Dashboard"
            });
          }
        }
      }
    }

    // Sort by deadline
    tasks.sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());

    console.log(`[UMSPECTRUM] Successfully extracted ${tasks.length} tasks.`);
    res.json({ tasks });
  } catch (error: any) {
    console.error("UMSpectrum Sync Error:", error.message);
    let helpfulMessage = "Failed to fetch UMSpectrum calendar.";
    
    if (error.code === 'ECONNABORTED') {
      helpfulMessage = "Connection timed out. UMSpectrum might be slow or unreachable.";
    } else if (error.response?.status === 404) {
      helpfulMessage = "Calendar URL not found (404). Please double-check the link.";
    } else if (error.response?.status === 403) {
      helpfulMessage = "Access denied (403). UMSpectrum might be blocking the request.";
    }

    res.status(500).json({ 
      error: error.message,
      helpfulMessage 
    });
  }
});

// --- Vite Middleware ---
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
