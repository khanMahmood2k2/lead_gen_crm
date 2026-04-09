import { onRequest } from "firebase-functions/v2/https";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as functions from "firebase-functions";

// Types
interface LeadQualificationResult {
  is_lead: boolean;
  dm: string;
  confidence?: number;
  reason?: string;
}

// Initialize Gemini with environment variable (configure via Firebase)
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// Lead qualification AI function
export const qualifyLead = onRequest(
  { cors: true, timeoutSeconds: 60 },
  async (request, response) => {
    // Validate request
    if (!request.body || !request.body.content) {
      response.status(400).json({
        error: "Missing 'content' field in request body",
      });
      return;
    }

    const postContent = request.body.content as string;
    const niche = request.body.niche || "general";

    if (postContent.length > 5000) {
      response.status(400).json({
        error: "Content too long (max 5000 characters)",
      });
      return;
    }

    try {
      const result = await generateLeadQualification(postContent, niche);
      response.status(200).json(result);
    } catch (error) {
      functions.logger.error("Lead qualification error:", error);
      response.status(500).json({
        error: "Failed to qualify lead",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// Generate AI-powered DM for a lead
export const generateDM = onRequest(
  { cors: true, timeoutSeconds: 60 },
  async (request, response) => {
    // Validate request
    if (!request.body || !request.body.lead_content) {
      response.status(400).json({
        error: "Missing 'lead_content' field in request body",
      });
      return;
    }

    const leadContent = request.body.lead_content as string;
    const authorUsername = request.body.author_username || "User";

    try {
      const dm = await generatePersonalizedDM(leadContent, authorUsername);
      response.status(200).json({
        success: true,
        dm: dm,
      });
    } catch (error) {
      functions.logger.error("DM generation error:", error);
      response.status(500).json({
        error: "Failed to generate DM",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// Health check endpoint
export const healthCheck = onRequest(async (request, response) => {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    await model.generateContent("Say hi");
    response.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    response.status(503).json({
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// --- Helper Functions ---

/**
 * Determine if content represents a lead and generate an outreach message
 */
async function generateLeadQualification(
  content: string,
  niche: string
): Promise<LeadQualificationResult> {
  const prompt = `
You are an expert lead qualification bot specializing in ${niche}.
Analyze this content and determine if it represents a potential lead for outreach.

Content: "${content}"

Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "is_lead": boolean,
  "confidence": number (0-100),
  "reason": "brief explanation",
  "dm": "if is_lead=true, provide a short, friendly outreach message (max 150 chars); otherwise empty string"
}

Be concise and compelling.`;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse JSON response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Invalid JSON response from AI");
    }

    const parsed = JSON.parse(jsonMatch[0]) as LeadQualificationResult;
    return parsed;
  } catch (error) {
    functions.logger.error("Generation error in generateLeadQualification:", error);
    throw error;
  }
}

/**
 * Generate a personalized DM for a specific lead
 */
async function generatePersonalizedDM(
  leadContent: string,
  authorUsername: string
): Promise<string> {
  const prompt = `
You are a professional outreach copywriter.
Write a short, personalized, and friendly Direct Message to reach out to this person.

Their username: ${authorUsername}
Their content: "${leadContent}"

Requirements:
- Keep it under 150 characters
- Be genuine and not spammy
- Reference something specific from their content
- Include a clear call-to-action

Provide ONLY the DM text, nothing else.`;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    const dm = result.response.text().trim();

    if (dm.length > 200) {
      return dm.substring(0, 197) + "...";
    }

    return dm;
  } catch (error) {
    functions.logger.error("Generation error in generatePersonalizedDM:", error);
    throw error;
  }
}

// Legacy endpoint for backwards compatibility
export const testLeadFilter = onRequest(async (request, response) => {
  const fakeRedditPost = `
    Title: Looking for a mobile app developer for my startup
    Body: Hey guys, I have a great idea for a streak-tracking app and I need someone 
    who knows Flutter and Firebase to help me build it. Budget is flexible.
  `;

  try {
    const result = await generateLeadQualification(
      fakeRedditPost,
      "mobile development"
    );
    response.status(200).json(result);
  } catch (error) {
    functions.logger.error("Test lead filter error:", error);
    response.status(500).json({
      error: "Something went wrong with the AI.",
    });
  }
});
