import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import pg from "pg";
import { z } from "zod";
import { config } from "./config.js";
import { sendActionEmail } from "./email.js";
import { clearSessionCookie, hashPassword, hashToken, randomToken, readCookie, sessionCookie, verifyPassword } from "./security.js";

const { Pool } = pg;
const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000 });
const SESSION_COOKIE = "fd_session";
const SESSION_SECONDS = config.SESSION_TTL_DAYS * 24 * 60 * 60;
const EMAIL = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const phone = z.string().trim().max(32).optional();
const addressSchema = z.object({
  addressLine1: z.string().trim().min(3).max(180),
  addressLine2: z.string().trim().max(180).optional(),
  locality: z.string().trim().max(120).optional(),
  city: z.string().trim().min(2).max(100),
  district: z.string().trim().max(100).optional(),
  state: z.string().trim().min(2).max(100),
  stateCode: z.string().trim().max(3).optional(),
  postalCode: z.string().trim().min(3).max(12),
  countryCode: z.string().trim().length(2).default("IN").transform((value) => value.toUpperCase()),
}).superRefine((address, context) => {
  if (address.countryCode === "IN" && !/^\d{6}$/.test(address.postalCode)) {
    context.addIssue({ code: "custom", path: ["postalCode"], message: "Indian PIN codes must contain six digits." });
  }
  if (address.countryCode === "IN" && address.stateCode && !/^\d{2}$/.test(address.stateCode)) {
    context.addIssue({ code: "custom", path: ["stateCode"], message: "Indian state codes must contain two digits." });
  }
});

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: EMAIL,
  phone,
  password: z.string().min(12).max(128),
  business: z.object({
    tradeName: z.string().trim().min(2).max(180),
    registeredBusinessName: z.string().trim().max(180).optional(),
    businessType: z.enum(["restaurant", "cafe", "qsr", "bakery", "cloud_kitchen", "food_truck", "grocery", "retail", "other"]),
    industry: z.string().trim().min(2).max(80).default("food_service"),
    pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).optional(),
    gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional(),
    cin: z.string().trim().max(32).optional(),
    fssaiLicense: z.string().trim().max(32).optional(),
    websiteUrl: z.string().url().max(300).optional(),
    businessEmail: EMAIL.optional(),
    businessPhone: phone,
    address: addressSchema,
  }),
  outlet: z.object({
    name: z.string().trim().min(2).max(180),
    code: z.string().trim().max(40).optional(),
    phone,
    email: EMAIL.optional(),
    address: addressSchema,
    gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).optional(),
    fssaiLicense: z.string().trim().max(32).optional(),
    timezone: z.string().trim().min(3).max(80).default("Asia/Kolkata"),
  }),
  acceptedTerms: z.literal(true),
  termsVersion: z.string().trim().min(1).max(40),
}).superRefine((data, context) => {
  const registrations = [
    { gstin: data.business.gstin, stateCode: data.business.address.stateCode, path: ["business", "gstin"] },
    { gstin: data.outlet.gstin, stateCode: data.outlet.address.stateCode, path: ["outlet", "gstin"] },
  ];
  for (const registration of registrations) {
    if (registration.gstin && registration.stateCode && registration.gstin.slice(0, 2) !== registration.stateCode) {
      context.addIssue({ code: "custom", path: registration.path, message: "GSTIN state prefix must match the address state code." });
    }
  }
});

type SessionUser = { id: string; full_name: string; email: string; phone: string | null; organization_id: string; role: string };

function success(data: unknown) { return { success: true, data }; }
function failure(code: string, message: string) { return { success: false, error: { code, message } }; }
function slugify(value: string): string {
  const base = value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
  return `${base || "business"}-${randomToken(4).toLowerCase()}`;
}
function publicBaseUrl(): string { return config.SAAS_WEB_URL.replace(/\/+$/, ""); }
function setSession(reply: FastifyReply, token: string): void {
  reply.header("set-cookie", sessionCookie(token, SESSION_SECONDS, config.NODE_ENV === "production"));
}
function clearSession(reply: FastifyReply): void {
  reply.header("set-cookie", clearSessionCookie(config.NODE_ENV === "production"));
}

async function currentUser(request: FastifyRequest): Promise<SessionUser | null> {
  const token = readCookie(request.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const result = await pool.query<SessionUser>(
    `SELECT u.id, u.full_name, u.email, u.phone, om.organization_id, om.role
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     JOIN organization_members om ON om.user_id = u.id AND om.role IN ('owner','admin','manager','billing')
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
       AND u.status = 'active' AND u.email_verified_at IS NOT NULL
     ORDER BY om.joined_at NULLS FIRST LIMIT 1`,
    [hashToken(token)],
  );
  if (!result.rows[0]) return null;
  await pool.query("UPDATE user_sessions SET last_seen_at = now() WHERE token_hash = $1", [hashToken(token)]);
  return result.rows[0];
}

async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null> {
  const user = await currentUser(request);
  if (!user) {
    reply.code(401).send(failure("UNAUTHENTICATED", "Please sign in to continue."));
    return null;
  }
  return user;
}

async function issueAuthToken(userId: string, purpose: "email_verification" | "password_reset", ttlHours: number): Promise<string> {
  const token = randomToken(32);
  await pool.query(
    "UPDATE user_auth_tokens SET consumed_at=now() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL",
    [userId, purpose],
  );
  await pool.query(
    "INSERT INTO user_auth_tokens(user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3,now() + ($4 * interval '1 hour'))",
    [userId, purpose, hashToken(token), ttlHours],
  );
  return token;
}

export function buildSaasApp(): FastifyInstance {
  const app = Fastify({ logger: true, bodyLimit: 64 * 1024 });
  app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || config.allowedOrigins.includes(origin)),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["content-type", "idempotency-key"],
  });
  app.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      reply.code(403).send(failure("ORIGIN_FORBIDDEN", "This request origin is not allowed."));
    }
  });

  app.get("/health", async () => success({ status: "ok" }));

  app.post("/api/v1/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(failure("VALIDATION_ERROR", "Please check the registration details."));
    const body = parsed.data;
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) {
      return reply.code(400).send(failure("IDEMPOTENCY_KEY_REQUIRED", "Send a valid Idempotency-Key header."));
    }
    const requestHash = hashToken(JSON.stringify(body));
    const client = await pool.connect();
    let userId: string;
    let verifyToken: string;
    const registrationResponse = success({ message: "Registration received. Check your inbox for the verification link." });
    try {
      await client.query("BEGIN");
      const reservation = await client.query<{ id: string }>(
        "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,expires_at) VALUES('auth.register',$1,$2,now()+interval '24 hours') ON CONFLICT(scope,idempotency_key) DO NOTHING RETURNING id",
        [idempotencyKey, requestHash],
      );
      if (!reservation.rows[0]) {
        const previous = await client.query<{ request_hash: string; response_status: number | null; response_body: unknown }>(
          "SELECT request_hash,response_status,response_body FROM idempotency_records WHERE scope='auth.register' AND idempotency_key=$1 FOR UPDATE",
          [idempotencyKey],
        );
        const saved = previous.rows[0];
        if (!saved || saved.request_hash !== requestHash) {
          await client.query("ROLLBACK");
          return reply.code(409).send(failure("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used for a different request."));
        }
        if (saved.response_status === 202 && saved.response_body) {
          await client.query("COMMIT");
          return reply.code(202).send(saved.response_body);
        }
        await client.query("ROLLBACK");
        return reply.code(409).send(failure("REQUEST_IN_PROGRESS", "This registration request is already being processed."));
      }
      const user = await client.query<{ id: string }>(
        "INSERT INTO users(full_name,email,phone,password_hash,status) VALUES($1,$2,$3,$4,'pending') RETURNING id",
        [body.fullName, body.email, body.phone ?? null, await hashPassword(body.password)],
      );
      userId = user.rows[0]!.id;
      const org = await client.query<{ id: string }>(
        "INSERT INTO organizations(name,slug,owner_user_id,business_type,billing_email,billing_phone) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
        [body.business.tradeName, slugify(body.business.tradeName), userId, body.business.businessType, body.business.businessEmail ?? body.email, body.business.businessPhone ?? body.phone ?? null],
      );
      const organizationId = org.rows[0]!.id;
      await client.query("INSERT INTO organization_members(organization_id,user_id,role,joined_at) VALUES($1,$2,'owner',now())", [organizationId, userId]);
      const businessAddress = body.business.address;
      await client.query(
        `INSERT INTO organization_business_profiles(
          organization_id,registered_business_name,trade_name,business_type,industry,pan,gstin,cin,fssai_license,
          website_url,business_email,business_phone,address_line1,address_line2,locality,city,district,state,state_code,postal_code,country_code
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [organizationId, body.business.registeredBusinessName ?? null, body.business.tradeName, body.business.businessType, body.business.industry,
          body.business.pan ?? null, body.business.gstin ?? null, body.business.cin ?? null, body.business.fssaiLicense ?? null,
          body.business.websiteUrl ?? null, body.business.businessEmail ?? null, body.business.businessPhone ?? null,
          businessAddress.addressLine1, businessAddress.addressLine2 ?? null, businessAddress.locality ?? null, businessAddress.city,
          businessAddress.district ?? null, businessAddress.state, businessAddress.stateCode ?? null, businessAddress.postalCode, businessAddress.countryCode],
      );
      const outletAddress = body.outlet.address;
      const outlet = await client.query<{ id: string }>(
        `INSERT INTO outlets(organization_id,name,slug,outlet_code,deployment_type,timezone,phone,email,address_line1,address_line2,locality,city,district,state,state_code,postal_code,country_code,gstin,fssai_license)
         VALUES($1,$2,$3,$4,'on_premise',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [organizationId, body.outlet.name, slugify(body.outlet.name), body.outlet.code ?? null, body.outlet.timezone,
          body.outlet.phone ?? null, body.outlet.email ?? null, outletAddress.addressLine1, outletAddress.addressLine2 ?? null,
          outletAddress.locality ?? null, outletAddress.city, outletAddress.district ?? null, outletAddress.state,
          outletAddress.stateCode ?? null, outletAddress.postalCode, outletAddress.countryCode, body.outlet.gstin ?? null, body.outlet.fssaiLicense ?? null],
      );
      const outletId = outlet.rows[0]!.id;
      const subscription = await client.query<{ id: string }>(
        "INSERT INTO subscriptions(organization_id,status) VALUES($1,'provisioning') RETURNING id", [organizationId],
      );
      const subscriptionId = subscription.rows[0]!.id;
      await client.query(
        "INSERT INTO provisioning_jobs(organization_id,outlet_id,subscription_id,job_type,idempotency_key) VALUES($1,$2,$3,'windows_trial',$4)",
        [organizationId, outletId, subscriptionId, `registration:${userId}`],
      );
      await client.query(
        "INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,'account.registered','organization',$1,$3)",
        [organizationId, userId, JSON.stringify({ termsVersion: body.termsVersion, deploymentType: "on_premise" })],
      );
      verifyToken = randomToken(32);
      await client.query(
        "INSERT INTO user_auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'email_verification',$2,now() + interval '24 hours')",
        [userId, hashToken(verifyToken)],
      );
      await client.query(
        "UPDATE idempotency_records SET response_status=202,response_body=$3,completed_at=now() WHERE scope='auth.register' AND idempotency_key=$1 AND request_hash=$2",
        [idempotencyKey, requestHash, JSON.stringify(registrationResponse)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        // Do not disclose whether the address already has an account.
        return reply.code(202).send(success({ message: "If this email can be registered, a verification email will be sent." }));
      }
      request.log.error({ err: error }, "SaaS registration failed");
      return reply.code(500).send(failure("REGISTRATION_FAILED", "We could not complete registration. Please try again."));
    } finally {
      client.release();
    }
    try {
      await sendActionEmail(body.email, "Verify your Fine Dine account", "Welcome to Fine Dine. Verify your email to continue.", `${publicBaseUrl()}/verify-email?token=${encodeURIComponent(verifyToken!)}`);
    } catch (error) {
      request.log.error({ err: error, userId: userId! }, "Verification email delivery failed");
    }
    return reply.code(202).send(registrationResponse);
  });

  app.post("/api/v1/auth/verify-email", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = z.object({ token: z.string().min(32).max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(failure("VALIDATION_ERROR", "A valid verification token is required."));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const token = await client.query<{ user_id: string }>(
        "UPDATE user_auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='email_verification' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id",
        [hashToken(parsed.data.token)],
      );
      if (!token.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(400).send(failure("TOKEN_INVALID", "This verification link is invalid or expired."));
      }
      await client.query("UPDATE users SET email_verified_at=now(),status='active',updated_at=now() WHERE id=$1", [token.rows[0].user_id]);
      await client.query(
        "UPDATE user_auth_tokens SET consumed_at=COALESCE(consumed_at,now()) WHERE user_id=$1 AND purpose='email_verification' AND consumed_at IS NULL",
        [token.rows[0].user_id],
      );
      await client.query("COMMIT");
      return success({ verified: true, message: "Email verified. You can now sign in." });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Email verification failed");
      return reply.code(500).send(failure("VERIFICATION_FAILED", "We could not verify this email."));
    } finally { client.release(); }
  });

  app.post("/api/v1/auth/resend-verification", { config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = z.object({ email: EMAIL }).safeParse(request.body);
    if (!parsed.success) return reply.code(202).send(success({ message: "If the account needs verification, an email will be sent." }));
    const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email_normalized=$1 AND email_verified_at IS NULL AND status='pending'", [parsed.data.email]);
    if (user.rows[0]) {
      const token = await issueAuthToken(user.rows[0].id, "email_verification", 24);
      await sendActionEmail(parsed.data.email, "Verify your Fine Dine account", "Use this link to verify your Fine Dine email.", `${publicBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`).catch((error: unknown) => request.log.error({ err: error }, "Resend verification email failed"));
    }
    return reply.code(202).send(success({ message: "If the account needs verification, an email will be sent." }));
  });

  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (request, reply) => {
    const parsed = z.object({ email: EMAIL, password: z.string().min(1).max(128) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(failure("VALIDATION_ERROR", "Enter a valid email and password."));
    const result = await pool.query<{ id: string; password_hash: string; status: string; email_verified_at: Date | null }>(
      "SELECT id,password_hash,status,email_verified_at FROM users WHERE email_normalized=$1", [parsed.data.email],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
      return reply.code(401).send(failure("INVALID_CREDENTIALS", "Email or password is incorrect."));
    }
    if (!user.email_verified_at || user.status !== "active") {
      return reply.code(403).send(failure("EMAIL_NOT_VERIFIED", "Please verify your email before signing in."));
    }
    const token = randomToken(32);
    await pool.query(
      "INSERT INTO user_sessions(user_id,token_hash,expires_at,user_agent,ip_address) VALUES($1,$2,now()+($3 * interval '1 second'),$4,$5)",
      [user.id, hashToken(token), SESSION_SECONDS, request.headers["user-agent"] ?? null, request.ip],
    );
    setSession(reply, token);
    return success({ user: { id: user.id }, expiresIn: SESSION_SECONDS });
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (token) await pool.query("UPDATE user_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL", [hashToken(token)]);
    clearSession(reply);
    return success({ loggedOut: true });
  });

  app.get("/api/v1/account/me", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    const business = await pool.query(
      `SELECT organization_id,registered_business_name,trade_name,business_type,industry,
        CASE WHEN pan IS NULL THEN NULL ELSE left(pan,2) || '******' || right(pan,2) END AS pan,
        CASE WHEN gstin IS NULL THEN NULL ELSE left(gstin,2) || '***********' || right(gstin,2) END AS gstin,
        cin,fssai_license,website_url,business_email,business_phone,address_line1,address_line2,locality,
        city,district,state,state_code,postal_code,country_code
       FROM organization_business_profiles WHERE organization_id=$1`,
      [user.organization_id],
    );
    return success({ user: { id: user.id, fullName: user.full_name, email: user.email, phone: user.phone, role: user.role }, business: business.rows[0] ?? null });
  });

  app.patch("/api/v1/business-profile", async (request, reply) => {
    const user = await requireUser(request, reply);
    if (!user) return;
    if (!["owner", "admin"].includes(user.role)) return reply.code(403).send(failure("FORBIDDEN", "Only an owner or administrator can update business identity."));
    const schema = z.object({
      tradeName: z.string().trim().min(2).max(180),
      registeredBusinessName: z.string().trim().max(180).nullable().optional(),
      businessType: z.enum(["restaurant", "cafe", "qsr", "bakery", "cloud_kitchen", "food_truck", "grocery", "retail", "other"]),
      industry: z.string().trim().min(2).max(80),
      pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/).nullable().optional(),
      gstin: z.string().trim().toUpperCase().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/).nullable().optional(),
      cin: z.string().trim().max(32).nullable().optional(),
      fssaiLicense: z.string().trim().max(32).nullable().optional(),
      websiteUrl: z.string().url().max(300).nullable().optional(),
      businessEmail: EMAIL.nullable().optional(),
      businessPhone: phone.nullable().optional(),
      address: addressSchema,
    }).strict().superRefine((data, context) => {
      if (data.gstin && data.address.stateCode && data.gstin.slice(0, 2) !== data.address.stateCode) {
        context.addIssue({ code: "custom", path: ["gstin"], message: "GSTIN state prefix must match the registered address state code." });
      }
    });
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(failure("VALIDATION_ERROR", "Please check the business profile fields."));
    const b = parsed.data;
    await pool.query(
      `UPDATE organization_business_profiles SET trade_name=$2,registered_business_name=$3,business_type=$4,industry=$5,
       pan=COALESCE($6,pan),gstin=COALESCE($7,gstin),cin=$8,fssai_license=$9,website_url=$10,business_email=$11,business_phone=$12,
       address_line1=$13,address_line2=$14,locality=$15,city=$16,district=$17,state=$18,state_code=$19,
       postal_code=$20,country_code=$21,updated_at=now() WHERE organization_id=$1`,
      [user.organization_id,b.tradeName,b.registeredBusinessName ?? null,b.businessType,b.industry,b.pan ?? null,b.gstin ?? null,
       b.cin ?? null,b.fssaiLicense ?? null,b.websiteUrl ?? null,b.businessEmail ?? null,b.businessPhone ?? null,
       b.address.addressLine1,b.address.addressLine2 ?? null,b.address.locality ?? null,b.address.city,b.address.district ?? null,
       b.address.state,b.address.stateCode ?? null,b.address.postalCode,b.address.countryCode],
    );
    await pool.query(
      "INSERT INTO audit_logs(organization_id,actor_user_id,action,entity_type,metadata) VALUES($1,$2,'business_profile.updated','organization_business_profile',$3)",
      [user.organization_id,user.id,JSON.stringify({ changedFields: Object.keys(b) })],
    );
    return success({ updated: true });
  });

  app.post("/api/v1/auth/forgot-password", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = z.object({ email: EMAIL }).safeParse(request.body);
    if (!parsed.success) return reply.code(202).send(success({ message: "If an account exists, password reset instructions will be sent." }));
    const user = await pool.query<{ id: string }>("SELECT id FROM users WHERE email_normalized=$1 AND status='active' AND email_verified_at IS NOT NULL", [parsed.data.email]);
    if (user.rows[0]) {
      const token = await issueAuthToken(user.rows[0].id, "password_reset", 1);
      await sendActionEmail(parsed.data.email, "Reset your Fine Dine password", "A password reset was requested for your account.", `${publicBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`).catch((error: unknown) => request.log.error({ err: error }, "Password reset email failed"));
    }
    return reply.code(202).send(success({ message: "If an account exists, password reset instructions will be sent." }));
  });

  app.post("/api/v1/auth/reset-password", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = z.object({ token: z.string().min(32).max(200), newPassword: z.string().min(12).max(128) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(failure("VALIDATION_ERROR", "Use a valid reset link and a password of at least 12 characters."));
    const passwordHash = await hashPassword(parsed.data.newPassword);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const token = await client.query<{ user_id: string }>(
        "UPDATE user_auth_tokens SET consumed_at=now() WHERE token_hash=$1 AND purpose='password_reset' AND consumed_at IS NULL AND expires_at>now() RETURNING user_id",
        [hashToken(parsed.data.token)],
      );
      if (!token.rows[0]) {
        await client.query("ROLLBACK");
        return reply.code(400).send(failure("TOKEN_INVALID", "This password reset link is invalid or expired."));
      }
      await client.query("UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1", [token.rows[0].user_id,passwordHash]);
      await client.query("UPDATE user_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [token.rows[0].user_id]);
      await client.query("COMMIT");
      clearSession(reply);
      return success({ passwordChanged: true, message: "Password updated. Please sign in again." });
    } catch (error) {
      await client.query("ROLLBACK");
      request.log.error({ err: error }, "Password reset failed");
      return reply.code(500).send(failure("RESET_FAILED", "We could not reset the password."));
    } finally { client.release(); }
  });

  app.addHook("onClose", async () => { await pool.end(); });
  return app;
}
