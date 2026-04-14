import { GoogleGenAI, Type } from "@google/genai";
import { ChatMessage, ProjectMoment, Task } from "../types";

let aiInstance: GoogleGenAI | null = null;

function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey || apiKey === "undefined" || apiKey === "null") {
      throw new Error("GEMINI_API_KEY is not set. Please ensure it is configured in your AI Studio Secrets.");
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

export async function analyzeChatStream(
  messages: ChatMessage[]
): Promise<ProjectMoment[]> {
  console.log(`[ChatIntelligence] Analyzing ${messages.length} messages...`);
  const ai = getAI();
  const model = "gemini-3.1-pro-preview"; // Use Pro for complex reasoning on chat context

  const chatContext = messages
    .map((m) => `[${m.platform}] ${m.author} (${m.timestamp}): ${m.content}`)
    .join("\n");
  
  console.log("[ChatIntelligence] Context prepared, calling Gemini...");

  const prompt = `
    You are the "Syncer Live Integration Agent".
    You are monitoring a live team communication stream (Discord/Telegram) via autonomous webhooks.
    
    CORE CAPABILITIES:
    1. LINGUISTIC FLUENCY (CRITICAL): You are an expert in Malaysian/Singaporean multilingual communication. You MUST accurately process audio and text in English, Chinese (Mandarin/Cantonese/Hokkien), and Malay. You MUST handle "Code-Switching" (mixing multiple languages in one sentence) seamlessly. Focus on extracting the underlying 'Action' regardless of the slang or language used (e.g., "lah", "wei", "kena", "meh", "dabao", "makan").
    2. MULTIMODAL AUDIO: Analyze voice messages. Transcribe them internally to identify tasks, owners, and dates. Even if the speaker switches languages mid-sentence, you must capture the full context.
    3. IMPLICIT TIMING: Use the current date as your reference point. Convert phrases like "submit by Friday" or "meeting in 2 days" into absolute ISO-8601 timestamps.
       - Current Reference Time: ${new Date().toISOString()}
    4. VISUAL CONTEXT: If a screenshot (SPeCTRUM/whiteboard) is posted, treat it as a high-priority "Truth Source".
    
    AGENTIC BEHAVIOR (AUTONOMOUS):
    - Identify "Project Moments": Decision, Assignment, Deadline, Blocker.
    - COMMITMENT FILTER: Only trigger actions for sentences that imply a "To-Do" or a "Decision" (e.g., "I'll do...", "Let's set...", "Don't forget to..."). Exclude social chatter.
    - AUTOMATIC SYNC: If a task and owner are clearly identified, ensure suggestedTask is complete for immediate sync.
    - PRIORITY: Set to "High" for commitments from visual sources or critical voice notes.

    RULES:
    - Output MUST be in JSON format matching the schema.
    
    CHAT HISTORY:
    ${chatContext}
  `;

  // Handle multimodal if any message has attachments
  const contents: any[] = [{ text: prompt }];
  messages.forEach(m => {
    if (m.attachments) {
      m.attachments.forEach(a => {
        contents.push({
          inlineData: {
            mimeType: a.mimeType,
            data: a.data
          }
        });
      });
    }
  });

  const response = await ai.models.generateContent({
    model,
    contents: { parts: contents },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            type: { type: Type.STRING, enum: ["Decision", "Assignment", "Deadline", "Blocker"] },
            summary: { type: Type.STRING },
            assignee: { type: Type.STRING },
            deadline: { type: Type.STRING, description: "ISO 8601 date string" },
            confidence: { type: Type.NUMBER },
            isCommitment: { type: Type.BOOLEAN },
            priority: { type: Type.STRING, enum: ["High", "Medium", "Low"] },
            originalMessages: { type: Type.ARRAY, items: { type: Type.STRING } },
            suggestedTask: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                deadline: { type: Type.STRING },
                status: { type: Type.STRING }
              },
              required: ["title", "description", "deadline", "status"]
            }
          },
          required: ["type", "summary", "confidence", "isCommitment", "priority", "originalMessages"]
        }
      }
    }
  });

  console.log("[ChatIntelligence] Gemini response received:", response.text ? "Success" : "Empty");
  if (!response.text) return [];
  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse chat intelligence JSON:", response.text);
    return [];
  }
}
