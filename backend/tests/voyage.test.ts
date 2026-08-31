jest.mock("../src/config/env", () => ({
  env: { VOYAGE_API_KEY: "test-voyage-key", VOYAGE_MODEL: "voyage-3" },
}));

import { embed } from "../src/config/voyage";

describe("Voyage embeddings client", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("uses Voyage's document/query API contract and validates 1024 dimensions", async () => {
    const vector = Array(1024).fill(0.1);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: vector }] }),
    }) as typeof fetch;

    await expect(embed("completed invoice case", "document")).resolves.toEqual(vector);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.voyageai.com/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-voyage-key" }),
        body: JSON.stringify({
          input: "completed invoice case",
          model: "voyage-3",
          input_type: "document",
          output_dtype: "float",
        }),
      }),
    );
  });

  it("rejects a response whose dimension cannot be stored in vector(1024)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
    }) as typeof fetch;

    await expect(embed("query", "query")).rejects.toThrow("does not match required dimension 1024");
  });
});
