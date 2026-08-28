import {
  buildCaseSummaryText,
  bucketAmount,
  TERMINAL_AUDIT_OUTCOMES,
} from "../src/services/embeddingService";

describe("Phase 15 case summary helpers", () => {
  it("uses stable amount buckets and a compact searchable case summary", () => {
    expect(bucketAmount(499)).toBe("under_500");
    expect(bucketAmount(500)).toBe("500_to_2000");
    expect(bucketAmount(2_000)).toBe("2000_to_10000");
    expect(bucketAmount(10_000)).toBe("over_10000");
    expect(
      buildCaseSummaryText({
        causeLabel: "insufficient_funds",
        entityType: "INVOICE",
        amount: 3_500,
        chosenAction: "send_payment_link",
        outcome: "recovered",
        daysToRecover: 2,
      }),
    ).toBe(
      "cause=insufficient_funds, entity_type=INVOICE, amount_bucket=2000_to_10000, action=send_payment_link, outcome=recovered, days_to_recover=2",
    );
  });

  it("only treats completed recovery arcs as indexable", () => {
    expect(TERMINAL_AUDIT_OUTCOMES.has("recovered")).toBe(true);
    expect(TERMINAL_AUDIT_OUTCOMES.has("written_off")).toBe(true);
    expect(TERMINAL_AUDIT_OUTCOMES.has("escalated")).toBe(true);
    expect(TERMINAL_AUDIT_OUTCOMES.has("pending")).toBe(false);
  });
});
