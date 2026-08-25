/**
 * Entity workflow state machine — pure transition function plus guard table.
 * No I/O, no network calls.
 *
 * Terminal states: RECOVERED, WRITTEN_OFF, DO_NOT_CONTACT — zero outgoing transitions.
 * Every entity provably reaches a terminal state or stays in a legally reachable
 * non-terminal one, never an undefined state.
 */

export type WorkflowState =
  | "DETECTED"
  | "CONTACTED"
  | "RETRYING"
  | "COOLING_DOWN"
  | "ESCALATED"
  | "RECOVERED"
  | "WRITTEN_OFF"
  | "DO_NOT_CONTACT";

const ALLOWED_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  // DETECTED can go straight to WRITTEN_OFF (hard_decline on first touch when
  // attempt budgets are already exhausted) or COOLING_DOWN
  // (pause_subscription on first touch).
  DETECTED: [
    "CONTACTED",
    "RETRYING",
    "COOLING_DOWN",
    "DO_NOT_CONTACT",
    "ESCALATED",
    "WRITTEN_OFF",
  ],
  CONTACTED: [
    "CONTACTED",
    "RETRYING",
    "COOLING_DOWN",
    "RECOVERED",
    "ESCALATED",
    "WRITTEN_OFF",
    "DO_NOT_CONTACT",
  ],
  RETRYING: [
    "RETRYING",
    "COOLING_DOWN",
    "RECOVERED",
    "ESCALATED",
    "WRITTEN_OFF",
    "DO_NOT_CONTACT",
  ],
  COOLING_DOWN: [
    "COOLING_DOWN",
    "RETRYING",
    "CONTACTED",
    "ESCALATED",
    "WRITTEN_OFF",
    "DO_NOT_CONTACT",
  ],
  ESCALATED: ["RECOVERED", "WRITTEN_OFF"],
  RECOVERED: [],
  WRITTEN_OFF: [],
  DO_NOT_CONTACT: [],
};

export function canTransition(
  from: WorkflowState,
  to: WorkflowState
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Terminal states close one recovery ARC for an entity. For recurring entities
 * (e.g. subscriptions) a later billing cycle starts a NEW arc: callers treat a
 * new event on a terminal-state entity as beginning again from DETECTED.
 */
export function isTerminal(state: WorkflowState): boolean {
  return ALLOWED_TRANSITIONS[state].length === 0;
}

/**
 * Maps an action outcome string to the next WorkflowState.
 * Throws if the resulting transition is not in ALLOWED_TRANSITIONS.
 */
export function nextState(
  current: WorkflowState,
  actionOutcome: string
): WorkflowState {
  const target = outcomeToState(actionOutcome);

  if (!canTransition(current, target)) {
    throw new Error(
      `Illegal transition: ${current} → ${target} (outcome: "${actionOutcome}")`
    );
  }

  return target;
}

/**
 * Pure mapping from action outcome strings to target WorkflowStates.
 */
function outcomeToState(outcome: string): WorkflowState {
  switch (outcome) {
    case "retry_success":
      return "RECOVERED";
    case "retry_failed":
      return "COOLING_DOWN";
    case "retry_initiated":
      return "RETRYING";
    case "email_sent":
      return "CONTACTED";
    case "payment_link_sent":
      return "CONTACTED";
    case "reminder_sent":
      return "CONTACTED";
    case "dunning_sent":
      return "CONTACTED";
    case "cooldown_started":
      return "COOLING_DOWN";
    case "cooldown_ended":
      return "RETRYING";
    case "escalation_triggered":
      return "ESCALATED";
    case "hard_decline":
      return "WRITTEN_OFF";
    case "auto_cancel":
      return "WRITTEN_OFF";
    case "written_off":
      return "WRITTEN_OFF";
    case "dnc_skip":
      return "DO_NOT_CONTACT";
    case "recovered":
      return "RECOVERED";
    case "payment_confirmed":
      return "RECOVERED";
    case "winback_sent":
      return "CONTACTED";
    case "subscription_paused":
      return "COOLING_DOWN";
    default:
      throw new Error(`Unknown action outcome: "${outcome}"`);
  }
}

/**
 * Expose ALLOWED_TRANSITIONS for testing.
 */
export function getAllowedTransitions(): Record<
  WorkflowState,
  WorkflowState[]
> {
  return { ...ALLOWED_TRANSITIONS };
}
