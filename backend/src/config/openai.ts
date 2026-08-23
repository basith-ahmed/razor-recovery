import OpenAI from "openai";
import { env } from "./env";

const openai = new OpenAI({
  apiKey: env.GEMINI_API_KEY,
  baseURL: env.GEMINI_BASE_URL,
});

export interface JsonRequest {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

/**
 * The only Gemini boundary used by the intelligence services. Gemini exposes
 * an OpenAI-compatible Chat Completions endpoint, so this retains the OpenAI
 * SDK while sending requests with Gemini credentials to Gemini's base URL.
 */
export async function requestJson(request: JsonRequest, retries = 3): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: env.GEMINI_MODEL,
        messages: [
          { role: "system", content: request.instructions },
          { role: "user", content: request.input },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
      });

      const content = response.choices[0]?.message.content;
      if (typeof content !== "string") {
        throw new Error("Gemini returned no text content.");
      }
      return content;
    } catch (err: any) {
      if ((err?.status === 429 || err?.code === 429 || err?.message?.includes("429")) && attempt < retries) {
        console.warn(`[Gemini] Rate limited (429). Retrying attempt ${attempt}/${retries} after delay...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed after retries.");
}
