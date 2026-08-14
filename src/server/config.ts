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

function parsePositiveIntegerEnv(name: string, fallback: number, maximum: number): number {
  const value = Number(optionalEnv(name, String(fallback)));
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function parseHostListEnv(name: string): readonly string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
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
    wallpaperBucket: optionalEnv('MINIO_WALLPAPER_BUCKET', 'loveca-user-assets'),
    useSSL: optionalEnv('MINIO_USE_SSL', 'false') === 'true',
  },

  playerWallpaper: {
    maxInputBytes: 8 * 1024 * 1024,
    maxInputPixels: 32 * 1024 * 1024,
    maxInputEdge: 8192,
    normalizedMasterMaxEdge: 4096,
    processingConcurrency: parsePositiveIntegerEnv('PLAYER_WALLPAPER_PROCESSING_CONCURRENCY', 2, 8),
    processingTimeoutSeconds: parsePositiveIntegerEnv(
      'PLAYER_WALLPAPER_PROCESSING_TIMEOUT_SECONDS',
      15,
      60
    ),
    retiredAssetRetentionHours: parsePositiveIntegerEnv(
      'PLAYER_WALLPAPER_RETIRED_RETENTION_HOURS',
      24,
      24 * 30
    ),
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

  // Card-effect AI extraction. The database stores runtime configuration;
  // deployment settings only define the encryption key and exact host allowlist.
  aiEffectExtraction: {
    encryptionKey: process.env.AI_EFFECT_EXTRACTION_ENCRYPTION_KEY ?? '',
    allowedHosts: parseHostListEnv('AI_EFFECT_EXTRACTION_ALLOWED_HOSTS'),
  },

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
  if (config.minio.wallpaperBucket === config.minio.bucket) {
    throw new Error('MINIO_WALLPAPER_BUCKET must be different from the public MINIO_BUCKET');
  }
  if (
    config.aiEffectExtraction.encryptionKey &&
    !isValidAiEffectExtractionEncryptionKey(config.aiEffectExtraction.encryptionKey)
  ) {
    throw new Error(
      'AI_EFFECT_EXTRACTION_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters or base64'
    );
  }
}

export function isValidAiEffectExtractionEncryptionKey(value: string): boolean {
  return parseAiEffectExtractionEncryptionKey(value) !== null;
}

export function parseAiEffectExtractionEncryptionKey(value: string): Buffer | null {
  if (/^[0-9a-f]{64}$/iu.test(value)) {
    return Buffer.from(value, 'hex');
  }
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64');
  return decoded.length === 32 && decoded.toString('base64') === value ? decoded : null;
}
