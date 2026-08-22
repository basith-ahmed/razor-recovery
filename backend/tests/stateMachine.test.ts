/**
 * Tests for stateMachine.ts — pure functions, no mocking needed.
 */

import {
  canTransition,
  nextState,
  getAllowedTransitions,
  WorkflowState,
} from "../src/domain/stateMachine";

describe("stateMachine", () => {
  const TERMINAL_STATES: WorkflowState[] = [
    "RECOVERED",
    "WRITTEN_OFF",
    "DO_NOT_CONTACT",
  ];

  const NON_TERMINAL_STATES: WorkflowState[] = [
    "DETECTED",
    "CONTACTED",
    "RETRYING",
    "COOLING_DOWN",
    "ESCALATED",
  ];

  describe("canTransition", () => {
    it("every terminal state has zero allowed outgoing transitions", () => {
      const transitions = getAllowedTransitions();
      for (const state of TERMINAL_STATES) {
        expect(transitions[state]).toEqual([]);
        expect(transitions[state]).toHaveLength(0);
      }
    });

    it("every non-terminal state has at least one outgoing transition", () => {
      const transitions = getAllowedTransitions();
      for (const state of NON_TERMINAL_STATES) {
        expect(transitions[state].length).toBeGreaterThan(0);
      }
    });

    it("DETECTED can transition to CONTACTED", () => {
      expect(canTransition("DETECTED", "CONTACTED")).toBe(true);
    });

    it("DETECTED can transition to RETRYING", () => {
      expect(canTransition("DETECTED", "RETRYING")).toBe(true);
    });

    it("DETECTED can transition to DO_NOT_CONTACT", () => {
      expect(canTransition("DETECTED", "DO_NOT_CONTACT")).toBe(true);
    });

    it("DETECTED can transition to ESCALATED", () => {
      expect(canTransition("DETECTED", "ESCALATED")).toBe(true);
    });

    it("DETECTED cannot transition to RECOVERED", () => {
      expect(canTransition("DETECTED", "RECOVERED")).toBe(false);
    });

    it("CONTACTED can transition to RECOVERED", () => {
      expect(canTransition("CONTACTED", "RECOVERED")).toBe(true);
    });

    it("ESCALATED can transition to RECOVERED or WRITTEN_OFF only", () => {
      expect(canTransition("ESCALATED", "RECOVERED")).toBe(true);
      expect(canTransition("ESCALATED", "WRITTEN_OFF")).toBe(true);
      expect(canTransition("ESCALATED", "RETRYING")).toBe(false);
      expect(canTransition("ESCALATED", "CONTACTED")).toBe(false);
    });

    it("RECOVERED cannot transition to anything", () => {
      const all: WorkflowState[] = [
        ...TERMINAL_STATES,
        ...NON_TERMINAL_STATES,
      ];
      for (const target of all) {
        expect(canTransition("RECOVERED", target)).toBe(false);
      }
    });

    it("WRITTEN_OFF cannot transition to anything", () => {
      const all: WorkflowState[] = [
        ...TERMINAL_STATES,
        ...NON_TERMINAL_STATES,
      ];
      for (const target of all) {
        expect(canTransition("WRITTEN_OFF", target)).toBe(false);
      }
    });

    it("DO_NOT_CONTACT cannot transition to anything", () => {
      const all: WorkflowState[] = [
        ...TERMINAL_STATES,
        ...NON_TERMINAL_STATES,
      ];
      for (const target of all) {
        expect(canTransition("DO_NOT_CONTACT", target)).toBe(false);
      }
    });
  });

  describe("nextState", () => {
    it("retry_success from RETRYING → RECOVERED", () => {
      expect(nextState("RETRYING", "retry_success")).toBe("RECOVERED");
    });

    it("retry_failed from RETRYING → COOLING_DOWN", () => {
      expect(nextState("RETRYING", "retry_failed")).toBe("COOLING_DOWN");
    });

    it("retry_initiated from DETECTED → RETRYING", () => {
      expect(nextState("DETECTED", "retry_initiated")).toBe("RETRYING");
    });

    it("email_sent from DETECTED → CONTACTED", () => {
      expect(nextState("DETECTED", "email_sent")).toBe("CONTACTED");
    });

    it("escalation_triggered from CONTACTED → ESCALATED", () => {
      expect(nextState("CONTACTED", "escalation_triggered")).toBe("ESCALATED");
    });

    it("hard_decline from RETRYING → WRITTEN_OFF", () => {
      expect(nextState("RETRYING", "hard_decline")).toBe("WRITTEN_OFF");
    });

    it("dnc_skip from DETECTED → DO_NOT_CONTACT", () => {
      expect(nextState("DETECTED", "dnc_skip")).toBe("DO_NOT_CONTACT");
    });

    it("cooldown_ended from COOLING_DOWN → RETRYING", () => {
      expect(nextState("COOLING_DOWN", "cooldown_ended")).toBe("RETRYING");
    });

    it("recovered from ESCALATED → RECOVERED", () => {
      expect(nextState("ESCALATED", "recovered")).toBe("RECOVERED");
    });

    it("payment_confirmed from CONTACTED → RECOVERED", () => {
      expect(nextState("CONTACTED", "payment_confirmed")).toBe("RECOVERED");
    });

    it("auto_cancel from RETRYING → WRITTEN_OFF", () => {
      expect(nextState("RETRYING", "auto_cancel")).toBe("WRITTEN_OFF");
    });

    it("subscription_paused from CONTACTED → COOLING_DOWN", () => {
      expect(nextState("CONTACTED", "subscription_paused")).toBe(
        "COOLING_DOWN"
      );
    });

    // --- Illegal transitions ---

    it("illegal transition RECOVERED → RETRYING throws", () => {
      expect(() => nextState("RECOVERED", "retry_initiated")).toThrow(
        /Illegal transition/
      );
    });

    it("illegal transition WRITTEN_OFF → CONTACTED throws", () => {
      expect(() => nextState("WRITTEN_OFF", "email_sent")).toThrow(
        /Illegal transition/
      );
    });

    it("illegal transition DO_NOT_CONTACT → RETRYING throws", () => {
      expect(() => nextState("DO_NOT_CONTACT", "retry_initiated")).toThrow(
        /Illegal transition/
      );
    });

    it("unknown action outcome throws", () => {
      expect(() => nextState("DETECTED", "totally_unknown_outcome")).toThrow(
        /Unknown action outcome/
      );
    });

    it("illegal transition DETECTED → RECOVERED throws", () => {
      expect(() => nextState("DETECTED", "retry_success")).toThrow(
        /Illegal transition/
      );
    });
  });
});
