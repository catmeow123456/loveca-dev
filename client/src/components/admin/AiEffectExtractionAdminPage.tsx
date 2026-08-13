import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CircleAlert, KeyRound, Loader2, Save, TestTube2 } from 'lucide-react';
import {
  fetchAiEffectExtractionConfig,
  saveAiEffectExtractionConfig,
  testAiEffectExtractionCandidate,
  type AiApiKeyAction,
  type AiEffectExtractionConfig,
} from '@/lib/aiService';
import { AdminPageHeader } from './AdminPageHeader';

interface AiEffectExtractionAdminPageProps {
  readonly onBack: () => void;
  readonly onOpenCardAdmin: () => void;
}

type KeyMode = AiApiKeyAction['action'];

export function AiEffectExtractionAdminPage({
  onBack,
  onOpenCardAdmin,
}: AiEffectExtractionAdminPageProps) {
  const [config, setConfig] = useState<AiEffectExtractionConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [keyMode, setKeyMode] = useState<KeyMode>('KEEP');
  const [replacementKey, setReplacementKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const applyConfig = useCallback((next: AiEffectExtractionConfig) => {
    setConfig(next);
    setBaseUrl(next.baseUrl);
    setModelId(next.modelId);
    setEnabled(next.enabled);
    setKeyMode('KEEP');
    setReplacementKey('');
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAiEffectExtractionConfig()
      .then((next) => {
        if (!cancelled) applyConfig(next);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '读取配置失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyConfig]);

  const keyAction = useMemo<AiApiKeyAction>(() => {
    if (keyMode === 'REPLACE') return { action: 'REPLACE', value: replacementKey };
    if (keyMode === 'CLEAR') return { action: 'CLEAR' };
    return { action: 'KEEP' };
  }, [keyMode, replacementKey]);

  const isDirty = Boolean(
    config &&
    (baseUrl !== config.baseUrl ||
      modelId !== config.modelId ||
      enabled !== config.enabled ||
      keyMode !== 'KEEP')
  );
  const formComplete = Boolean(baseUrl.trim() && modelId.trim());
  const candidateHasKey =
    keyMode === 'REPLACE'
      ? Boolean(replacementKey.trim())
      : keyMode === 'KEEP' && config?.apiKeyConfigured;
  const canTest = formComplete && Boolean(candidateHasKey) && !testing && !saving;
  const canEnable =
    Boolean(config?.encryptionReady && config.outboundPolicyReady) &&
    formComplete &&
    Boolean(candidateHasKey);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const canLeave = () => !isDirty || window.confirm('有未保存修改，确定离开吗？');

  const handleBack = () => {
    if (canLeave()) onBack();
  };

  const handleOpenCardAdmin = () => {
    if (canLeave()) onOpenCardAdmin();
  };

  const handleTest = async () => {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await testAiEffectExtractionCandidate({ baseUrl, modelId, apiKey: keyAction });
      setNotice(`${result.message}（${result.latencyMs} ms）`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '测试失败');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!config || !isDirty) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await saveAiEffectExtractionConfig({
        expectedRevision: config.revision,
        enabled,
        baseUrl,
        modelId,
        apiKey: keyAction,
      });
      applyConfig(next);
      setNotice('配置已保存；下一次提取将使用新版本。');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-shell min-h-screen">
      <AdminPageHeader
        title="卡牌效果 AI 提取"
        category="卡牌与规则"
        onBack={handleBack}
        actions={
          <button
            type="button"
            onClick={handleOpenCardAdmin}
            className="button-secondary px-3 py-2 text-sm"
          >
            打开卡牌数据
          </button>
        }
      />

      <main className="product-page-main">
        <section className="product-workbench mx-auto max-w-4xl">
          {loading ? (
            <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
              <Loader2 size={17} className="animate-spin" /> 正在读取私密配置…
            </div>
          ) : config ? (
            <>
              <div className="grid grid-cols-2 border-b border-[var(--border-subtle)] sm:grid-cols-4">
                <StatusCell label="密钥加密" ready={config.encryptionReady} />
                <StatusCell label="上游白名单" ready={config.outboundPolicyReady} />
                <StatusCell label="API Key" ready={config.apiKeyConfigured} />
                <StatusCell label="当前可用" ready={config.runtimeReady} />
              </div>

              <div className="p-4 sm:p-5">
                <div className="mb-5">
                  <h2 className="font-semibold text-[var(--text-primary)]">上游配置</h2>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                    API 服务读取受信任卡图并调用 OpenAI-compatible 上游；提取结果只回填卡牌编辑框。
                  </p>
                </div>

                <div className="space-y-5">
                  <fieldset className="grid gap-4 sm:grid-cols-[minmax(0,1.5fr)_minmax(12rem,0.75fr)]">
                    <legend className="sr-only">模型上游</legend>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                        Base URL
                      </span>
                      <input
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        className="input-field w-full px-3 py-2.5"
                        placeholder="https://provider.example/v1"
                        autoComplete="off"
                      />
                      <span className="mt-1.5 block text-xs text-[var(--text-muted)]">
                        仅允许部署白名单内的 HTTPS 主机，不跟随重定向。
                      </span>
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]">
                        Model ID
                      </span>
                      <input
                        value={modelId}
                        onChange={(event) => setModelId(event.target.value)}
                        className="input-field w-full px-3 py-2.5"
                        placeholder="vision-model"
                        autoComplete="off"
                      />
                    </label>
                  </fieldset>

                  <fieldset>
                    <legend className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                      <KeyRound size={15} /> API Key
                    </legend>
                    <div className="grid overflow-hidden rounded-lg border border-[var(--border-default)] sm:grid-cols-3 sm:divide-x sm:divide-[var(--border-default)]">
                      {(
                        [
                          ['KEEP', '保留当前 Key'],
                          ['REPLACE', '替换 Key'],
                          ['CLEAR', '清除 Key'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={keyMode === value}
                          onClick={() => {
                            setKeyMode(value);
                            if (value !== 'REPLACE') setReplacementKey('');
                            setNotice(null);
                          }}
                          className={`min-h-10 border-b border-[var(--border-default)] px-3 text-sm font-medium transition-colors last:border-b-0 sm:border-b-0 ${
                            keyMode === value
                              ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--text-primary)]'
                              : 'bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {keyMode === 'REPLACE' ? (
                      <input
                        type="password"
                        value={replacementKey}
                        onChange={(event) => setReplacementKey(event.target.value)}
                        className="input-field mt-3 w-full px-3 py-2.5"
                        placeholder="输入新的 API Key"
                        autoComplete="new-password"
                      />
                    ) : (
                      <p className="mt-2 text-xs text-[var(--text-muted)]">
                        {keyMode === 'KEEP'
                          ? config.apiKeyConfigured
                            ? '已有 Key 已加密保存，页面不会读取或显示原值。'
                            : '当前尚未配置 Key。'
                          : '保存后立即移除密文；启用状态下不能清除 Key。'}
                      </p>
                    )}
                  </fieldset>

                  <label className="flex items-center justify-between gap-4 rounded-lg border border-[var(--border-default)] px-3 py-3">
                    <span>
                      <span className="block text-sm font-semibold text-[var(--text-primary)]">
                        启用效果提取
                      </span>
                      <span className="mt-0.5 block text-xs leading-5 text-[var(--text-secondary)]">
                        关闭时保留配置，但拒绝新的提取请求。
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={!enabled && !canEnable}
                      onChange={(event) => setEnabled(event.target.checked)}
                      className="h-5 w-5 shrink-0 accent-[var(--accent-primary)]"
                    />
                  </label>

                  {error ? <Feedback tone="error">{error}</Feedback> : null}
                  {notice ? <Feedback tone="success">{notice}</Feedback> : null}
                </div>
              </div>

              <footer className="flex flex-col-reverse gap-3 border-t border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <p className="text-xs text-[var(--text-muted)]">
                  版本 {config.revision}
                  {config.updatedAt ? ` · 更新于 ${formatDate(config.updatedAt)}` : ''}
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTest()}
                    disabled={!canTest}
                    className="button-secondary inline-flex min-h-10 items-center justify-center gap-2 px-4 disabled:opacity-45"
                  >
                    {testing ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <TestTube2 size={15} />
                    )}
                    测试配置
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={
                      !isDirty ||
                      saving ||
                      testing ||
                      (enabled && !canEnable) ||
                      (keyMode === 'REPLACE' && !replacementKey.trim())
                    }
                    className="button-primary inline-flex min-h-10 items-center justify-center gap-2 px-4 disabled:opacity-45"
                  >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    保存并生效
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <div className="p-5">
              <Feedback tone="error">配置未能载入。请检查数据库迁移和 API 服务状态。</Feedback>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StatusCell({ label, ready }: { readonly label: string; readonly ready: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-r border-[var(--border-subtle)] px-3 py-2.5 last:border-r-0 sm:border-b-0 sm:px-4">
      <span className="text-xs text-[var(--text-secondary)]">{label}</span>
      <span
        className={`text-xs font-medium ${ready ? 'text-[var(--semantic-success)]' : 'text-[var(--text-muted)]'}`}
      >
        {ready ? '就绪' : '未就绪'}
      </span>
    </div>
  );
}

function Feedback({ tone, children }: { tone: 'error' | 'success'; children: string }) {
  const Icon = tone === 'error' ? CircleAlert : CheckCircle2;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${
        tone === 'error'
          ? 'border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_9%,transparent)] text-[var(--semantic-error)]'
          : 'border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_9%,transparent)] text-[var(--semantic-success)]'
      }`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}
