import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  SAAS_WEB_URL: z.string().url().default("http://localhost:5173"),
  SAAS_ALLOWED_ORIGINS: z.string().default("http://localhost:5173"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: z.string().default("false"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default("Fine Dine <no-reply@example.com>"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid SaaS environment: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
}

export const config = {
  ...parsed.data,
  allowedOrigins: parsed.data.SAAS_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  smtpConfigured: Boolean(parsed.data.SMTP_HOST && parsed.data.SMTP_USER && parsed.data.SMTP_PASSWORD),
};

if (config.NODE_ENV === "production") {
  if (!config.smtpConfigured) throw new Error("SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required in production.");
  if (!config.SAAS_WEB_URL.startsWith("https://")) throw new Error("SAAS_WEB_URL must use HTTPS in production.");
  if (!config.DATABASE_URL.startsWith("postgres")) throw new Error("DATABASE_URL must point to PostgreSQL.");
}
