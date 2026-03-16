import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.isSmtpConfigured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465 || config.smtp.port === 994,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }
  return transporter;
}

export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.warn('SMTP not configured, skipping verification email');
    return false;
  }

  const verifyUrl = `${config.frontendUrl}/verify-email?token=${token}`;

  await t.sendMail({
    from: config.smtp.from,
    to: email,
    subject: 'Loveca - 邮箱验证',
    html: `
      <h2>欢迎注册 Loveca!</h2>
      <p>请点击以下链接验证您的邮箱：</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>此链接 24 小时内有效。</p>
      <p>如果您没有注册 Loveca 账号，请忽略此邮件。</p>
    `,
  });
  return true;
}

export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.warn('SMTP not configured, skipping password reset email');
    return false;
  }

  const resetUrl = `${config.frontendUrl}/reset-password?token=${token}`;

  await t.sendMail({
    from: config.smtp.from,
    to: email,
    subject: 'Loveca - 密码重置',
    html: `
      <h2>密码重置</h2>
      <p>您请求了密码重置，请点击以下链接设置新密码：</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>此链接 1 小时内有效。</p>
      <p>如果您没有请求密码重置，请忽略此邮件。</p>
    `,
  });
  return true;
}
