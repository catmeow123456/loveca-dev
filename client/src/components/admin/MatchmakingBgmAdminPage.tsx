import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  CheckCircle2,
  CircleAlert,
  Library,
  Loader2,
  Music2,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  deleteAdminMatchmakingBgm,
  fetchMatchmakingBgmLibrary,
  saveAdminDefaultMatchmakingBgmTracks,
  uploadAdminMatchmakingBgm,
  type MatchmakingBgmTrack,
} from '@/lib/matchmakingBgmClient';
import { AdminPageHeader } from './AdminPageHeader';

interface MatchmakingBgmAdminPageProps {
  readonly onBack: () => void;
}

type UploadQueueStatus = 'PENDING' | 'UPLOADING' | 'SUCCEEDED' | 'FAILED';

interface UploadQueueItem {
  readonly id: string;
  readonly file: File;
  readonly title: string;
  readonly status: UploadQueueStatus;
  readonly progress: number | null;
  readonly error: string | null;
}

export function MatchmakingBgmAdminPage({ onBack }: MatchmakingBgmAdminPageProps) {
  const [tracks, setTracks] = useState<readonly MatchmakingBgmTrack[]>([]);
  const [savedDefaultIds, setSavedDefaultIds] = useState<readonly string[]>([]);
  const [draftDefaultIds, setDraftDefaultIds] = useState<readonly string[]>([]);
  const [uploadQueue, setUploadQueue] = useState<readonly UploadQueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);
  const isDefaultDirty = useMemo(
    () => !sameIdSet(savedDefaultIds, draftDefaultIds),
    [draftDefaultIds, savedDefaultIds]
  );

  const replaceTracks = useCallback((nextTracks: readonly MatchmakingBgmTrack[]) => {
    const nextDefaultIds = nextTracks
      .filter((track) => track.defaultSelected)
      .map((track) => track.id);
    setTracks(nextTracks);
    setSavedDefaultIds(nextDefaultIds);
    setDraftDefaultIds(nextDefaultIds);
  }, []);

  const loadTracks = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      replaceTracks(await fetchMatchmakingBgmLibrary());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取候场 BGM 曲库失败');
    } finally {
      setIsLoading(false);
    }
  }, [replaceTracks]);

  useEffect(() => {
    let active = true;
    void fetchMatchmakingBgmLibrary()
      .then((nextTracks) => {
        if (active) replaceTracks(nextTracks);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : '读取候场 BGM 曲库失败');
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [replaceTracks]);

  useEffect(() => {
    return () => uploadAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!isDefaultDirty && !isUploading) return;
    const preventNavigation = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', preventNavigation);
    return () => window.removeEventListener('beforeunload', preventNavigation);
  }, [isDefaultDirty, isUploading]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    setUploadQueue(
      files.map((file, index) => ({
        id: `${file.name}:${file.size}:${file.lastModified}:${index}`,
        file,
        title: titleFromFilename(file.name),
        status: 'PENDING',
        progress: 0,
        error: null,
      }))
    );
    setError(null);
    setNotice(null);
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const queuedItems = uploadQueue.filter(
      (item) => item.status === 'PENDING' || item.status === 'FAILED'
    );
    if (queuedItems.length === 0) {
      setError('请选择要上传的 MP3 文件');
      return;
    }
    if (queuedItems.some((item) => !item.title.trim())) {
      setError('请填写所有曲目的曲名');
      return;
    }

    setIsUploading(true);
    setError(null);
    setNotice(null);
    setUploadQueue((current) =>
      current.map((item) =>
        item.status === 'FAILED' ? { ...item, status: 'PENDING', progress: 0, error: null } : item
      )
    );
    const controller = new AbortController();
    uploadAbortControllerRef.current = controller;
    let succeededCount = 0;
    let failedCount = 0;

    for (const item of queuedItems) {
      if (controller.signal.aborted) break;
      updateUploadQueueItem(setUploadQueue, item.id, {
        status: 'UPLOADING',
        progress: 0,
        error: null,
      });
      try {
        const uploaded = await uploadAdminMatchmakingBgm({
          file: item.file,
          title: item.title.trim(),
          signal: controller.signal,
          onProgress: (progress) => {
            updateUploadQueueItem(setUploadQueue, item.id, { progress });
          },
        });
        setTracks((current) =>
          current.some((track) => track.id === uploaded.id) ? current : [...current, uploaded]
        );
        updateUploadQueueItem(setUploadQueue, item.id, {
          status: 'SUCCEEDED',
          progress: 100,
          error: null,
        });
        succeededCount += 1;
      } catch (uploadError) {
        if (controller.signal.aborted) break;
        updateUploadQueueItem(setUploadQueue, item.id, {
          status: 'FAILED',
          error: uploadError instanceof Error ? uploadError.message : '上传 BGM 失败',
        });
        failedCount += 1;
      }
    }

    uploadAbortControllerRef.current = null;
    setIsUploading(false);
    if (controller.signal.aborted) return;
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (failedCount > 0) {
      setError(
        succeededCount > 0
          ? `${succeededCount} 首上传成功，${failedCount} 首失败；可修改后重试失败项。`
          : `${failedCount} 首曲目上传失败；可修改后重试。`
      );
    } else {
      setNotice(`${succeededCount} 首曲目已加入候场曲库`);
    }
  };

  const updateQueuedTitle = (id: string, title: string) => {
    updateUploadQueueItem(setUploadQueue, id, { title, status: 'PENDING', error: null });
    setError(null);
  };

  const removeQueuedFile = (id: string) => {
    setUploadQueue((current) => current.filter((item) => item.id !== id));
    setError(null);
  };

  const handleDelete = async (track: MatchmakingBgmTrack) => {
    if (!window.confirm(`确定从候场曲库删除“${track.title}”吗？`)) return;
    setDeletingId(track.id);
    setError(null);
    setNotice(null);
    try {
      await deleteAdminMatchmakingBgm(track.id);
      setTracks((current) => current.filter((item) => item.id !== track.id));
      setSavedDefaultIds((current) => current.filter((id) => id !== track.id));
      setDraftDefaultIds((current) => current.filter((id) => id !== track.id));
      setNotice(`“${track.title}”已从候场曲库删除`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 BGM 失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveDefaults = async () => {
    setIsSavingDefaults(true);
    setError(null);
    setNotice(null);
    try {
      const nextTracks = await saveAdminDefaultMatchmakingBgmTracks(draftDefaultIds);
      replaceTracks(nextTracks);
      setNotice(`平台默认候场曲目已更新，共 ${draftDefaultIds.length} 首`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存默认候场曲目失败');
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const toggleDefaultTrack = (trackId: string, checked: boolean) => {
    setDraftDefaultIds((current) =>
      checked ? [...current, trackId] : current.filter((id) => id !== trackId)
    );
    setNotice(null);
  };

  const handleBack = () => {
    const warning = [
      isUploading ? '曲目仍在上传，离开会中止剩余任务。' : null,
      isDefaultDirty ? '默认候场曲目尚未保存。' : null,
    ]
      .filter(Boolean)
      .join('\n');
    if (warning && !window.confirm(`${warning}\n确定离开吗？`)) return;
    uploadAbortControllerRef.current?.abort();
    onBack();
  };

  const readyUploadCount = uploadQueue.filter(
    (item) => item.status === 'PENDING' || item.status === 'FAILED'
  ).length;
  const processedUploadCount = uploadQueue.filter(
    (item) => item.status === 'SUCCEEDED' || item.status === 'FAILED'
  ).length;
  const currentUpload = uploadQueue.find((item) => item.status === 'UPLOADING') ?? null;
  const overallUploadProgress =
    uploadQueue.length === 0
      ? 0
      : Math.round(
          ((processedUploadCount * 100 + (currentUpload?.progress ?? 0)) / uploadQueue.length) * 10
        ) / 10;

  const handleReload = () => {
    if (isDefaultDirty && !window.confirm('重新载入会放弃未保存的默认曲目选择，继续吗？')) {
      return;
    }
    void loadTracks();
  };

  return (
    <div className="app-shell min-h-screen">
      <AdminPageHeader title="候场 BGM" category="内容与平台" onBack={handleBack} />

      <main className="product-page-main">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <section className="product-workbench">
            <header className="product-workbench-toolbar">
              <div>
                <div className="flex items-center gap-2">
                  <Upload size={16} className="text-[var(--accent-primary)]" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">上传曲目</h2>
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  可一次选择多首，系统将按列表顺序逐首上传；曲名默认取自文件名，也可在上传前修改。
                </p>
              </div>
              <span className="text-xs tabular-nums text-[var(--text-muted)]">MP3 · 20 MB 内</span>
            </header>

            <form onSubmit={(event) => void handleUpload(event)}>
              <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:p-5">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-xs font-semibold text-[var(--text-secondary)]">
                    MP3 文件
                  </span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/mpeg,.mp3"
                    multiple
                    onChange={handleFileChange}
                    disabled={isUploading}
                    className="block min-h-10 w-full cursor-pointer rounded-[var(--radius-control)] border border-[var(--border-default)] bg-[var(--bg-input)] text-xs text-[var(--text-secondary)] file:mr-3 file:min-h-10 file:border-0 file:border-r file:border-[var(--border-subtle)] file:bg-[var(--bg-elevated)] file:px-3 file:text-xs file:font-semibold file:text-[var(--accent-primary)]"
                  />
                </label>

                <button
                  type="submit"
                  disabled={
                    isUploading ||
                    readyUploadCount === 0 ||
                    uploadQueue.some(
                      (item) =>
                        (item.status === 'PENDING' || item.status === 'FAILED') &&
                        !item.title.trim()
                    )
                  }
                  className="button-primary inline-flex min-h-10 items-center justify-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isUploading ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload size={15} aria-hidden="true" />
                  )}
                  {isUploading ? '正在串行上传' : `上传 ${readyUploadCount || ''} 首`.trim()}
                </button>
              </div>

              {uploadQueue.length > 0 ? (
                <div className="border-t border-[var(--border-subtle)]">
                  <div className="flex items-center justify-between gap-3 bg-[var(--bg-overlay)] px-4 py-2.5 text-xs sm:px-5">
                    <span className="font-semibold text-[var(--text-secondary)]">
                      上传队列 · {processedUploadCount}/{uploadQueue.length}
                    </span>
                    <span className="tabular-nums text-[var(--text-muted)]">
                      {isUploading ? `${overallUploadProgress}%` : '按列表顺序逐首上传'}
                    </span>
                  </div>
                  {isUploading ? (
                    <div
                      className="h-1 bg-[var(--border-subtle)]"
                      role="progressbar"
                      aria-label="全部曲目上传进度"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={overallUploadProgress}
                    >
                      <div
                        className="h-full bg-[var(--accent-primary)] transition-[width]"
                        style={{ width: `${overallUploadProgress}%` }}
                      />
                    </div>
                  ) : null}
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {uploadQueue.map((item) => (
                      <UploadQueueRow
                        key={item.id}
                        item={item}
                        disabled={isUploading}
                        onTitleChange={(title) => updateQueuedTitle(item.id, title)}
                        onRemove={() => removeQueuedFile(item.id)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </form>
          </section>

          {error || notice ? (
            <div
              role={error ? 'alert' : 'status'}
              className={`rounded-[var(--radius-control)] border px-4 py-3 text-sm ${
                error
                  ? 'border-[color:color-mix(in_srgb,var(--semantic-error)_35%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-error)_8%,var(--bg-surface))] text-[var(--semantic-error)]'
                  : 'border-[color:color-mix(in_srgb,var(--semantic-success)_35%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-success)_8%,var(--bg-surface))] text-[var(--semantic-success)]'
              }`}
            >
              {error ?? notice}
            </div>
          ) : null}

          <section className="product-workbench" aria-labelledby="bgm-library-title">
            <header className="product-workbench-toolbar">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]">
                  <Library size={17} aria-hidden="true" />
                </span>
                <div>
                  <h2
                    id="bgm-library-title"
                    className="text-sm font-semibold text-[var(--text-primary)]"
                  >
                    当前曲库
                  </h2>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {isLoading
                      ? '正在读取'
                      : `${tracks.length} 首曲目 · 默认 ${draftDefaultIds.length} 首`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleReload}
                  disabled={isLoading || isUploading || deletingId !== null || isSavingDefaults}
                  className="button-secondary inline-flex min-h-10 items-center gap-2 px-3 text-sm disabled:opacity-45"
                >
                  <RefreshCw
                    size={15}
                    className={isLoading ? 'animate-spin' : undefined}
                    aria-hidden="true"
                  />
                  重新载入
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveDefaults()}
                  disabled={!isDefaultDirty || isSavingDefaults || deletingId !== null}
                  className="button-primary inline-flex min-h-10 items-center gap-2 px-3 text-sm disabled:opacity-45"
                >
                  {isSavingDefaults ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Save size={15} aria-hidden="true" />
                  )}
                  保存默认子集
                </button>
              </div>
            </header>

            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
                <Loader2 size={17} className="animate-spin" aria-hidden="true" />
                正在读取曲库
              </div>
            ) : tracks.length === 0 ? (
              <div className="flex min-h-48 flex-col items-center justify-center px-5 py-10 text-center">
                <Music2 size={28} className="text-[var(--text-muted)]" aria-hidden="true" />
                <h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">曲库为空</h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--text-muted)]">
                  上传第一首 MP3 后，新进入候场的玩家即可随机听到它。
                </p>
              </div>
            ) : (
              <div className="product-list">
                {tracks.map((track, index) => (
                  <article
                    key={track.id}
                    className="product-list-row grid gap-3 px-4 py-4 sm:grid-cols-[minmax(12rem,1fr)_minmax(15rem,1.15fr)_auto_auto] sm:items-center sm:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="relative flex h-10 w-10 shrink-0 items-end justify-center gap-0.5 overflow-hidden rounded-lg bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-elevated))] pb-2 text-[var(--accent-primary)]">
                        {[10, 18, 13, 21].map((height, barIndex) => (
                          <span
                            key={barIndex}
                            aria-hidden="true"
                            className="w-0.5 rounded-full bg-current opacity-80"
                            style={{ height: `${height}px` }}
                          />
                        ))}
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
                          {track.title}
                        </h3>
                        <p className="mt-1 text-xs tabular-nums text-[var(--text-muted)]">
                          {String(index + 1).padStart(2, '0')} · {formatBytes(track.byteSize)} ·{' '}
                          {track.source === 'BUNDLED' ? '内置曲目' : '管理员上传'}
                        </p>
                      </div>
                    </div>

                    <audio
                      controls
                      preload="none"
                      src={track.audioUrl}
                      aria-label={`试听 ${track.title}`}
                      className="h-10 w-full min-w-0"
                    />

                    <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 text-xs font-semibold text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        checked={draftDefaultIds.includes(track.id)}
                        onChange={(event) => toggleDefaultTrack(track.id, event.target.checked)}
                        disabled={isSavingDefaults || deletingId !== null}
                        className="h-4 w-4 accent-[var(--accent-primary)]"
                      />
                      默认播放
                    </label>

                    <button
                      type="button"
                      onClick={() => void handleDelete(track)}
                      disabled={deletingId !== null || isUploading}
                      className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 px-3 text-sm text-[var(--semantic-error)] disabled:opacity-45 sm:justify-start"
                      aria-label={`删除 ${track.title}`}
                    >
                      {deletingId === track.id ? (
                        <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 size={15} aria-hidden="true" />
                      )}
                      删除
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadQueueRow({
  item,
  disabled,
  onTitleChange,
  onRemove,
}: {
  item: UploadQueueItem;
  disabled: boolean;
  onTitleChange: (title: string) => void;
  onRemove: () => void;
}) {
  const status = uploadQueueStatus(item);
  return (
    <div className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className={status.className} aria-hidden="true">
            {status.icon}
          </span>
          <input
            value={item.title}
            onChange={(event) => onTitleChange(event.target.value)}
            maxLength={100}
            disabled={disabled || item.status === 'SUCCEEDED'}
            aria-label={`${item.file.name} 的曲名`}
            className="input-field min-h-9 min-w-0 flex-1 px-2.5 text-sm"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-[11px] text-[var(--text-muted)]">
          <span className="max-w-full truncate" title={item.file.name}>
            {item.file.name}
          </span>
          <span aria-hidden="true">·</span>
          <span className="tabular-nums">{formatBytes(item.file.size)}</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold">{status.label}</span>
        </div>
        {item.status === 'UPLOADING' ? (
          <div
            className="mt-2 ml-6 h-1 overflow-hidden rounded-full bg-[var(--border-subtle)]"
            role="progressbar"
            aria-label={`${item.title} 上传进度`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.progress ?? undefined}
          >
            <div
              className={`h-full bg-[var(--accent-primary)] transition-[width] ${
                item.progress === null ? 'w-1/3 animate-pulse' : ''
              }`}
              style={item.progress === null ? undefined : { width: `${item.progress}%` }}
            />
          </div>
        ) : null}
        {item.error ? (
          <p className="mt-1.5 pl-6 text-xs text-[var(--semantic-error)]" role="alert">
            {item.error}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="button-ghost inline-flex min-h-9 items-center justify-center gap-1.5 px-2.5 text-xs text-[var(--text-muted)] disabled:opacity-45"
        aria-label={`从上传队列移除 ${item.file.name}`}
      >
        <X size={14} aria-hidden="true" />
        移除
      </button>
    </div>
  );
}

function uploadQueueStatus(item: UploadQueueItem): {
  readonly label: string;
  readonly className: string;
  readonly icon: ReactNode;
} {
  switch (item.status) {
    case 'UPLOADING':
      return {
        label: item.progress === null ? '上传中' : `上传中 ${item.progress}%`,
        className: 'text-[var(--accent-primary)]',
        icon: <Loader2 size={15} className="animate-spin" />,
      };
    case 'SUCCEEDED':
      return {
        label: '上传成功',
        className: 'text-[var(--semantic-success)]',
        icon: <CheckCircle2 size={15} />,
      };
    case 'FAILED':
      return {
        label: '上传失败',
        className: 'text-[var(--semantic-error)]',
        icon: <CircleAlert size={15} />,
      };
    default:
      return {
        label: '等待上传',
        className: 'text-[var(--text-muted)]',
        icon: <Music2 size={15} />,
      };
  }
}

function updateUploadQueueItem(
  setQueue: Dispatch<SetStateAction<readonly UploadQueueItem[]>>,
  id: string,
  patch: Partial<Pick<UploadQueueItem, 'title' | 'status' | 'progress' | 'error'>>
): void {
  setQueue((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
}

function titleFromFilename(filename: string): string {
  return filename.replace(/\.[^.]+$/u, '').trim() || '未命名 BGM';
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id) => right.includes(id));
}
