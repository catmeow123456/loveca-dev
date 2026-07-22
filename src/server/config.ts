function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

interface SmtpConfiguration {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly pass: string;
  readonly from: string;
}

export function isCompleteSmtpConfiguration(smtp: SmtpConfiguration): boolean {
  return !!(
    smtp.host.trim() &&
    Number.isInteger(smtp.port) &&
    smtp.port >= 1 &&
    smtp.port <= 65_535 &&
    smtp.user.trim() &&
    smtp.pass &&
    smtp.from.trim()
  );
}

export const config = {
  port: parseInt(optionalEnv('PORT', '3007'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),

  // PostgreSQL
  databaseUrl: requireEnv('DATABASE_URL'),

  // JWT
  jwtSecret: requireEnv('JWT_SECRET'),
  jwtRefreshSecret: requireEnv('JWT_REFRESH_SECRET'),
  jwtAccessExpiresIn: '15m',
  jwtRefreshExpiresInDays: 7,

  // MinIO
  minio: {
    endpoint: requireEnv('MINIO_ENDPOINT'),
    port: parseInt(optionalEnv('MINIO_PORT', '9000'), 10),
    accessKey: requireEnv('MINIO_ACCESS_KEY'),
    secretKey: requireEnv('MINIO_SECRET_KEY'),
    bucket: optionalEnv('MINIO_BUCKET', 'loveca-cards'),
    useSSL: optionalEnv('MINIO_USE_SSL', 'false') === 'true',
  },

  // SMTP (optional)
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(optionalEnv('SMTP_PORT', '587')),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? '',
  },

  // Email verification
  emailEnabled: optionalEnv('EMAIL_ENABLED', 'false') === 'true',

  // Frontend URL (for email links)
  frontendUrl: requireEnv('FRONTEND_URL'),

  get isDev() {
    return this.nodeEnv === 'development';
  },

  get isSmtpConfigured() {
    return isCompleteSmtpConfiguration(this.smtp);
  },

  get isEmailFeatureEnabled() {
    return this.emailEnabled && this.isSmtpConfigured;
  },

  get isEmailVerificationRequired() {
    return this.emailEnabled;
  },
} as const;

export function assertSecurityConfiguration(): void {
  if (!config.isDev && Buffer.byteLength(config.jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes in production');
  }
  if (!config.isDev && Buffer.byteLength(config.jwtRefreshSecret, 'utf8') < 32) {
    throw new Error('JWT_REFRESH_SECRET must be at least 32 bytes in production');
  }
  if (!config.isDev && config.jwtSecret === config.jwtRefreshSecret) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different in production');
  }
  if (config.isEmailVerificationRequired && !config.isSmtpConfigured) {
    throw new Error(
      'EMAIL_ENABLED=true requires SMTP_HOST, a valid SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM'
    );
  }
}
