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
    port: parseInt(optionalEnv('SMTP_PORT', '587'), 10),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: optionalEnv('SMTP_FROM', 'noreply@loveca.app'),
  },

  // Email verification
  emailEnabled: optionalEnv('EMAIL_ENABLED', 'false') === 'true',

  // Frontend URL (for email links)
  frontendUrl: requireEnv('FRONTEND_URL'),

  get isDev() {
    return this.nodeEnv === 'development';
  },

  get isSmtpConfigured() {
    return !!(this.smtp.host && this.smtp.user && this.smtp.pass);
  },
} as const;
