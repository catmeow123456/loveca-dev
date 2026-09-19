import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Eye,
  EyeOff,
  Loader2,
  Save,
  TestTube2,
  Trash2,
} from 'lucide-react';
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
  const [keyVisible, setKeyVisible] = useState(false);
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
    setKeyVisible(false);
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
      setNotice('已保存');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-shell min-h-screen">
      <AdminPageHeader
        title="AI 上游配置"
        category="卡牌与规则"
        onBack={handleBack}
        actions={
          <button
            type="button"
            onClick={handleOpenCardAdmin}
            className="button-secondary px-3 py-2 text-sm"
          >
            卡牌数据
          </button>
        }
      />

      <main className="product-page-main">
        <section className="product-workbench mx-auto max-w-2xl">
          {loading ? (
            <div className="flex min-h-72 items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
              <Loader2 size={17} className="animate-spin" /> 读取中…
            </div>
          ) : config ? (
            <>
              <div className="space-y-5 p-4 sm:p-5">
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
                </label>

                <div>
                  <label
                    htmlFor="ai-upstream-key"
                    className="mb-1.5 block text-sm font-medium text-[var(--text-primary)]"
                  >
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      id="ai-upstream-key"
                      type={keyVisible ? 'text' : 'password'}
                      value={replacementKey}
                      onChange={(event) => {
                        const value = event.target.value;
                        setReplacementKey(value);
                        setKeyMode(value ? 'REPLACE' : 'KEEP');
                        if (!value) setKeyVisible(false);
                        setNotice(null);
                      }}
                      className="input-field w-full py-2.5 pl-3 pr-24"
                      placeholder={
                        keyMode === 'CLEAR'
                          ? '待清除'
                          : config.apiKeyConfigured
                            ? '••••••••'
                            : '输入 API Key'
                      }
                      autoComplete="new-password"
                      spellCheck={false}
                    />
                    <div className="absolute inset-y-0 right-1 flex items-center">
                      <button
                        type="button"
                        aria-label={keyVisible ? '隐藏 Key' : '显示 Key'}
                        title={keyVisible ? '隐藏 Key' : '显示新输入的 Key'}
                        disabled={!replacementKey}
                        onClick={() => setKeyVisible((visible) => !visible)}
                        className="flex size-10 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] disabled:opacity-35"
                      >
                        {keyVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                      </button>
                      <button
                        type="button"
                        aria-label="清除 Key"
                        title="清除 Key"
                        disabled={
                          keyMode === 'CLEAR' || (!config.apiKeyConfigured && !replacementKey)
                        }
                        onClick={() => {
                          setKeyMode(config.apiKeyConfigured ? 'CLEAR' : 'KEEP');
                          setReplacementKey('');
                          setKeyVisible(false);
                          setNotice(null);
                        }}
                        className="flex size-10 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--semantic-error)] disabled:opacity-35"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="border-t border-[var(--border-subtle)] pt-4">
                  <div className="mb-2 flex items-center justify-between gap-4">
                    <label
                      htmlFor="ai-extraction-model"
                      className="text-sm font-medium text-[var(--text-primary)]"
                    >
                      卡效提取模型
                    </label>
                    <label className="flex min-h-8 items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        aria-label="启用卡效提取"
                        checked={enabled}
                        disabled={!enabled && !canEnable}
                        onChange={(event) => setEnabled(event.target.checked)}
                        className="h-5 w-5 shrink-0 accent-[var(--accent-primary)]"
                      />
                      启用
                    </label>
                  </div>
                  <input
                    id="ai-extraction-model"
                    value={modelId}
                    onChange={(event) => setModelId(event.target.value)}
                    className="input-field w-full px-3 py-2.5"
                    placeholder="模型 ID"
                    autoComplete="off"
                  />
                </div>

                {!config.encryptionReady || !config.outboundPolicyReady ? (
                  <Feedback tone="error">
                    {`请配置${[
                      !config.encryptionReady && '密钥加密',
                      !config.outboundPolicyReady && '上游白名单',
                    ]
                      .filter(Boolean)
                      .join('与')}`}
                  </Feedback>
                ) : null}
                {keyMode === 'CLEAR' && enabled ? (
                  <Feedback tone="error">关闭卡效提取后可清除 Key</Feedback>
                ) : null}
                {error ? <Feedback tone="error">{error}</Feedback> : null}
                {notice ? <Feedback tone="success">{notice}</Feedback> : null}
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] px-4 py-3 sm:px-5">
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
                  测试提取
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
                  保存
                </button>
              </footer>
            </>
          ) : (
            <div className="p-5">
              <Feedback tone="error">{error ?? '配置加载失败，请重试。'}</Feedback>
            </div>
          )}
        </section>
      </main>
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
