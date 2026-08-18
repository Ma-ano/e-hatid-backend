import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { env } from "../config/env.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.smtpHost || !env.smtpPort) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth:
        env.smtpUser && env.smtpPass
          ? { user: env.smtpUser, pass: env.smtpPass }
          : undefined,
    });
  }
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends an email when SMTP is configured. When not configured (dev/demo),
 * falls back to logging the message so flows still work without a real server.
 */
export async function sendMail(message: MailMessage): Promise<{ delivered: boolean; method: string }> {
  const t = getTransporter();
  if (!t) {
    console.log(`[mail:console] To: ${message.to}`);
    console.log(`[mail:console] Subject: ${message.subject}`);
    console.log(`[mail:console] Body: ${message.text}`);
    return { delivered: false, method: "console" };
  }
  try {
    await t.sendMail({
      from: env.smtpFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { delivered: true, method: "smtp" };
  } catch (err) {
    console.error("[mail] SMTP send failed, logging instead:", err);
    console.log(`[mail:console] To: ${message.to}`);
    console.log(`[mail:console] Subject: ${message.subject}`);
    console.log(`[mail:console] Body: ${message.text}`);
    return { delivered: false, method: "console" };
  }
}
