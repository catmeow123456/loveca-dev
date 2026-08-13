import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
} from 'lucide-react';
import { MatchEmoteVisual } from '@/components/game/MatchEmoteVisual';
import {
  createAdminMatchEmoteId,
  fetchAdminMatchEmoteCatalog,
  saveAdminMatchEmoteCatalog,
  uploadAdminMatchEmoteAsset,
  type AdminMatchEmoteCatalog,
  type AdminMatchEmoteEntry,
} from '@/lib/matchEmoteAdminClient';
import { ApiClientError } from '@/lib/apiClient';
import { cn } from '@/lib/utils';
import { AdminPageHeader } from './AdminPageHeader';

interface MatchEmotesAdminPageProps {
  readonly onBack: () => void;
  readonly onCatalogPublished?: () => void | Promise<void>;
}

export function MatchEmotesAdminPage({ onBack, onCatalogPublished }: MatchEmotesAdminPageProps) {
  const [catalog, setCatalog] = useState<AdminMatchEmoteCatalog | null>(null);
  const [draft, setDraft] = useState<AdminMatchEmoteCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileEditing, setMobileEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'warning' } | null>(
    null
  );
  const addFileRef = useRef<HTMLInputElement>(null);

  const loadCatalog = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await fetchAdminMatchEmoteCatalog();
      setCatalog(next);
      setDraft(next);
      setSelectedId((current) =>
        current && next.items.some((item) => item.id === current)
          ? current
          : (next.items[0]?.id ?? null)
      );
      setNotice(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取快捷表情目录失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const selected = draft?.items.find((item) => item.id === selectedId) ?? null;
  const selectedIndex = draft?.items.findIndex((item) => item.id === selectedId) ?? -1;
  const isDirty = useMemo(
    () => Boolean(catalog && draft && catalogFingerprint(catalog) !== catalogFingerprint(draft)),
    [catalog, draft]
  );
  const enabledCount = draft?.items.filter((item) => item.enabled).length ?? 0;

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const confirmDiscard = useCallback(() => {
    return !isDirty || window.confirm('有未发布修改，确定放弃吗？');
  }, [isDirty]);

  const handleBack = useCallback(() => {
    if (confirmDiscard()) onBack();
  }, [confirmDiscard, onBack]);

  const handleReload = useCallback(() => {
    if (confirmDiscard()) void loadCatalog();
  }, [confirmDiscard, loadCatalog]);

  const handleDiscard = useCallback(() => {
    if (!catalog) return;
    setDraft(catalog);
    setSelectedId((current) =>
      current && catalog.items.some((item) => item.id === current)
        ? current
        : (catalog.items[0]?.id ?? null)
    );
    setNotice(null);
    setError(null);
  }, [catalog]);

  const updateSelected = useCallback(
    (patch: Partial<AdminMatchEmoteEntry>) => {
      if (!selectedId) return;
      setDraft((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === selectedId ? { ...item, ...patch } : item
              ),
            }
          : current
      );
      setNotice(null);
    },
    [selectedId]
  );

  const moveSelected = useCallback(
    (direction: -1 | 1) => {
      if (!draft || !selectedId) return;
      const index = draft.items.findIndex((item) => item.id === selectedId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= draft.items.length) return;
      const items = [...draft.items];
      [items[index], items[target]] = [items[target]!, items[index]!];
      setDraft({ ...draft, items: items.map((item, sortOrder) => ({ ...item, sortOrder })) });
      setNotice(null);
    },
    [draft, selectedId]
  );

  const handleAddAsset = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!draft || draft.items.length >= 12) {
        setError('快捷表情目录最多包含 12 项');
        return;
      }
      setIsUploading(true);
      setError(null);
      setNotice(null);
      try {
        const [id, asset] = await Promise.all([
          createAdminMatchEmoteId(),
          uploadAdminMatchEmoteAsset(file),
        ]);
        setDraft((current) => {
          if (!current) return current;
          const item: AdminMatchEmoteEntry = {
            id,
            label: '新表情',
            shortLabel: '新表情',
            sortOrder: current.items.length,
            enabled: true,
            asset,
          };
          return { ...current, items: [...current.items, item] };
        });
        setSelectedId(id);
        setMobileEditing(true);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : '新增快捷表情失败');
      } finally {
        setIsUploading(false);
      }
    },
    [draft]
  );

  const handleReplaceAsset = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file || !selectedId) return;
      setIsUploading(true);
      setError(null);
      setNotice(null);
      try {
        const asset = await uploadAdminMatchEmoteAsset(file);
        updateSelected({ asset });
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : '替换表情资源失败');
      } finally {
        setIsUploading(false);
      }
    },
    [selectedId, updateSelected]
  );

  const handleSave = useCallback(async () => {
    if (!draft || !isDirty) return;
    setIsSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveAdminMatchEmoteCatalog(draft);
      setCatalog(saved);
      setDraft(saved);
      setNotice({ message: '快捷表情目录已发布', tone: 'success' });
      await onCatalogPublished?.();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存快捷表情目录失败');
      if (
        saveError instanceof ApiClientError &&
        saveError.code === 'MATCH_EMOTE_CATALOG_VERSION_CONFLICT'
      ) {
        setNotice({
          message: '另一位管理员已发布新版本。重新载入后再编辑。',
          tone: 'warning',
        });
      }
    } finally {
      setIsSaving(false);
    }
  }, [draft, isDirty, onCatalogPublished]);

  return (
    <div className="app-shell flex min-h-screen flex-col">
      <AdminPageHeader
        title="快捷表情"
        category="内容与平台"
        onBack={handleBack}
        actions={
          <>
            <button
              type="button"
              onClick={() => addFileRef.current?.click()}
              disabled={!draft || draft.items.length >= 12 || isSaving || isUploading}
              className="button-secondary inline-flex min-h-10 items-center gap-2 px-3 text-sm"
            >
              {isUploading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              <span className="hidden sm:inline">新增表情</span>
              <span className="sm:hidden">新增</span>
            </button>
            <input
              ref={addFileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => void handleAddAsset(event)}
            />
          </>
        }
      />

      <main className="product-page-main flex-1">
        <div className="mx-auto max-w-7xl">
          {error ? (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-4 py-3 text-sm text-[var(--semantic-error)]"
            >
              {error}
            </div>
          ) : null}
          {notice ? (
            <div
              role="status"
              className={cn(
                'mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm text-[var(--text-primary)]',
                notice.tone === 'success'
                  ? 'border-[color:var(--semantic-success)]/35 bg-[color:var(--semantic-success)]/10'
                  : 'border-[color:var(--semantic-warning)]/35 bg-[color:var(--semantic-warning)]/10'
              )}
            >
              <CheckCircle2
                size={16}
                className={
                  notice.tone === 'success'
                    ? 'text-[var(--semantic-success)]'
                    : 'text-[var(--semantic-warning)]'
                }
              />
              {notice.message}
            </div>
          ) : null}

          {isLoading && !draft ? (
            <div className="product-workbench flex min-h-72 items-center justify-center gap-3 text-sm text-[var(--text-secondary)]">
              <Loader2 size={18} className="animate-spin" />
              正在读取快捷表情…
            </div>
          ) : draft ? (
            <>
              <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
                <section
                  aria-label="快捷表情列表"
                  className={cn(
                    'product-workbench min-w-0 lg:sticky lg:top-4 lg:block',
                    mobileEditing && 'hidden'
                  )}
                >
                  <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
                    <div>
                      <h2 className="text-sm font-semibold text-[var(--text-primary)]">发送顺序</h2>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        {draft.items.length} / 12 项 · {enabledCount} 项启用
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleReload}
                      disabled={isLoading || isSaving || isUploading}
                      className="button-icon"
                      aria-label="重新载入快捷表情"
                    >
                      <RefreshCw size={15} className={cn(isLoading && 'animate-spin')} />
                    </button>
                  </div>

                  <div className="product-list lg:max-h-[calc(100vh-12rem)] lg:overflow-y-auto">
                    {draft.items.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(item.id);
                          setMobileEditing(true);
                        }}
                        aria-current={item.id === selectedId ? 'true' : undefined}
                        className={cn(
                          'product-list-row group flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left',
                          item.id === selectedId
                            ? 'border-l-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,var(--bg-surface))]'
                            : 'border-l-transparent',
                          !item.enabled && 'opacity-60'
                        )}
                      >
                        <span className="w-5 shrink-0 text-center text-[10px] font-semibold tabular-nums text-[var(--text-muted)]">
                          {index + 1}
                        </span>
                        <MatchEmoteVisual emote={item.asset} className="h-10 w-10 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[var(--text-primary)]">
                            {item.label}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full',
                                item.enabled
                                  ? 'bg-[var(--semantic-success)]'
                                  : 'bg-[var(--text-muted)]'
                              )}
                            />
                            {item.enabled ? item.shortLabel : '已停用'}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {selected ? (
                  <section
                    className={cn(
                      'product-workbench min-w-0 overflow-hidden lg:block',
                      !mobileEditing && 'hidden'
                    )}
                  >
                    <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
                      <div className="flex min-w-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setMobileEditing(false)}
                          className="button-icon -ml-1 lg:!hidden"
                          aria-label="返回快捷表情列表"
                        >
                          <ArrowLeft size={16} />
                        </button>
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                            编辑表情
                          </h2>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-[var(--text-muted)]">
                            {selected.id}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => moveSelected(-1)}
                          disabled={selectedIndex <= 0}
                          className="button-icon"
                          aria-label="向前移动"
                        >
                          <ArrowUp size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveSelected(1)}
                          disabled={selectedIndex === draft.items.length - 1}
                          className="button-icon"
                          aria-label="向后移动"
                        >
                          <ArrowDown size={15} />
                        </button>
                      </div>
                    </div>

                    <div className="p-4 sm:p-5">
                      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_15rem]">
                        <fieldset className="grid content-start gap-4 sm:grid-cols-2">
                          <legend className="sr-only">表情基本信息</legend>
                          <label className="block sm:col-span-2">
                            <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                              完整名称
                            </span>
                            <input
                              value={selected.label}
                              maxLength={80}
                              onChange={(event) => updateSelected({ label: event.target.value })}
                              className="input-field w-full px-3 py-2.5 text-sm"
                            />
                            <span className="mt-1 block text-[10px] text-[var(--text-muted)]">
                              用于聊天记录和无障碍名称，最多 40 个字符。
                            </span>
                          </label>
                          <label className="block">
                            <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                              菜单短名称
                            </span>
                            <input
                              value={selected.shortLabel}
                              maxLength={24}
                              onChange={(event) =>
                                updateSelected({ shortLabel: event.target.value })
                              }
                              className="input-field w-full px-3 py-2.5 text-sm"
                            />
                            <span className="mt-1 block text-[10px] text-[var(--text-muted)]">
                              最多 12 个字符。
                            </span>
                          </label>
                          <label className="flex min-h-[4.45rem] items-center justify-between gap-4 rounded-lg border border-[var(--border-default)] px-3 py-2.5">
                            <span>
                              <span className="block text-sm font-medium text-[var(--text-primary)]">
                                允许发送
                              </span>
                              <span className="mt-0.5 block text-[10px] leading-4 text-[var(--text-muted)]">
                                关闭后从玩家菜单隐藏
                              </span>
                            </span>
                            <input
                              type="checkbox"
                              checked={selected.enabled}
                              onChange={(event) =>
                                updateSelected({ enabled: event.target.checked })
                              }
                              className="h-5 w-5 accent-[var(--accent-primary)]"
                            />
                          </label>
                        </fieldset>

                        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[var(--text-secondary)]">
                              图片
                            </span>
                            <label className="button-ghost inline-flex min-h-8 cursor-pointer items-center gap-1.5 px-2 text-xs">
                              <ImagePlus size={14} />
                              替换
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="sr-only"
                                disabled={isUploading || isSaving}
                                onChange={(event) => void handleReplaceAsset(event)}
                              />
                            </label>
                          </div>
                          <div className="flex min-h-36 items-center justify-center py-2">
                            <MatchEmoteVisual emote={selected.asset} className="h-28 w-28" />
                          </div>
                          <details className="border-t border-[var(--border-subtle)] pt-2 text-xs text-[var(--text-secondary)]">
                            <summary className="cursor-pointer select-none text-[var(--text-muted)]">
                              图片信息 · {selected.asset.width} × {selected.asset.height}
                            </summary>
                            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
                              <dt>帧数</dt>
                              <dd>{selected.asset.frameCount}</dd>
                              <dt>时长</dt>
                              <dd>{selected.asset.durationMs} ms</dd>
                              <dt>动画</dt>
                              <dd>{selected.asset.animatedImageUrl ? 'WebP' : '无'}</dd>
                            </dl>
                          </details>
                        </div>
                      </div>

                      <EmoteContextPreview item={selected} />
                    </div>
                  </section>
                ) : null}
              </div>

              {isDirty ? (
                <div
                  role="region"
                  aria-label="未发布修改"
                  className="sticky bottom-3 z-20 mx-auto mt-4 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_35%,var(--border-default))] bg-[var(--bg-frosted)] px-3 py-2.5 shadow-[var(--shadow-lg)] backdrop-blur sm:px-4"
                >
                  <span className="text-sm font-medium text-[var(--text-primary)]">
                    有未发布修改
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleDiscard}
                      disabled={isSaving || isUploading}
                      className="button-ghost inline-flex min-h-9 items-center gap-1.5 px-3 text-xs"
                    >
                      <RotateCcw size={14} />
                      放弃修改
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={isSaving || isUploading}
                      className="button-primary inline-flex min-h-9 items-center gap-1.5 px-3 text-xs"
                    >
                      {isSaving ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      保存并生效
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="product-workbench flex min-h-72 flex-col items-center justify-center gap-3 px-4 text-center text-sm text-[var(--text-secondary)]">
              <p>快捷表情目录未能载入。</p>
              <button
                type="button"
                onClick={() => void loadCatalog()}
                className="button-secondary px-3 py-2"
              >
                重新载入
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function EmoteContextPreview({ item }: { readonly item: AdminMatchEmoteEntry }) {
  return (
    <section
      className="mt-5 border-t border-[var(--border-subtle)] pt-4"
      aria-labelledby="emote-preview-title"
    >
      <div className="mb-3">
        <h3 id="emote-preview-title" className="text-sm font-semibold text-[var(--text-primary)]">
          玩家端预览
        </h3>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">按实际显示尺寸预览三个使用位置。</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <PreviewCell label="发送菜单">
          <div className="inline-flex min-h-[76px] min-w-24 flex-col items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1.5">
            <MatchEmoteVisual emote={item.asset} className="h-11 w-11" />
            <span className="mt-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
              {item.shortLabel}
            </span>
          </div>
        </PreviewCell>
        <PreviewCell label="聊天条目">
          <div className="flex w-fit min-w-[190px] items-center gap-3 rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_38%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-surface))] px-3 py-2.5">
            <MatchEmoteVisual emote={item.asset} className="h-[70px] w-[70px]" />
            <span className="max-w-40 text-sm font-bold text-[var(--text-primary)]">
              {item.label}
            </span>
          </div>
        </PreviewCell>
        <PreviewCell label="身份旁浮层">
          <div className="flex w-[220px] max-w-full items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_28%,var(--border-default))] bg-[var(--bg-frosted)] px-2.5 py-2 shadow-[var(--shadow-md)]">
            <MatchEmoteVisual emote={item.asset} className="h-[64px] w-[64px]" />
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold text-[var(--text-muted)]">
                对手玩家
              </span>
              <span className="mt-0.5 block text-sm font-bold text-[var(--text-primary)]">
                {item.label}
              </span>
            </span>
          </div>
        </PreviewCell>
      </div>
    </section>
  );
}

function PreviewCell({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-[var(--bg-overlay)] p-3">
      <div className="mb-2 text-[10px] font-semibold text-[var(--text-muted)]">{label}</div>
      <div className="flex min-h-24 items-center overflow-hidden">{children}</div>
    </div>
  );
}

function catalogFingerprint(catalog: AdminMatchEmoteCatalog): string {
  return JSON.stringify(
    catalog.items.map((item) => ({
      id: item.id,
      label: item.label,
      shortLabel: item.shortLabel,
      enabled: item.enabled,
      assetId: item.asset.id,
    }))
  );
}
