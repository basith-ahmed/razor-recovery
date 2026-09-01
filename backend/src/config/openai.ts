import OpenAI from "openai";
import { env } from "./env";

/**
 * Single LLM boundary used by the intelligence services (diagnosis, decision,
 * email copy). Points at any OpenAI-compatible Chat Completions endpoint —
 * currently OpenRouter — configured via LLM_BASE_URL / LLM_API_KEY / LLM_MODEL.
 */
const openai = new OpenAI({
  apiKey: env.LLM_API_KEY,
  baseURL: env.LLM_BASE_URL,
});

export interface JsonRequest {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function statusOf(err: unknown): number | undefined {
  return (err as { status?: unknown } | null)?.status as number | undefined;
}

function messageOf(err: unknown): string {
  const raw =
    err instanceof Error ? err.message : String((err as { message?: unknown }) ?? "");
  const match = raw.match(/\b(4\d\d|5\d\d)\b/);
  return match ? `${raw} [http ${match[1]}]` : raw;
}

function isRateLimited(err: unknown): boolean {
  return statusOf(err) === 429 || /\b429\b/.test(messageOf(err));
}

/** True when the endpoint/model rejected structured outputs outright. */
function rejectsJsonSchema(err: unknown): boolean {
  if (statusOf(err) !== 400 && statusOf(err) !== 422) return false;
  const msg = messageOf(err).toLowerCase();
  return (
    msg.includes("response_format") ||
    msg.includes("json_schema") ||
    msg.includes("structured output")
  );
}

async function chat(
  request: JsonRequest,
  useJsonSchema: boolean,
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: env.LLM_MODEL,
    messages: [
      { role: "system", content: request.instructions },
      { role: "user", content: request.input },
    ],
    ...(useJsonSchema
      ? {
          response_format: {
            type: "json_schema" as const,
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.schema,
            },
          },
        }
      : {}),
  });

  const content = response.choices[0]?.message.content;
  if (typeof content !== "string") {
    throw new Error("LLM returned no text content.");
  }
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (useJsonSchema) {
    // Structured outputs were requested: a non-JSON payload means the endpoint
    // ignored the schema. Treat it as a failed attempt so the retry loop can
    // recover instead of handing garbage to the caller's parser.
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(
        `LLM returned non-JSON content despite schema (excerpt: ${cleaned.slice(0, 120)})`
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        `LLM returned a non-object payload despite schema (excerpt: ${cleaned.slice(0, 120)})`
      );
    }
  }
  return cleaned;
}

/**
 * Requests a JSON string from the LLM. Tries structured outputs first; if the
 * model/endpoint rejects them, degrades once to plain prompting — callers
 * already parse and validate responses defensively. Retries 429s with linear
 * backoff.
 */
export async function requestJson(request: JsonRequest, retries = 3): Promise<string> {
  let useJsonSchema = true;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await chat(request, useJsonSchema);
    } catch (err: unknown) {
      if (useJsonSchema && rejectsJsonSchema(err)) {
        console.warn(
          "[LLM] response_format json_schema rejected by endpoint; retrying without structured outputs.",
        );
        useJsonSchema = false;
        attempt--; // probing capability does not consume a retry
        continue;
      }
      if (isRateLimited(err) && attempt < retries) {
        console.warn(`[LLM] Rate limited (429). Retrying attempt ${attempt}/${retries} after delay...`);
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error("LLM request failed after retries.");
}

/**
 * Requests plain prose text from the LLM without JSON constraints.
 * Retries 429s with linear backoff.
 */
export async function requestText(
  request: { instructions: string; input: string },
  retries = 3,
): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: env.LLM_MODEL,
        messages: [
          { role: "system", content: request.instructions },
          { role: "user", content: request.input },
        ],
      });

      const content = response.choices[0]?.message.content;
      if (typeof content !== "string") {
        throw new Error("LLM returned no text content.");
      }
      return content.trim();
    } catch (err: unknown) {
      if (isRateLimited(err) && attempt < retries) {
        console.warn(`[LLM] Rate limited (429). Retrying attempt ${attempt}/${retries} after delay...`);
        await sleep(2000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error("LLM request failed after retries.");
}
