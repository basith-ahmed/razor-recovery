import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({
  path: "../.env",
  override: true,
});

console.log({
  cwd: process.cwd(),
  hasKey: !!process.env.LLM_API_KEY,
  keyPrefix: process.env.LLM_API_KEY?.slice(0, 10),
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
});

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().url(),

  // Kafka / Redpanda
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_CLIENT_ID: z.string().min(1),

  // Razorpay (Test Mode)
  RAZORPAY_KEY_ID: z.string().min(1),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1),

  // Gemini API, accessed through the OpenAI-compatible SDK endpoint
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().default("gemini-3.7-flash"),
  LLM_BASE_URL: z
    .string()
    .url()
    .default("https://generativelanguage.googleapis.com/v1beta/openai/"),

  // Email (Mailhog)
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_FROM: z.string().min(1),

  // Backend server
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  • ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    console.error(
      `\nMissing or invalid environment variables:\n${formatted}\n`
    );
    console.error("Hint: copy .env.example to .env and fill in the values.\n");
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
