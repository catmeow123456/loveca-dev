import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Buffer } from 'node:buffer';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool } from '../db/pool.js';
import { config, parseAiEffectExtractionEncryptionKey } from '../config.js';
import { getObject } from './minio-service.js';

const CONFIG_ID = 'default';
const ENCRYPTION_AAD = Buffer.from('loveca:ai-effect-extraction-config:v1', 'utf8');
const RATE_WINDOW_MS = 60_000;
const TEST_RATE_LIMIT = 10;
const EXTRACTION_RATE_LIMIT = 20;
const UPSTREAM_REQUEST_TIMEOUT_MS = 15_000;
const UPSTREAM_RESPONSE_MAX_BYTES = 256 * 1024;
const CARD_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const UPSTREAM_CONCURRENCY_LIMIT = 2;

const SYSTEM_PROMPT = `你是一名 Love Live! Series Official Card Game 的卡牌效果翻译专家。

你的任务是从卡牌图片中提取日文效果文本，并翻译成项目使用的中文格式。

要求：
- 效果时机使用【常时】【登场】【起动】【自动】【LIVE开始时】【LIVE成功时】。
- 手牌、休息室、舞台、待机状态、活跃状态、费用、成员卡、LIVE、能量、声援等术语保持统一。
- BLADE 与 Heart 图标使用项目现有的方括号标记格式。
- 团体或组合名使用『』。
- 每个效果条目单独一行，不添加解释、注释、标题或前缀。
- 只输出翻译后的效果文本。`;

const EXTRACTION_PROMPT = '请提取这张卡牌图片上的效果文本，并按照规范翻译成中文。只输出翻译结果。';
const CONNECTIVITY_TEST_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xn4wWQAAAABJRU5ErkJggg==';

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>>;
}

interface ConfigRow extends QueryResultRow {
  readonly revision: number;
  readonly enabled: boolean;
  readonly base_url: string;
  readonly model_id: string;
  readonly encrypted_api_key: string | null;
  readonly updated_at: Date | string;
}

interface CardImageRow extends QueryResultRow {
  readonly card_code: string;
  readonly image_filename: string | null;
}

interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type AiEffectExtractionKeyAction =
  | { readonly action: 'KEEP' }
  | { readonly action: 'REPLACE'; readonly value: string }
  | { readonly action: 'CLEAR' };

export interface AiEffectExtractionCandidate {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: AiEffectExtractionKeyAction;
}

export interface SaveAiEffectExtractionConfigInput extends AiEffectExtractionCandidate {
  readonly expectedRevision: number;
  readonly enabled: boolean;
}

export interface AdminAiEffectExtractionConfig {
  readonly revision: number;
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKeyConfigured: boolean;
  readonly encryptionReady: boolean;
  readonly outboundPolicyReady: boolean;
  readonly runtimeReady: boolean;
  readonly updatedAt: string;
}

export interface AiEffectExtractionTestResult {
  readonly ok: true;
  readonly message: string;
  readonly latencyMs: number;
}

interface EffectiveAiConfiguration {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: string;
}

interface AiEffectExtractionServiceDependencies {
  readonly database?: Queryable & { connect(): Promise<PoolClient> };
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly resolveHost?: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  readonly loadObject?: typeof getObject;
  readonly now?: () => number;
}

export class AiEffectExtractionServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'AiEffectExtractionServiceError';
  }
}

export class AiEffectExtractionService {
  private readonly database: Queryable & { connect(): Promise<PoolClient> };
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly resolveHost: (hostname: string) => Promise<readonly ResolvedAddress[]>;
  private readonly loadObject: typeof getObject;
  private readonly now: () => number;
  private readonly rateWindows = new Map<string, number[]>();
  private activeUpstreamRequests = 0;

  constructor(dependencies: AiEffectExtractionServiceDependencies = {}) {
    this.database = dependencies.database ?? pool;
    this.fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
    this.resolveHost =
      dependencies.resolveHost ??
      (async (hostname) => {
        const addresses = await lookup(hostname, { all: true, verbatim: true });
        return addresses.map(({ address, family }) => ({
          address,
          family: family === 6 ? 6 : 4,
        }));
      });
    this.loadObject = dependencies.loadObject ?? getObject;
    this.now = dependencies.now ?? Date.now;
  }

  async getAdminConfig(): Promise<AdminAiEffectExtractionConfig> {
    return this.toAdminView(await this.readConfig(this.database));
  }

  async saveConfig(
    input: SaveAiEffectExtractionConfigInput,
    adminUserId: string
  ): Promise<AdminAiEffectExtractionConfig> {
    const normalized = normalizeCandidate(input, input.enabled);
    if (normalized.baseUrl) {
      await this.validateOutboundUrl(normalized.baseUrl);
    }

    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const current = await this.readConfig(client, true);
      if (current.revision !== input.expectedRevision) {
        throw serviceError(
          'AI_EFFECT_CONFIG_REVISION_CONFLICT',
          'AI 提取配置已被其他管理员更新，请重新载入',
          409
        );
      }

      const encryptedApiKey = this.resolveEncryptedKey(input.apiKey, current.encrypted_api_key);
      if (input.enabled) {
        this.assertDeploymentReady();
        if (!encryptedApiKey) {
          throw serviceError(
            'AI_EFFECT_CONFIG_KEY_REQUIRED',
            '启用 AI 提取前必须配置 API Key',
            422
          );
        }
        this.decryptApiKey(encryptedApiKey);
      }

      const nextRevision = current.revision + 1;
      const updated = await client.query<ConfigRow>(
        `UPDATE ai_effect_extraction_config
         SET revision = $1, enabled = $2, base_url = $3, model_id = $4,
             encrypted_api_key = $5, updated_by = $6, updated_at = now()
         WHERE id = $7
         RETURNING revision, enabled, base_url, model_id, encrypted_api_key, updated_at`,
        [
          nextRevision,
          input.enabled,
          normalized.baseUrl,
          normalized.modelId,
          encryptedApiKey,
          adminUserId,
          CONFIG_ID,
        ]
      );
      await client.query(
        `INSERT INTO ai_effect_extraction_audit_logs
           (action, admin_user_id, previous_revision, next_revision, detail)
         VALUES ('CONFIG_UPDATED', $1, $2, $3, $4::jsonb)`,
        [
          adminUserId,
          current.revision,
          nextRevision,
          JSON.stringify({
            enabled: input.enabled,
            baseUrl: normalized.baseUrl,
            modelId: normalized.modelId,
            apiKeyAction: input.apiKey.action,
          }),
        ]
      );
      await client.query('COMMIT');
      return this.toAdminView(requiredRow(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async testCandidate(
    input: AiEffectExtractionCandidate,
    adminUserId: string
  ): Promise<AiEffectExtractionTestResult> {
    this.consumeRateLimit(`test:${adminUserId}`, TEST_RATE_LIMIT);
    const normalized = normalizeCandidate(input, true);
    await this.validateOutboundUrl(normalized.baseUrl);
    const current = await this.readConfig(this.database);
    const apiKey = this.resolveCandidatePlaintextKey(input.apiKey, current.encrypted_api_key);
    const startedAt = this.now();
    await this.invokeCompatibleModel(
      { baseUrl: normalized.baseUrl, modelId: normalized.modelId, apiKey },
      [
        { role: 'system', content: 'You are a connectivity test. Follow the user instruction.' },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: CONNECTIVITY_TEST_IMAGE } },
            { type: 'text', text: 'Reply with OK only.' },
          ],
        },
      ],
      8
    );
    return {
      ok: true,
      message: '连接、鉴权、模型调用与返回格式均正常',
      latencyMs: Math.max(0, this.now() - startedAt),
    };
  }

  async extractCardEffect(cardCode: string, adminUserId: string): Promise<string> {
    this.consumeRateLimit(`extract:${adminUserId}`, EXTRACTION_RATE_LIMIT);
    const row = await this.readConfig(this.database);
    if (!row.enabled) {
      throw serviceError('AI_EFFECT_EXTRACTION_DISABLED', 'AI 效果提取当前未启用', 409);
    }
    this.assertDeploymentReady();
    if (!row.encrypted_api_key) {
      throw serviceError('AI_EFFECT_CONFIG_KEY_REQUIRED', 'AI 提取服务没有可用的 API Key', 503);
    }
    const effective = {
      baseUrl: row.base_url,
      modelId: row.model_id,
      apiKey: this.decryptApiKey(row.encrypted_api_key),
    };
    await this.validateOutboundUrl(effective.baseUrl);

    const cardResult = await this.database.query<CardImageRow>(
      'SELECT card_code, image_filename FROM cards WHERE card_code = $1',
      [cardCode]
    );
    const card = cardResult.rows[0];
    if (!card) {
      throw serviceError('AI_EFFECT_CARD_NOT_FOUND', '卡牌不存在', 404);
    }
    if (!card.image_filename) {
      throw serviceError('AI_EFFECT_CARD_IMAGE_REQUIRED', '当前卡牌没有可用于提取的图片', 422);
    }

    const image = await this.readTrustedCardImage(card.card_code);
    const content = await this.invokeCompatibleModel(
      effective,
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/webp;base64,${image.toString('base64')}` },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
      1024
    );
    if (content.length > 12_000) {
      throw serviceError('AI_EFFECT_RESPONSE_INVALID', 'AI 返回的效果文本超过允许长度', 502);
    }
    return content;
  }

  private async readConfig(queryable: Queryable, lock = false): Promise<ConfigRow> {
    const result = await queryable.query<ConfigRow>(
      `SELECT revision, enabled, base_url, model_id, encrypted_api_key, updated_at
       FROM ai_effect_extraction_config
       WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [CONFIG_ID]
    );
    if (!result.rows[0]) {
      throw serviceError('AI_EFFECT_CONFIG_UNAVAILABLE', 'AI 提取配置尚未初始化', 503);
    }
    return result.rows[0];
  }

  private toAdminView(row: ConfigRow): AdminAiEffectExtractionConfig {
    const encryptionReady = Boolean(
      parseAiEffectExtractionEncryptionKey(config.aiEffectExtraction.encryptionKey)
    );
    const outboundPolicyReady = config.aiEffectExtraction.allowedHosts.length > 0;
    const apiKeyUsable = this.canDecryptApiKey(row.encrypted_api_key);
    const savedUpstreamAllowed = isSavedUpstreamAllowed(row.base_url);
    return {
      revision: row.revision,
      enabled: row.enabled,
      baseUrl: row.base_url,
      modelId: row.model_id,
      apiKeyConfigured: Boolean(row.encrypted_api_key),
      encryptionReady,
      outboundPolicyReady,
      runtimeReady:
        row.enabled &&
        apiKeyUsable &&
        encryptionReady &&
        outboundPolicyReady &&
        savedUpstreamAllowed &&
        Boolean(row.model_id.trim()),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  private assertDeploymentReady(): void {
    if (!parseAiEffectExtractionEncryptionKey(config.aiEffectExtraction.encryptionKey)) {
      throw serviceError(
        'AI_EFFECT_ENCRYPTION_UNAVAILABLE',
        '部署环境尚未配置 AI 密钥加密主密钥',
        503
      );
    }
    if (config.aiEffectExtraction.allowedHosts.length === 0) {
      throw serviceError(
        'AI_EFFECT_OUTBOUND_POLICY_UNAVAILABLE',
        '部署环境尚未配置 AI 上游主机白名单',
        503
      );
    }
  }

  private resolveEncryptedKey(
    action: AiEffectExtractionKeyAction,
    current: string | null
  ): string | null {
    if (action.action === 'KEEP') return current;
    if (action.action === 'CLEAR') return null;
    return this.encryptApiKey(normalizeApiKey(action.value));
  }

  private resolveCandidatePlaintextKey(
    action: AiEffectExtractionKeyAction,
    current: string | null
  ): string {
    if (action.action === 'REPLACE') return normalizeApiKey(action.value);
    if (action.action === 'CLEAR' || !current) {
      throw serviceError('AI_EFFECT_CONFIG_KEY_REQUIRED', '测试候选配置需要 API Key', 422);
    }
    return this.decryptApiKey(current);
  }

  private encryptApiKey(apiKey: string): string {
    const encryptionKey = parseAiEffectExtractionEncryptionKey(
      config.aiEffectExtraction.encryptionKey
    );
    if (!encryptionKey) {
      throw serviceError(
        'AI_EFFECT_ENCRYPTION_UNAVAILABLE',
        '部署环境尚未配置 AI 密钥加密主密钥',
        503
      );
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(ENCRYPTION_AAD);
    const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${authTag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  private decryptApiKey(value: string): string {
    const encryptionKey = parseAiEffectExtractionEncryptionKey(
      config.aiEffectExtraction.encryptionKey
    );
    if (!encryptionKey) {
      throw serviceError(
        'AI_EFFECT_ENCRYPTION_UNAVAILABLE',
        '部署环境尚未配置 AI 密钥加密主密钥',
        503
      );
    }
    const [version, ivValue, tagValue, ciphertextValue] = value.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) {
      throw serviceError('AI_EFFECT_KEY_DECRYPTION_FAILED', '已保存的 AI API Key 无法解密', 503);
    }
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        encryptionKey,
        Buffer.from(ivValue, 'base64url')
      );
      decipher.setAAD(ENCRYPTION_AAD);
      decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertextValue, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw serviceError('AI_EFFECT_KEY_DECRYPTION_FAILED', '已保存的 AI API Key 无法解密', 503);
    }
  }

  private canDecryptApiKey(value: string | null): boolean {
    if (!value) return false;
    try {
      return Boolean(this.decryptApiKey(value));
    } catch {
      return false;
    }
  }

  private async validateOutboundUrl(value: string): Promise<URL> {
    this.assertDeploymentReady();
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw serviceError('AI_EFFECT_BASE_URL_INVALID', 'Base URL 格式不正确', 422);
    }
    const hostname = normalizeHostname(parsed.hostname);
    if (
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.search ||
      !hostname ||
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    ) {
      throw serviceError(
        'AI_EFFECT_BASE_URL_INVALID',
        'Base URL 只能包含协议、允许的主机、端口和路径',
        422
      );
    }
    if (!config.aiEffectExtraction.allowedHosts.includes(hostname)) {
      throw serviceError('AI_EFFECT_HOST_NOT_ALLOWED', '该 AI 上游主机不在部署白名单中', 422);
    }
    if (parsed.protocol !== 'https:') {
      throw serviceError('AI_EFFECT_HTTPS_REQUIRED', '该 AI 上游必须使用 HTTPS', 422);
    }
    let addresses: readonly ResolvedAddress[];
    try {
      addresses = await this.resolveHost(hostname);
    } catch {
      throw serviceError('AI_EFFECT_HOST_RESOLUTION_FAILED', '无法解析 AI 上游主机', 422);
    }
    if (addresses.length === 0) {
      throw serviceError('AI_EFFECT_HOST_RESOLUTION_FAILED', 'AI 上游主机没有可用地址', 422);
    }
    if (addresses.some(({ address }) => !isPublicAddress(address))) {
      throw serviceError(
        'AI_EFFECT_PRIVATE_ADDRESS_REJECTED',
        'AI 上游不能指向内网或保留地址',
        422
      );
    }
    return parsed;
  }

  private async readTrustedCardImage(cardCode: string): Promise<Buffer> {
    let stream: Awaited<ReturnType<typeof getObject>>;
    try {
      stream = await this.loadObject(`large/${encodeURIComponent(cardCode)}.webp`);
    } catch {
      throw serviceError('AI_EFFECT_CARD_IMAGE_UNAVAILABLE', '无法读取当前卡牌图片', 422);
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    try {
      for await (const chunk of stream) {
        const candidate: unknown = chunk;
        if (typeof candidate !== 'string' && !(candidate instanceof Uint8Array)) {
          throw new Error('invalid object chunk');
        }
        const buffer = Buffer.from(candidate);
        totalBytes += buffer.length;
        if (totalBytes > CARD_IMAGE_MAX_BYTES) {
          throw serviceError('AI_EFFECT_CARD_IMAGE_TOO_LARGE', '卡牌图片超过 AI 提取大小上限', 422);
        }
        chunks.push(buffer);
      }
    } catch (error) {
      if (error instanceof AiEffectExtractionServiceError) throw error;
      throw serviceError('AI_EFFECT_CARD_IMAGE_UNAVAILABLE', '无法读取当前卡牌图片', 422);
    }
    if (totalBytes === 0) {
      throw serviceError('AI_EFFECT_CARD_IMAGE_UNAVAILABLE', '当前卡牌图片为空', 422);
    }
    return Buffer.concat(chunks);
  }

  private async invokeCompatibleModel(
    effective: EffectiveAiConfiguration,
    messages: readonly unknown[],
    maxTokens: number
  ): Promise<string> {
    await this.validateOutboundUrl(effective.baseUrl);
    if (this.activeUpstreamRequests >= UPSTREAM_CONCURRENCY_LIMIT) {
      throw serviceError('AI_EFFECT_CONCURRENCY_LIMIT', 'AI 提取服务当前繁忙，请稍后重试', 429);
    }
    this.activeUpstreamRequests += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_REQUEST_TIMEOUT_MS);
    try {
      const endpoint = `${effective.baseUrl.replace(/\/+$/u, '')}/chat/completions`;
      const response = await this.fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${effective.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ model: effective.modelId, messages, max_tokens: maxTokens }),
      });
      if (response.status >= 300 && response.status < 400) {
        throw serviceError('AI_EFFECT_REDIRECT_REJECTED', 'AI 上游返回了不允许的重定向', 502);
      }
      if (!response.ok) {
        throw upstreamStatusError(response.status);
      }
      const payload = await readBoundedJson(response, UPSTREAM_RESPONSE_MAX_BYTES);
      const content = readCompletionContent(payload);
      if (!content) {
        throw serviceError('AI_EFFECT_RESPONSE_INVALID', 'AI 上游返回了空结果或未知格式', 502);
      }
      return content;
    } catch (error) {
      if (error instanceof AiEffectExtractionServiceError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw serviceError('AI_EFFECT_UPSTREAM_TIMEOUT', 'AI 上游请求超时', 504);
      }
      throw serviceError('AI_EFFECT_UPSTREAM_UNAVAILABLE', '无法连接 AI 上游服务', 502);
    } finally {
      clearTimeout(timeout);
      this.activeUpstreamRequests -= 1;
    }
  }

  private consumeRateLimit(key: string, limit: number): void {
    const now = this.now();
    const active = (this.rateWindows.get(key) ?? []).filter(
      (value) => now - value < RATE_WINDOW_MS
    );
    if (active.length >= limit) {
      throw serviceError('AI_EFFECT_RATE_LIMIT', 'AI 操作过于频繁，请稍后重试', 429);
    }
    active.push(now);
    this.rateWindows.set(key, active);
  }
}

function normalizeCandidate(
  input: AiEffectExtractionCandidate,
  requireComplete: boolean
): { readonly baseUrl: string; readonly modelId: string } {
  const baseUrl = input.baseUrl.normalize('NFC').trim().replace(/\/+$/u, '');
  const modelId = input.modelId.normalize('NFC').trim();
  if (baseUrl.length > 2048) {
    throw serviceError('AI_EFFECT_BASE_URL_INVALID', 'Base URL 不能超过 2048 个字符', 422);
  }
  if (modelId.length > 128 || containsControlCharacter(modelId)) {
    throw serviceError('AI_EFFECT_MODEL_ID_INVALID', 'Model ID 格式不正确', 422);
  }
  if (requireComplete && (!baseUrl || !modelId)) {
    throw serviceError('AI_EFFECT_CONFIG_INCOMPLETE', 'Base URL 和 Model ID 均不能为空', 422);
  }
  return { baseUrl, modelId };
}

function normalizeApiKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 4096 || containsControlCharacter(normalized)) {
    throw serviceError('AI_EFFECT_API_KEY_INVALID', 'API Key 格式不正确', 422);
  }
  return normalized;
}

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    );
  });
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/u, '');
}

function isSavedUpstreamAllowed(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = normalizeHostname(parsed.hostname);
    return Boolean(
      hostname &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      !parsed.search &&
      config.aiEffectExtraction.allowedHosts.includes(hostname) &&
      parsed.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
  if (/^fe[89ab]/u.test(normalized) || normalized.startsWith('ff')) return false;
  if (normalized.startsWith('2001:db8:') || normalized.startsWith('2001:db8::')) return false;
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  return mappedIpv4 ? isPublicIpv4(mappedIpv4) : true;
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  if (!response.body) {
    throw serviceError('AI_EFFECT_RESPONSE_INVALID', 'AI 上游返回了空响应', 502);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw serviceError('AI_EFFECT_RESPONSE_TOO_LARGE', 'AI 上游响应超过大小上限', 502);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
  } catch {
    throw serviceError('AI_EFFECT_RESPONSE_INVALID', 'AI 上游没有返回有效 JSON', 502);
  }
}

function readCompletionContent(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const firstChoice: unknown = value.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) return null;
  const content = firstChoice.message.content;
  if (typeof content === 'string') return content.trim() || null;
  if (Array.isArray(content)) {
    const text = (content as readonly unknown[])
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
    return text || null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function upstreamStatusError(status: number): AiEffectExtractionServiceError {
  if (status === 401 || status === 403) {
    return serviceError('AI_EFFECT_UPSTREAM_AUTH_FAILED', 'AI 上游拒绝了当前凭据', 422);
  }
  if (status === 404) {
    return serviceError('AI_EFFECT_UPSTREAM_ENDPOINT_NOT_FOUND', 'AI 上游接口或模型不存在', 422);
  }
  if (status === 429) {
    return serviceError('AI_EFFECT_UPSTREAM_RATE_LIMIT', 'AI 上游当前限流，请稍后重试', 429);
  }
  return serviceError('AI_EFFECT_UPSTREAM_REJECTED', `AI 上游请求失败（${status}）`, 502);
}

function requiredRow<T>(value: T | undefined): T {
  if (!value) {
    throw serviceError('AI_EFFECT_CONFIG_UNAVAILABLE', 'AI 提取配置写入失败', 503);
  }
  return value;
}

function serviceError(code: string, message: string, statusCode: number) {
  return new AiEffectExtractionServiceError(code, message, statusCode);
}

export const aiEffectExtractionService = new AiEffectExtractionService();
