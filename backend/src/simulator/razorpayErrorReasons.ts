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

export function randomRazorpayErrorReason(): RazorpayErrorReason {
  return RAZORPAY_ERROR_REASONS[
    Math.floor(Math.random() * RAZORPAY_ERROR_REASONS.length)
  ];
}
