/**
 * Email for customer accounts (P7-01, ADR-0006). One small interface so the provider can change:
 *   brevoMailer  Brevo's transactional email API (free plan: 300 emails a day), called with fetch
 *   logMailer    development: the message (and its code) goes to the server log; never use in production
 */

export interface Mail { to: string; subject: string; text: string }
export interface Mailer {
  /** 'log' is development only: sign-up is refused in production with it. */
  kind: 'brevo' | 'log' | 'test';
  send(mail: Mail): Promise<void>;
}

export function logMailer(log: { info(m: string, d?: unknown): void }): Mailer {
  return { kind: 'log', send: async (m) => log.info(`email to ${m.to}: ${m.subject}`, m.text) };
}

export function brevoMailer(o: { apiKey: string; from: string; fromName?: string; fetch?: typeof fetch }): Mailer {
  const f = o.fetch ?? fetch;
  return {
    kind: 'brevo',
    async send(m) {
      const r = await f('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': o.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: o.from, name: o.fromName ?? 'DinePOS' }, to: [{ email: m.to }], subject: m.subject, textContent: m.text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) throw new Error(`Brevo refused the email (${r.status}): ${(await r.text().catch(() => '')).slice(0, 200)}`);
    },
  };
}

/** The mailer from the environment: HUB_BREVO_API_KEY + HUB_MAIL_FROM, else the log (development). */
export function mailerFromEnv(env: NodeJS.ProcessEnv, log: { info(m: string, d?: unknown): void }): Mailer {
  if (env.HUB_BREVO_API_KEY && env.HUB_MAIL_FROM) return brevoMailer({ apiKey: env.HUB_BREVO_API_KEY, from: env.HUB_MAIL_FROM, fromName: env.HUB_MAIL_FROM_NAME || undefined });
  return logMailer(log);
}
