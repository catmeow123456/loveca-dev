import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('../../src/server/config.js', () => ({
  config: {
    isEmailFeatureEnabled: true,
    isSmtpConfigured: true,
    frontendUrl: 'https://loveca.example/',
    smtp: {
      host: 'smtp.example',
      port: 587,
      user: 'smtp-user',
      pass: 'smtp-pass',
      from: 'noreply@loveca.example',
    },
  },
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: mocks.createTransport,
  },
}));

import {
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../../src/server/services/mail-service';

function firstMailHtml(): string {
  const calls = mocks.sendMail.mock.calls as unknown as Array<[{ html?: string }]>;
  return calls[0]?.[0].html ?? '';
}

describe('mail-service auth links', () => {
  beforeEach(() => {
    mocks.createTransport.mockReset();
    mocks.sendMail.mockReset();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail });
    mocks.sendMail.mockResolvedValue({ accepted: ['user@example.com'] });
  });

  it('puts verification secrets in the URL fragment rather than the query string', async () => {
    await expect(sendVerificationEmail('user@example.com', 'token/value')).resolves.toBe(true);

    expect(mocks.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true })
    );
    expect(mocks.sendMail).toHaveBeenCalledOnce();
    expect(firstMailHtml()).toContain('https://loveca.example/verify-email#token=token%2Fvalue');
    expect(firstMailHtml()).not.toContain('/verify-email?token=');
  });

  it('puts password reset secrets in the URL fragment too', async () => {
    await expect(sendPasswordResetEmail('user@example.com', 'reset-token')).resolves.toBe(true);

    expect(mocks.sendMail).toHaveBeenCalledOnce();
    expect(firstMailHtml()).toContain('https://loveca.example/reset-password#token=reset-token');
    expect(firstMailHtml()).not.toContain('/reset-password?token=');
  });
});
