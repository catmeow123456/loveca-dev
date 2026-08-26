import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ImagePlus, Loader2, Moon, Save, Sun, Trash2, X } from 'lucide-react';
import type {
  ActivityCoverActivityType,
  ActivityCoverAdminView,
  ActivityCoverFocus,
  ActivityCoverLayout,
  ActivityCoverMaskLevel,
} from '@game/online/activity-cover-types';
import {
  downloadActivityCoverSource,
  fetchActivityCoverAdmin,
  removeActivityCover,
  saveActivityCover,
} from '@/lib/activityCoverClient';
import { computeActivityCoverCrop, inferActivityCoverZoom } from '@/lib/activityCoverCrop';
import { cn } from '@/lib/utils';
import './activity-cover-editor.css';

interface SourceDraft {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly file: File | null;
}

interface LayoutDraft {
  readonly focus: ActivityCoverFocus;
  readonly zoom: number;
}

export function ActivityCoverEditor({
  activityType,
  activityId,
  activityName,
  onClose,
  onPublished,
}: {
  readonly activityType: ActivityCoverActivityType;
  readonly activityId: string;
  readonly activityName: string;
  readonly onClose: () => void;
  readonly onPublished?: () => void | Promise<void>;
}) {
  const [cover, setCover] = useState<ActivityCoverAdminView | null>(null);
  const [source, setSource] = useState<SourceDraft | null>(null);
  const [wide, setWide] = useState<LayoutDraft>(defaultLayoutDraft());
  const [compact, setCompact] = useState<LayoutDraft>(defaultLayoutDraft());
  const [maskLevel, setMaskLevel] = useState<ActivityCoverMaskLevel>('STANDARD');
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('dark');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removeMode, setRemoveMode] = useState(false);
  const [removeReason, setRemoveReason] = useState('');
  const [initialSignature, setInitialSignature] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void fetchActivityCoverAdmin(activityType, activityId)
      .then(async (nextCover) => {
        if (cancelled) return;
        let nextSource: SourceDraft | null = null;
        if (nextCover.source) {
          objectUrl = await downloadActivityCoverSource(nextCover.source.url);
          if (cancelled) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          nextSource = {
            url: objectUrl,
            width: nextCover.source.width,
            height: nextCover.source.height,
            file: null,
          };
        }
        const nextWide = layoutDraftFromCover(nextCover, nextSource, 'WIDE');
        const nextCompact = layoutDraftFromCover(nextCover, nextSource, 'COMPACT');
        setCover(nextCover);
        setSource(nextSource);
        setWide(nextWide);
        setCompact(nextCompact);
        setMaskLevel(nextCover.maskLevel);
        setInitialSignature(
          draftSignature(nextCover, nextSource, nextWide, nextCompact, nextCover.maskLevel)
        );
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(readError(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activityId, activityType]);

  useEffect(() => {
    const objectUrl = source?.url;
    return () => {
      if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl);
    };
  }, [source?.url]);

  const signature = useMemo(
    () => draftSignature(cover, source, wide, compact, maskLevel),
    [compact, cover, maskLevel, source, wide]
  );
  const dirty = !!cover && !!initialSignature && signature !== initialSignature;
  const close = () => {
    if (dirty && !window.confirm('放弃尚未保存的封面修改？')) return;
    onClose();
  };

  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setError('图片不能超过 8 MB，请压缩后重新选择');
      return;
    }
    try {
      const dimensions = await readImageDimensions(file);
      const url = URL.createObjectURL(file);
      setSource({ url, ...dimensions, file });
      setWide(defaultLayoutDraft());
      setCompact(defaultLayoutDraft());
      setError(null);
    } catch {
      setError('图片无法读取，请选择 JPG、PNG 或静态 WebP 文件');
    }
  };

  const save = async () => {
    if (!cover || !source) return;
    setBusy(true);
    setError(null);
    try {
      const result = await saveActivityCover(activityType, activityId, {
        expectedRevision: cover.revision,
        idempotencyKey: newIdempotencyKey(),
        source: source.file ? 'UPLOAD' : 'CURRENT',
        maskLevel,
        wide: {
          crop: computeActivityCoverCrop(
            source.width,
            source.height,
            'WIDE',
            wide.focus,
            wide.zoom
          ),
          focus: wide.focus,
        },
        compact: {
          crop: computeActivityCoverCrop(
            source.width,
            source.height,
            'COMPACT',
            compact.focus,
            compact.zoom
          ),
          focus: compact.focus,
        },
        file: source.file ?? undefined,
      });
      setCover(result.cover);
      setSource((current) => (current ? { ...current, file: null } : current));
      setInitialSignature(
        draftSignature(
          result.cover,
          source ? { ...source, file: null } : null,
          wide,
          compact,
          maskLevel
        )
      );
      await onPublished?.();
    } catch (saveError) {
      setError(readError(saveError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!cover || !removeReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await removeActivityCover(activityType, activityId, {
        expectedRevision: cover.revision,
        idempotencyKey: newIdempotencyKey(),
        reason: removeReason.trim(),
      });
      setCover(result.cover);
      setSource(null);
      setWide(defaultLayoutDraft());
      setCompact(defaultLayoutDraft());
      setMaskLevel(result.cover.maskLevel);
      setRemoveMode(false);
      setRemoveReason('');
      setInitialSignature(
        draftSignature(
          result.cover,
          null,
          defaultLayoutDraft(),
          defaultLayoutDraft(),
          result.cover.maskLevel
        )
      );
      await onPublished?.();
    } catch (removeError) {
      setError(readError(removeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="activity-cover-editor product-workbench"
      aria-labelledby="activity-cover-editor-title"
    >
      <header className="activity-cover-editor__header">
        <div>
          <p className="text-xs font-semibold text-[var(--accent-primary)]">活动封面</p>
          <h2
            id="activity-cover-editor-title"
            className="mt-1 text-lg font-semibold text-[var(--text-primary)]"
          >
            {activityName}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            宽屏与手机共用一张母图；标题、开放状态和操作仍由页面文字呈现。
          </p>
        </div>
        <button type="button" className="button-icon" onClick={close} aria-label="关闭封面编辑器">
          <X size={17} />
        </button>
      </header>

      {loading ? (
        <div className="grid min-h-48 place-items-center text-sm text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            正在读取当前封面
          </span>
        </div>
      ) : (
        <div className="activity-cover-editor__body">
          <div className="activity-cover-editor__toolbar">
            <label className="button-secondary inline-flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
              <ImagePlus size={16} />
              {source ? '替换图片' : '上传封面'}
              <input
                className="sr-only"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => void chooseFile(event.target.files?.[0])}
              />
            </label>
            <div className="activity-cover-editor__theme-toggle" role="group" aria-label="预览主题">
              <button
                type="button"
                aria-pressed={previewTheme === 'light'}
                onClick={() => setPreviewTheme('light')}
              >
                <Sun size={14} /> 日间
              </button>
              <button
                type="button"
                aria-pressed={previewTheme === 'dark'}
                onClick={() => setPreviewTheme('dark')}
              >
                <Moon size={14} /> 夜间
              </button>
            </div>
            {cover?.mode === 'CUSTOM' ? (
              <span className="ml-auto text-xs text-[var(--text-muted)]">
                已发布 revision {cover.revision}
              </span>
            ) : null}
          </div>

          {source ? (
            <div className="activity-cover-editor__previews">
              <LayoutEditor
                layout="WIDE"
                label="宽屏 · 16:7"
                source={source}
                draft={wide}
                maskLevel={maskLevel}
                previewTheme={previewTheme}
                onChange={setWide}
              />
              <LayoutEditor
                layout="COMPACT"
                label="紧凑 · 4:3"
                source={source}
                draft={compact}
                maskLevel={maskLevel}
                previewTheme={previewTheme}
                onChange={setCompact}
              />
            </div>
          ) : (
            <div className="activity-cover-editor__empty">
              <ImagePlus size={26} />
              <strong>使用当前活动默认 Hero</strong>
              <span>上传一张至少能满足 1280 × 560 与 960 × 720 裁切的横图。</span>
            </div>
          )}

          <fieldset className="activity-cover-editor__mask-options">
            <legend>文字遮罩</legend>
            {(['STANDARD', 'STRONG'] as const).map((level) => (
              <label key={level}>
                <input
                  type="radio"
                  name={`cover-mask-${activityId}`}
                  checked={maskLevel === level}
                  onChange={() => setMaskLevel(level)}
                />
                <span>{level === 'STANDARD' ? '标准' : '加强'}</span>
              </label>
            ))}
          </fieldset>

          {error ? (
            <p className="activity-cover-editor__error" role="alert">
              {error}
            </p>
          ) : null}

          {removeMode ? (
            <div className="activity-cover-editor__remove">
              <label>
                移除原因
                <textarea
                  className="input-field mt-1 min-h-20 resize-y"
                  value={removeReason}
                  maxLength={500}
                  onChange={(event) => setRemoveReason(event.target.value)}
                  placeholder="说明版权、素材调整或运营下架原因"
                />
              </label>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="button-secondary px-3 py-2 text-sm"
                  onClick={() => setRemoveMode(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="activity-cover-editor__danger"
                  disabled={busy || !removeReason.trim()}
                  onClick={() => void remove()}
                >
                  确认移除
                </button>
              </div>
            </div>
          ) : null}

          <footer className="activity-cover-editor__footer">
            {cover?.mode === 'CUSTOM' && !removeMode ? (
              <button
                type="button"
                className="activity-cover-editor__danger"
                disabled={busy}
                onClick={() => setRemoveMode(true)}
              >
                <Trash2 size={15} /> 移除封面
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="button-primary inline-flex min-h-10 items-center gap-2 px-4 text-sm"
              disabled={busy || !source || !dirty || removeMode}
              onClick={() => void save()}
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              保存并发布
            </button>
          </footer>
        </div>
      )}
    </section>
  );
}

function LayoutEditor({
  layout,
  label,
  source,
  draft,
  maskLevel,
  previewTheme,
  onChange,
}: {
  readonly layout: ActivityCoverLayout;
  readonly label: string;
  readonly source: SourceDraft;
  readonly draft: LayoutDraft;
  readonly maskLevel: ActivityCoverMaskLevel;
  readonly previewTheme: 'light' | 'dark';
  readonly onChange: (draft: LayoutDraft) => void;
}) {
  const crop = computeActivityCoverCrop(
    source.width,
    source.height,
    layout,
    draft.focus,
    draft.zoom
  );
  const focusLeft = ((draft.focus.x - crop.x) / crop.width) * 100;
  const focusTop = ((draft.focus.y - crop.y) / crop.height) * 100;
  return (
    <fieldset className="activity-cover-layout-editor">
      <legend>{label}</legend>
      <div
        className={cn(
          'activity-cover-crop-preview',
          layout === 'WIDE' ? 'is-wide aspect-[16/7]' : 'is-compact aspect-[4/3]',
          previewTheme === 'light' && 'is-light',
          maskLevel === 'STRONG' && 'is-strong'
        )}
      >
        <img
          src={source.url}
          alt=""
          style={
            {
              width: `${100 / crop.width}%`,
              height: `${100 / crop.height}%`,
              left: `${(-crop.x / crop.width) * 100}%`,
              top: `${(-crop.y / crop.height) * 100}%`,
            } as CSSProperties
          }
        />
        <div className="activity-cover-crop-preview__mask" />
        <div className="activity-cover-crop-preview__copy">
          <span>活动状态</span>
          <strong>活动名称预览</strong>
          <small>真实页面文字不会写入图片</small>
        </div>
        <span
          className="activity-cover-crop-preview__focus"
          style={{ left: `${focusLeft}%`, top: `${focusTop}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="activity-cover-layout-editor__controls">
        <RangeField
          label="主体左右"
          value={draft.focus.x}
          onChange={(x) => onChange({ ...draft, focus: { ...draft.focus, x } })}
        />
        <RangeField
          label="主体上下"
          value={draft.focus.y}
          onChange={(y) => onChange({ ...draft, focus: { ...draft.focus, y } })}
        />
        <RangeField
          label="裁切缩放"
          value={draft.zoom}
          min={1}
          max={2}
          step={0.01}
          onChange={(zoom) => onChange({ ...draft, zoom })}
        />
      </div>
    </fieldset>
  );
}

function RangeField({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{Math.round(((value - min) / (max - min)) * 100)}%</output>
    </label>
  );
}

function layoutDraftFromCover(
  cover: ActivityCoverAdminView,
  source: SourceDraft | null,
  layout: ActivityCoverLayout
): LayoutDraft {
  const crop = layout === 'WIDE' ? cover.wideCrop : cover.compactCrop;
  const focus = layout === 'WIDE' ? cover.wideSourceFocus : cover.compactSourceFocus;
  if (!source || !crop || !focus) return defaultLayoutDraft();
  return {
    focus,
    zoom: inferActivityCoverZoom(source.width, source.height, layout, crop),
  };
}

function defaultLayoutDraft(): LayoutDraft {
  return { focus: { x: 0.5, y: 0.5 }, zoom: 1 };
}

function draftSignature(
  cover: ActivityCoverAdminView | null,
  source: SourceDraft | null,
  wide: LayoutDraft,
  compact: LayoutDraft,
  maskLevel: ActivityCoverMaskLevel
): string {
  return JSON.stringify({
    revision: cover?.revision ?? 0,
    source: source?.file
      ? `${source.file.name}:${source.file.size}:${source.file.lastModified}`
      : source
        ? 'CURRENT'
        : null,
    wide,
    compact,
    maskLevel,
  });
}

async function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    if (!result.width || !result.height) throw new Error('invalid image');
    return result;
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error('invalid image'));
        return;
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('invalid image'));
    };
    image.src = url;
  });
}

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `activity-cover-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : '活动封面操作失败';
}
