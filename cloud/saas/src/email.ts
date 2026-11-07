import nodemailer from "nodemailer";
import { config } from "./config.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

class SmtpEmailProvider implements EmailProvider {
  private readonly transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_SECURE === "true",
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
  });

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: config.SMTP_FROM, ...message });
  }
}

class DevelopmentEmailProvider implements EmailProvider {
  async send(message: EmailMessage): Promise<void> {
    // Local-only adapter. Never enable this adapter in production.
    console.info("[saas-email:development]", { to: message.to, subject: message.subject, text: message.text });
  }
}

export const emailProvider: EmailProvider =
  config.smtpConfigured ? new SmtpEmailProvider() : new DevelopmentEmailProvider();

export async function sendActionEmail(to: string, subject: string, intro: string, actionUrl: string): Promise<void> {
  await emailProvider.send({
    to,
    subject,
    text: `${intro}\n\n${actionUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(actionUrl)}">Continue to Fine Dine</a></p><p>If you did not request this, you can ignore this email.</p>`,
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);
}
