/**
 * Application entry point — will be fleshed out in later phases.
 * For now, just validates environment on import.
 */

import { env } from "./config/env";

console.log(
  `RazorRecovery backend starting on port ${env.PORT} (environment validated)`
);
