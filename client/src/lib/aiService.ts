import { apiClient, toApiClientError } from './apiClient';

export type AiApiKeyAction =
  | { readonly action: 'KEEP' }
  | { readonly action: 'REPLACE'; readonly value: string }
  | { readonly action: 'CLEAR' };

export interface AiEffectExtractionConfig {
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

export interface AiEffectExtractionCandidate {
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey: AiApiKeyAction;
}

export interface SaveAiEffectExtractionConfigInput extends AiEffectExtractionCandidate {
  readonly expectedRevision: number;
  readonly enabled: boolean;
}

export interface AiEffectExtractionTestResult {
  readonly ok: true;
  readonly message: string;
  readonly latencyMs: number;
}

export async function fetchAiEffectExtractionConfig(): Promise<AiEffectExtractionConfig> {
  const response = await apiClient.get<AiEffectExtractionConfig>(
    '/api/ai-effect-extraction/admin/config'
  );
  if (!response.data) throw toApiClientError(response, '读取 AI 提取配置失败');
  return response.data;
}

export async function saveAiEffectExtractionConfig(
  input: SaveAiEffectExtractionConfigInput
): Promise<AiEffectExtractionConfig> {
  const response = await apiClient.put<AiEffectExtractionConfig>(
    '/api/ai-effect-extraction/admin/config',
    input
  );
  if (!response.data) throw toApiClientError(response, '保存 AI 提取配置失败');
  return response.data;
}

export async function testAiEffectExtractionCandidate(
  input: AiEffectExtractionCandidate
): Promise<AiEffectExtractionTestResult> {
  const response = await apiClient.post<AiEffectExtractionTestResult>(
    '/api/ai-effect-extraction/admin/test',
    input
  );
  if (!response.data) throw toApiClientError(response, '测试 AI 提取配置失败');
  return response.data;
}

/** 提取结果只返回给当前编辑表单，不会保存或发布卡牌。 */
export async function extractCardEffect(cardCode: string): Promise<string> {
  const response = await apiClient.post<{ text: string }>(
    '/api/ai-effect-extraction/admin/extract',
    { cardCode }
  );
  if (!response.data) throw toApiClientError(response, 'AI 提取失败');
  return response.data.text;
}
