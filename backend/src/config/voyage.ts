import { env } from "./env";

export type EmbeddingInputType = "query" | "document";

interface VoyageEmbeddingResponse {
  data?: Array<{ embedding?: unknown }>;
}

/**
 * Creates a 1024-dimensional float embedding with Voyage's embeddings API.
 * `voyage-3` has a fixed 1024-dimensional output, matching the pgvector
 * column introduced in the Phase 15 migration.
 */
export async function embed(text: string, inputType: EmbeddingInputType): Promise<number[]> {
  if (!env.VOYAGE_API_KEY) {
    throw new Error("VOYAGE_API_KEY is not configured.");
  }

  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: env.VOYAGE_MODEL,
      input_type: inputType,
      output_dtype: "float",
    }),
  });

  if (!response.ok) {
    throw new Error(`Voyage embedding request failed: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as VoyageEmbeddingResponse;
  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Voyage embedding response did not contain a numeric embedding.");
  }
  if (embedding.length !== 1024) {
    throw new Error(`Voyage embedding dimension ${embedding.length} does not match required dimension 1024.`);
  }

  return embedding;
}
