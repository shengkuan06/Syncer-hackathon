import { GoogleGenAI, Type } from "@google/genai";
import { Task, ExtractedData } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function extractTasks(
  input: string,
  additionalPrompt: string,
  files?: { mimeType: string; data: string }[]
): Promise<ExtractedData> {
  const model = "gemini-3-flash-preview";

  const prompt = `
    You are the "Syncer Intelligence Engine". 
    Analyze the provided input (text and/or files) to extract tasks.
    
    LINGUISTIC FLUENCY (CRITICAL):
    - You are an expert in Malaysian/Singaporean multilingual communication.
    - You MUST accurately process audio and text in English, Chinese (Mandarin/Cantonese/Hokkien), and Malay.
    - You MUST handle "Code-Switching" (mixing multiple languages in one sentence) seamlessly.
    - Focus on the intent and action items regardless of the language used.
    
    SPECIAL CONTEXT:
    - If the input looks like a "UMSpectrum" (Moodle) Dashboard screenshot or text:
      - Look for Course Codes (e.g., WIX1001, GIG1012).
      - Identify "Activities" like Assignments, Quizzes, or Forums.
      - Extract deadlines from the "Timeline" or "Upcoming Events" section.
      - Map "Course Name" to the task description or title prefix.
    
    CRITICAL LOGIC:
    1. CATEGORIZE: Identify if the input is an "Assignment", "Tutorial", or "Other".
    2. SPLITTING STRATEGY:
       - If ASSIGNMENT: 
         - Break it down into logical, smaller sub-tasks (e.g., Research, Drafting, Final Review).
         - DEADLINE SCHEDULING (MANDATORY): 
           - Task 1 deadline MUST be 5 days from the current date (${new Date().toISOString()}).
           - Each subsequent task (Task 2, Task 3, etc.) MUST have a deadline exactly 5 days after the previous task's deadline.
           - The VERY LAST task's deadline MUST be exactly the overall deadline of the assignment extracted from the source.
       - If TUTORIAL: Do NOT break it down. Treat the tutorial as a single actionable task.
       - If OTHER: Analyze if the task is complex enough to need splitting. If it's simple, keep it as one.
    3. GOAL: Prevent over-splitting. Only create multiple tasks if it truly helps the user manage a complex project.

    Extract:
    1. A list of actionable tasks with titles, descriptions, and deadlines.
    2. A logical project roadmap.
    3. A gap analysis identifying missing info or risks.
    4. The CATEGORY (Assignment, Tutorial, or Other).
    5. A concise SOURCE SUMMARY (max 500 words) of the tutorial/assignment content to be used as a reference.

    Additional User Requirements: ${additionalPrompt}

    Rules:
    - If no overall assignment deadline is found, assume it is 30 days from now.
    - For sub-tasks of an assignment, strictly follow the 5-day incremental rule starting from 5 days from now.
    - The final sub-task MUST align with the actual assignment deadline.
    - Output MUST be in JSON format matching the schema.
  `;

  const contents: any[] = [{ text: prompt }, { text: `Input Context: ${input}` }];
  
  if (files) {
    files.forEach(file => {
      contents.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data
        }
      });
    });
  }

  const response = await ai.models.generateContent({
    model,
    contents: { parts: contents },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                deadline: { type: Type.STRING, description: "ISO 8601 date string" },
                status: { type: Type.STRING }
              },
              required: ["title", "description", "deadline", "status"]
            }
          },
          roadmap: { type: Type.STRING },
          gapAnalysis: { type: Type.STRING },
          category: { type: Type.STRING, enum: ["Assignment", "Tutorial", "Other"] },
          sourceSummary: { type: Type.STRING }
        },
        required: ["tasks", "roadmap", "gapAnalysis", "category", "sourceSummary"]
      }
    }
  });

  if (!response.text) {
    console.error("Gemini returned an empty response.");
    throw new Error("Empty response from AI engine.");
  }

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini JSON:", response.text);
    throw new Error("Invalid format returned from AI engine.");
  }
}
