import {
  canonicalize,
  computeEntryHash,
  GENESIS_HASH,
  HashableEntry,
} from "../src/domain/hashChain";

describe("hashChain domain module", () => {
  it("should have a stable GENESIS_HASH", () => {
    expect(GENESIS_HASH).toBe(
      "d7c09e32ebdfa4ba13e9ef94a91b828552fe899d08ccd52969f4882651343b5d",
    );
  });

  describe("canonicalize", () => {
    it("should sort object keys alphabetically and produce identical string", () => {
      const objA = { z: 1, a: 2, m: { y: "hello", x: "world" } };
      const objB = { a: 2, m: { x: "world", y: "hello" }, z: 1 };
      expect(canonicalize(objA)).toBe(canonicalize(objB));
      expect(canonicalize(objA)).toBe('{"a":2,"m":{"x":"world","y":"hello"},"z":1}');
    });

    it("should preserve array ordering while sorting object keys inside arrays", () => {
      const arr1 = [{ b: 1, a: 2 }, { d: 4, c: 3 }];
      const arr2 = [{ a: 2, b: 1 }, { c: 3, d: 4 }];
      expect(canonicalize(arr1)).toBe(canonicalize(arr2));
      expect(canonicalize(arr1)).toBe('[{"a":2,"b":1},{"c":3,"d":4}]');

      const arrReversed = [{ d: 4, c: 3 }, { b: 1, a: 2 }];
      expect(canonicalize(arr1)).not.toBe(canonicalize(arrReversed));
    });

    it("should handle null, undefined, primitives correctly", () => {
      expect(canonicalize(null)).toBe("null");
      expect(canonicalize(undefined)).toBe("null");
      expect(canonicalize(123)).toBe("123");
      expect(canonicalize("abc")).toBe('"abc"');
      expect(canonicalize(true)).toBe("true");
    });
  });

  describe("computeEntryHash", () => {
    const sampleEntry: HashableEntry = {
      eventId: "evt-123",
      entityId: "ent-456",
      actor: "system",
      inputSnapshot: { amount: 1500, customerId: "cust-1" },
      diagnosisSnapshot: { causeLabel: "insufficient_funds", confidence: 1 },
      decisionSnapshot: { chosenAction: "send_payment_link" },
      actionSnapshot: { result: "success" },
      outcome: "pending",
      timestamp: "2026-08-28T00:00:00.000Z",
    };

    it("should deterministically produce identical hash for same inputs", () => {
      const hash1 = computeEntryHash(GENESIS_HASH, sampleEntry);
      const hash2 = computeEntryHash(GENESIS_HASH, { ...sampleEntry });
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should produce a different hash if any field changes", () => {
      const baseHash = computeEntryHash(GENESIS_HASH, sampleEntry);

      const modifiedOutcome = computeEntryHash(GENESIS_HASH, {
        ...sampleEntry,
        outcome: "recovered",
      });
      expect(modifiedOutcome).not.toBe(baseHash);

      const modifiedActor = computeEntryHash(GENESIS_HASH, {
        ...sampleEntry,
        actor: "human_agent",
      });
      expect(modifiedActor).not.toBe(baseHash);

      const modifiedTimestamp = computeEntryHash(GENESIS_HASH, {
        ...sampleEntry,
        timestamp: "2026-08-28T00:00:01.000Z",
      });
      expect(modifiedTimestamp).not.toBe(baseHash);

      const modifiedInput = computeEntryHash(GENESIS_HASH, {
        ...sampleEntry,
        inputSnapshot: { amount: 1501, customerId: "cust-1" },
      });
      expect(modifiedInput).not.toBe(baseHash);
    });

    it("should produce a different hash if prevHash differs", () => {
      const hash1 = computeEntryHash(GENESIS_HASH, sampleEntry);
      const hash2 = computeEntryHash("0000000000000000000000000000000000000000000000000000000000000000", sampleEntry);
      expect(hash1).not.toBe(hash2);
    });
  });
});
