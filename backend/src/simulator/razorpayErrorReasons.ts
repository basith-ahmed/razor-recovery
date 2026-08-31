/**
 * Razorpay payment failure values used by the offline simulator.
 *
 * Source: https://razorpay.com/docs/errors/payments/list/ and
 * https://razorpay.com/docs/api/payments/entity/ (verified 2026-08-23).
 * The payment entity exposes these as error_code, error_description and
 * error_reason on failed payments.
 */
export interface RazorpayErrorReason {
  errorCode: "BAD_REQUEST_ERROR" | "GATEWAY_ERROR";
  errorDescription: string;
  errorReason: string;
  errorSource: "customer" | "gateway" | "razorpay";
  errorStep:
    | "payment_authentication"
    | "payment_authorization"
    | "payment_processing";
}

export const RAZORPAY_ERROR_REASONS: readonly RazorpayErrorReason[] = [
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "insufficient_fund",
    errorDescription:
      "Your payment could not be completed due to insufficient account balance. Try another card or payment method.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "payment_timed_out",
    errorDescription:
      "The customer did not complete the transaction within the specified time.",
    errorSource: "customer",
    errorStep: "payment_authentication",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "card_expired",
    errorDescription: "The card has expired.",
    errorSource: "customer",
    errorStep: "payment_authentication",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "incorrect_card_details",
    errorDescription: "Incorrect card details entered.",
    errorSource: "customer",
    errorStep: "payment_authentication",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "incorrect_otp",
    errorDescription:
      "The customer has entered an incorrect OTP to complete the payment.",
    errorSource: "customer",
    errorStep: "payment_authentication",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "payment_cancelled",
    errorDescription: "The customer explicitly cancelled the payment.",
    errorSource: "customer",
    errorStep: "payment_authentication",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "payment_declined",
    errorDescription: "The payment has been declined.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "invalid_vpa",
    errorDescription:
      "The customer has entered an incorrect VPA to complete the payment.",
    errorSource: "customer",
    errorStep: "payment_authentication",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "payment_risk_check_failed",
    errorDescription: "Payment declined due to risk checks.",
    errorSource: "gateway",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "GATEWAY_ERROR",
    errorReason: "payment_failed",
    errorDescription:
      "Payment processing failed due to an error at the bank or wallet gateway.",
    errorSource: "gateway",
    errorStep: "payment_processing",
  },
  {
    errorCode: "GATEWAY_ERROR",
    errorReason: "gateway_technical_error",
    errorDescription:
      "There was a downtime at the partner bank, so the payment failed.",
    errorSource: "gateway",
    errorStep: "payment_processing",
  },
] as const;

export const RAZORPAY_MANDATE_ERROR_REASONS: readonly RazorpayErrorReason[] = [
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "mandate_cancelled",
    errorDescription:
      "The UPI Autopay mandate was cancelled by the customer via their UPI app or bank portal.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "mandate_revoked",
    errorDescription:
      "The mandate was revoked by the payer using their TPAP UPI application.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "mandate_rejected",
    errorDescription:
      "The mandate creation request was rejected by the customer during UPI authorization.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "mandate_paused",
    errorDescription:
      "The mandate is currently paused by the payer and cannot accept debit requests.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "mandate_expired",
    errorDescription:
      "The mandate validity end date has passed. Re-authorization is required.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "mandate_creation_failed",
    errorDescription:
      "Mandate creation failed. The customer should retry or use a different payment method.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "subscription_halted",
    errorDescription:
      "The subscription has been halted after all automated retry attempts were exhausted.",
    errorSource: "customer",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "BAD_REQUEST_ERROR",
    errorReason: "invalid_umn",
    errorDescription:
      "The specified Unique Mandate Number (UMN) was not found or is invalid.",
    errorSource: "gateway",
    errorStep: "payment_authorization",
  },
  {
    errorCode: "GATEWAY_ERROR",
    errorReason: "mandate_debit_failed",
    errorDescription:
      "Automated mandate debit execution failed due to a bank gateway timeout. Retryable.",
    errorSource: "gateway",
    errorStep: "payment_processing",
  },
  {
    errorCode: "GATEWAY_ERROR",
    errorReason: "mandate_execution_failed",
    errorDescription:
      "Transient mandate execution failure at the destination bank.",
    errorSource: "gateway",
    errorStep: "payment_processing",
  },
] as const;

export function randomRazorpayErrorReason(): RazorpayErrorReason {
  return RAZORPAY_ERROR_REASONS[
    Math.floor(Math.random() * RAZORPAY_ERROR_REASONS.length)
  ];
}

export function randomRazorpayMandateErrorReason(): RazorpayErrorReason {
  return RAZORPAY_MANDATE_ERROR_REASONS[
    Math.floor(Math.random() * RAZORPAY_MANDATE_ERROR_REASONS.length)
  ];
}
