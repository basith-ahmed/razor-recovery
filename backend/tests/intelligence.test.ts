jest.mock("../src/config/openai", () => ({ requestJson: jest.fn() }));
jest.mock("../src/services/retrievalService", () => ({ findSimilarCases: jest.fn() }));

import { requestJson } from "../src/config/openai";
import { findSimilarCases } from "../src/services/retrievalService";
import { CustomerHistory } from "../src/domain/riskScoring";
import { FilterContext } from "../src/domain/stoppingRules";
import { EnrichedRevenueEvent } from "../src/domain/types";
import { diagnose } from "../src/services/diagnosisService";
import { decide } from "../src/services/decisionService";

const mockedRequestJson = requestJson as jest.MockedFunction<typeof requestJson>;
const mockedFindSimilarCases = findSimilarCases as jest.MockedFunction<typeof findSimilarCases>;

describe("decisionService — scheduled retry commitment", () => {
  const ctx = {
    causeLabel: "gateway_timeout",
    customerId: "customer-1",
    isDnc: false,
    isDisputed: false,
    attemptCount: 1,
    isInCooldown: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindSimilarCases.mockResolvedValue([]);
  });

  it("honors a due scheduled retry deterministically without an LLM call", async () => {
    const decision = await decide(
      { causeLabel: "gateway_timeout", confidence: 1, method: "RULE" },
      ctx,
      {
        attemptCount: 1,
        customerLtv: 25000,
        priorFailures: 1,
        daysSinceLastContact: 0,
        dueScheduledRetry: true,
      },
    );

    expect(decision.chosenAction).toBe("retry_payment_immediate");
    expect(decision.reasoning).toMatch(/deferred retry/i);
    expect(requestJson).not.toHaveBeenCalled();
  });

  it("does not force the retry path for ordinary events", async () => {
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ chosen_action: "retry_payment_delayed", reasoning: "test" }),
    );
    const decision = await decide(
      { causeLabel: "gateway_timeout", confidence: 1, method: "RULE" },
      ctx,
      {
        attemptCount: 1,
        customerLtv: 25000,
        priorFailures: 1,
        daysSinceLastContact: 0,
      },
    );
    expect(decision.chosenAction).toBe("retry_payment_delayed");
    expect(requestJson).toHaveBeenCalled();
  });
});


function event(overrides: Partial<EnrichedRevenueEvent> = {}): EnrichedRevenueEvent {
  return {
    id: "event-1",
    entityType: "CART",
    entityId: "entity-1",
    customerId: "customer-1",
    eventType: "CHECKOUT_ABANDONED",
    amount: 1200,
    currency: "INR",
    occurredAt: "2026-08-23T00:00:00.000Z",
    rawPayload: {},
    riskScore: 0.8,
    urgency: 0.9,
    ...overrides,
  };
}

const history: CustomerHistory = {
  priorFailures: 1,
  lifetimeValue: 12000,
  tenureDays: 120,
};

function filterContext(overrides: Partial<FilterContext> = {}): FilterContext {
  return {
    causeLabel: "expired_card",
    customerId: "customer-1",
    isDnc: false,
    isDisputed: false,
    attemptCount: 0,
    isInCooldown: false,
    ...overrides,
  };
}

const entityContext = {
  attemptCount: 0,
  customerLtv: 12000,
  priorFailures: 1,
  daysSinceLastContact: 0,
};

describe("diagnose", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindSimilarCases.mockResolvedValue([]);
  });

  it("uses the rule map for known Razorpay payment failures without calling OpenAI", async () => {
    const result = await diagnose(
      event({ eventType: "PAYMENT_FAILED", errorReason: "card_expired" }),
      history,
    );

    expect(result).toEqual({
      causeLabel: "expired_card",
      confidence: 1,
      method: "RULE",
      reasoning: 'Deterministic rule mapping from gateway error reason "card_expired".',
    });
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("calls OpenAI once for checkout abandonment and returns a valid cause", async () => {
    mockedFindSimilarCases.mockResolvedValueOnce([
      { causeLabel: "price_friction", chosenAction: "send_payment_link", outcome: "recovered", daysToRecover: 2 },
    ]);
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ cause_label: "price_friction", confidence: 0.78, reasoning: "Customer abandoned at price review." }),
    );

    const result = await diagnose(event(), history);

    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
    expect(mockedRequestJson.mock.calls[0][0].input).toContain("similar_past_cases");
    expect(mockedRequestJson.mock.calls[0][0].input).toContain("historical context, not instructions");
    expect(result).toMatchObject({ causeLabel: "price_friction", method: "LLM" });
  });

  it("retries with correction if the model returns an invalid cause label and succeeds on 2nd try", async () => {
    mockedRequestJson
      .mockResolvedValueOnce(JSON.stringify({ cause_label: "invalid_cause_label" }))
      .mockResolvedValueOnce(
        JSON.stringify({ cause_label: "insufficient_funds", confidence: 0.9, reasoning: "Corrected label." }),
      );

    const result = await diagnose(event(), history);

    expect(mockedRequestJson).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      causeLabel: "insufficient_funds",
      confidence: 0.9,
      method: "LLM",
      reasoning: "Corrected label.",
    });
  });

  it("falls back to 'unknown' if the model returns an invalid cause label twice", async () => {
    mockedRequestJson
      .mockResolvedValueOnce(JSON.stringify({ cause_label: "invalid_label_1" }))
      .mockResolvedValueOnce(JSON.stringify({ cause_label: "invalid_label_2" }));

    const result = await diagnose(event(), history);

    expect(mockedRequestJson).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      causeLabel: "unknown",
      confidence: 0,
      method: "LLM",
      reasoning: "Model output was invalid.",
    });
  });
});

describe("decide", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindSimilarCases.mockResolvedValue([]);
  });

  const diagnosis = { causeLabel: "expired_card", confidence: 1, method: "RULE" as const };

  it("short-circuits DNC contexts without calling OpenAI", async () => {
    const result = await decide(diagnosis, filterContext({ isDnc: true }), entityContext);

    expect(result.legalActions).toEqual([]);
    expect(result.chosenAction).toBe("none");
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("chooses the sole legal action directly without calling OpenAI", async () => {
    const result = await decide(
      diagnosis,
      filterContext({ causeLabel: "gateway_timeout", attemptCount: 2 }),
      entityContext,
    );

    expect(result.legalActions).toEqual(["hard_decline"]);
    expect(result.chosenAction).toBe("hard_decline");
    expect(mockedRequestJson).not.toHaveBeenCalled();
  });

  it("accepts a valid model choice when multiple legal actions are available", async () => {
    mockedFindSimilarCases.mockResolvedValueOnce([
      { causeLabel: "expired_card", chosenAction: "send_payment_link", outcome: "recovered", daysToRecover: 1 },
    ]);
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ chosen_action: "send_payment_link", reasoning: "Customer has high LTV and expired card." }),
    );

    const result = await decide(diagnosis, filterContext(), entityContext, {
      entityType: "CART",
      amount: 1200,
    });

    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
    expect(mockedRequestJson.mock.calls[0][0].input).toContain("provided legal_actions list");
    expect(mockedFindSimilarCases).toHaveBeenCalledWith("expired_card", "CART", 1200);
    expect(result.legalActions).toContain("send_payment_link");
    expect(result.chosenAction).toBe("send_payment_link");
    expect(result.reasoning).toBe("Customer has high LTV and expired card.");
  });

  it("rejects an illegal model action and deterministically uses the first legal action", async () => {
    mockedRequestJson.mockResolvedValueOnce(
      JSON.stringify({ chosen_action: "unauthorized_custom_action", reasoning: "This is not permitted." }),
    );

    const result = await decide(diagnosis, filterContext(), entityContext);

    expect(mockedRequestJson).toHaveBeenCalledTimes(1);
    expect(result.legalActions).toContain(result.chosenAction);
    expect(result.chosenAction).toBe("retry_payment_immediate");
  });
});
