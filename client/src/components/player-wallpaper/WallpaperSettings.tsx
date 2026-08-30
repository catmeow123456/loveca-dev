import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  Moon,
  Monitor,
  Palette,
  RefreshCcw,
  Save,
  Smartphone,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import {
  ActionButton,
  ConfirmDialog,
  Panel,
  SectionHeading,
  StatusBadge,
} from '@/components/common';
import { computeWallpaperCrop, getWallpaperResolutionError } from '@/lib/playerWallpaperCrop';
import {
  getPlayerWallpaperErrorMessage,
  publishPlayerWallpaper,
  resetPlayerWallpaper,
  type WallpaperLayoutSubmission,
} from '@/lib/playerWallpaperClient';
import { usePlayerWallpaperStore } from '@/store/playerWallpaperStore';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { WallpaperTablePreview } from './WallpaperTablePreview';
import {
  getPlayerWallpaperSolidColor,
  PLAYER_WALLPAPER_SOLID_PRESETS,
} from '@game/online/player-wallpaper-types';
import type {
  CompactWallpaperMode,
  PlayerWallpaperSolidPreset,
  PlayerWallpaperAssetView,
  WallpaperFocus,
  WallpaperLayout,
  WideWallpaperMode,
} from '@game/online/player-wallpaper-types';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const CENTER_FOCUS: WallpaperFocus = { x: 0.5, y: 0.5 };

interface SlotDraft {
  readonly source: 'UPLOAD' | 'CURRENT';
  readonly currentAsset: PlayerWallpaperAssetView | null;
  readonly file: File | null;
  readonly localUrl: string | null;
  readonly width: number;
  readonly height: number;
  readonly focus: WallpaperFocus;
}

type PendingConfirmation = 'SAVE' | 'RESET' | null;

export function WallpaperSettings() {
  const wallpaper = usePlayerWallpaperStore((state) => state.wallpaper);
  const includesSources = usePlayerWallpaperStore((state) => state.includesSources);
  const isLoading = usePlayerWallpaperStore((state) => state.isLoading);
  const storeError = usePlayerWallpaperStore((state) => state.error);
  const objectUrls = usePlayerWallpaperStore((state) => state.objectUrls);
  const load = usePlayerWallpaperStore((state) => state.load);
  const ensureAsset = usePlayerWallpaperStore((state) => state.ensureAsset);
  const applyWallpaper = usePlayerWallpaperStore((state) => state.applyWallpaper);
  const [wideMode, setWideMode] = useState<WideWallpaperMode>('DEFAULT');
  const [compactMode, setCompactMode] = useState<CompactWallpaperMode>('INHERIT_PC');
  const [wideSolidPreset, setWideSolidPreset] = useState<PlayerWallpaperSolidPreset | null>(null);
  const [compactSolidPreset, setCompactSolidPreset] = useState<PlayerWallpaperSolidPreset | null>(
    null
  );
  const [wideDraft, setWideDraft] = useState<SlotDraft | null>(null);
  const [compactDraft, setCompactDraft] = useState<SlotDraft | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [mobilePreviewLayout, setMobilePreviewLayout] = useState<WallpaperLayout>('WIDE');
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  );
  const isNarrow = useMediaQuery('(max-width: 639px)');
  const initializedVersionRef = useRef<number | null>(null);
  const localObjectUrlsRef = useRef(new Set<string>());

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    if (!wallpaper || !includesSources || initializedVersionRef.current === wallpaper.version)
      return;
    initializedVersionRef.current = wallpaper.version;
    setWideMode(wallpaper.wideMode);
    setCompactMode(wallpaper.compactMode);
    setWideSolidPreset(wallpaper.wideSolidPreset);
    setCompactSolidPreset(wallpaper.compactSolidPreset);
    setWideDraft(draftFromAsset(wallpaper.wideSource));
    setCompactDraft(
      wallpaper.compactMode === 'INHERIT_PC'
        ? draftFromAsset(wallpaper.wideSource, wallpaper.compact?.focus)
        : draftFromAsset(wallpaper.compactSource)
    );
    setFeedback(null);
  }, [includesSources, wallpaper]);

  useEffect(() => {
    void ensureAsset(wallpaper?.wideSource ?? null);
    void ensureAsset(wallpaper?.compactSource ?? null);
  }, [ensureAsset, wallpaper?.compactSource, wallpaper?.wideSource]);

  useEffect(
    () => () => {
      for (const url of localObjectUrlsRef.current) URL.revokeObjectURL(url);
      localObjectUrlsRef.current.clear();
    },
    []
  );

  const widePreviewUrl = wideMode === 'CUSTOM' ? resolveDraftUrl(wideDraft, objectUrls) : null;
  const compactPreviewUrl =
    compactMode === 'INHERIT_PC'
      ? widePreviewUrl
      : compactMode === 'CUSTOM'
        ? resolveDraftUrl(compactDraft, objectUrls)
        : null;
  const widePreviewColor =
    wideMode === 'SOLID' ? getPlayerWallpaperSolidColor(wideSolidPreset) : null;
  const compactPreviewColor =
    compactMode === 'INHERIT_PC'
      ? widePreviewColor
      : compactMode === 'SOLID'
        ? getPlayerWallpaperSolidColor(compactSolidPreset)
        : null;
  const compactPreviewFocus = compactDraft?.focus ?? CENTER_FOCUS;
  const currentSignature = useMemo(() => wallpaperSignature(wallpaper), [wallpaper]);
  const draftSignature = useMemo(
    () =>
      JSON.stringify({
        wideMode,
        compactMode,
        wideSolidPreset,
        compactSolidPreset,
        wide: draftIdentity(wideDraft),
        compact:
          compactMode === 'INHERIT_PC' && wideMode !== 'CUSTOM'
            ? null
            : draftIdentity(compactDraft),
      }),
    [compactDraft, compactMode, compactSolidPreset, wideDraft, wideMode, wideSolidPreset]
  );
  const hasChanges = !!wallpaper && currentSignature !== draftSignature;
  const hasNonDefaultWallpaper =
    !!wallpaper && (wallpaper.wideMode !== 'DEFAULT' || wallpaper.compactMode !== 'INHERIT_PC');
  const canSave =
    !!wallpaper &&
    wallpaper.canPublishToday &&
    hasChanges &&
    !isSaving &&
    (wideMode === 'DEFAULT' || (wideMode === 'SOLID' ? !!wideSolidPreset : !!wideDraft)) &&
    (compactMode === 'INHERIT_PC'
      ? wideMode !== 'CUSTOM' || !!compactDraft
      : compactMode === 'SOLID'
        ? !!compactSolidPreset
        : !!compactDraft);

  const chooseFile = async (slot: 'WIDE' | 'COMPACT', file: File) => {
    setFeedback(null);
    const validationError = validateLocalFile(file);
    if (validationError) {
      setFeedback({ tone: 'error', message: validationError });
      return;
    }

    const localUrl = URL.createObjectURL(file);
    localObjectUrlsRef.current.add(localUrl);
    try {
      const dimensions = await readImageDimensions(localUrl);
      const resolutionError = getWallpaperResolutionError(
        dimensions.width,
        dimensions.height,
        slot
      );
      if (resolutionError) throw new Error(resolutionError);
      const next: SlotDraft = {
        source: 'UPLOAD',
        currentAsset: null,
        file,
        localUrl,
        width: dimensions.width,
        height: dimensions.height,
        focus: CENTER_FOCUS,
      };
      if (slot === 'WIDE') {
        releaseDraftUrl(wideDraft, localObjectUrlsRef.current);
        setWideMode('CUSTOM');
        setWideSolidPreset(null);
        setWideDraft(next);
        if (compactMode === 'INHERIT_PC') {
          setCompactDraft({ ...next, file: null, localUrl: null, focus: CENTER_FOCUS });
        }
      } else {
        releaseDraftUrl(compactDraft, localObjectUrlsRef.current);
        setCompactMode('CUSTOM');
        setCompactSolidPreset(null);
        setCompactDraft(next);
      }
    } catch (error) {
      URL.revokeObjectURL(localUrl);
      localObjectUrlsRef.current.delete(localUrl);
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '图片处理失败，请重新选择。',
      });
    }
  };

  const useWideForCompact = () => {
    setFeedback(null);
    setCompactMode('INHERIT_PC');
    setCompactSolidPreset(null);
    releaseDraftUrl(compactDraft, localObjectUrlsRef.current);
    setCompactDraft(
      wideMode === 'CUSTOM' && wideDraft
        ? {
            ...wideDraft,
            file: null,
            localUrl: null,
            focus: CENTER_FOCUS,
          }
        : null
    );
  };

  const removeWide = () => {
    releaseDraftUrl(wideDraft, localObjectUrlsRef.current);
    setWideMode('DEFAULT');
    setWideSolidPreset(null);
    setWideDraft(null);
    if (compactMode === 'INHERIT_PC') setCompactDraft(null);
    setFeedback(null);
  };

  const chooseSolid = (slot: 'WIDE' | 'COMPACT', preset: PlayerWallpaperSolidPreset) => {
    setFeedback(null);
    if (slot === 'WIDE') {
      releaseDraftUrl(wideDraft, localObjectUrlsRef.current);
      setWideDraft(null);
      setWideMode('SOLID');
      setWideSolidPreset(preset);
      if (compactMode === 'INHERIT_PC') setCompactDraft(null);
      return;
    }
    releaseDraftUrl(compactDraft, localObjectUrlsRef.current);
    setCompactDraft(null);
    setCompactMode('SOLID');
    setCompactSolidPreset(preset);
  };

  const restoreSavedDraft = () => {
    if (!wallpaper) return;
    releaseDraftUrl(wideDraft, localObjectUrlsRef.current);
    releaseDraftUrl(compactDraft, localObjectUrlsRef.current);
    setWideMode(wallpaper.wideMode);
    setCompactMode(wallpaper.compactMode);
    setWideSolidPreset(wallpaper.wideSolidPreset);
    setCompactSolidPreset(wallpaper.compactSolidPreset);
    setWideDraft(draftFromAsset(wallpaper.wideSource));
    setCompactDraft(
      wallpaper.compactMode === 'INHERIT_PC'
        ? draftFromAsset(wallpaper.wideSource, wallpaper.compact?.focus)
        : draftFromAsset(wallpaper.compactSource)
    );
    setFeedback(null);
  };

  const updateFocus = (slot: 'WIDE' | 'COMPACT', axis: keyof WallpaperFocus, value: number) => {
    const update = (draft: SlotDraft | null) =>
      draft ? { ...draft, focus: { ...draft.focus, [axis]: value } } : null;
    if (slot === 'WIDE') setWideDraft(update);
    else setCompactDraft(update);
    setFeedback(null);
  };

  const save = async () => {
    if (!wallpaper) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const wide = wideMode === 'CUSTOM' ? buildSubmission(wideDraft, 'WIDE') : null;
      const compact =
        compactMode === 'CUSTOM' || (compactMode === 'INHERIT_PC' && wideMode === 'CUSTOM')
          ? buildSubmission(compactDraft, 'COMPACT', compactMode === 'INHERIT_PC')
          : null;
      const result = await publishPlayerWallpaper({
        expectedVersion: wallpaper.version,
        idempotencyKey: newIdempotencyKey(),
        wideMode,
        compactMode,
        wideSolidPreset: wideMode === 'SOLID' ? wideSolidPreset : null,
        compactSolidPreset: compactMode === 'SOLID' ? compactSolidPreset : null,
        wide,
        compact,
        wideFile: wideDraft?.source === 'UPLOAD' ? (wideDraft.file ?? undefined) : undefined,
        compactFile:
          compactMode === 'CUSTOM' && compactDraft?.source === 'UPLOAD'
            ? (compactDraft.file ?? undefined)
            : undefined,
      });
      releaseDraftUrl(wideDraft, localObjectUrlsRef.current);
      releaseDraftUrl(compactDraft, localObjectUrlsRef.current);
      initializedVersionRef.current = null;
      applyWallpaper(result.wallpaper);
      setFeedback({ tone: 'success', message: result.changed ? '壁纸已保存。' : '壁纸没有变化。' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: getPlayerWallpaperErrorMessage(error, '保存壁纸失败。'),
      });
    } finally {
      setIsSaving(false);
      setPendingConfirmation(null);
    }
  };

  const reset = async () => {
    if (!wallpaper) return;
    setIsSaving(true);
    setFeedback(null);
    try {
      const result = await resetPlayerWallpaper(wallpaper.version, newIdempotencyKey());
      initializedVersionRef.current = null;
      applyWallpaper(result.wallpaper);
      setFeedback({ tone: 'success', message: '已恢复系统默认壁纸。' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '恢复默认壁纸失败。',
      });
    } finally {
      setIsSaving(false);
      setPendingConfirmation(null);
    }
  };

  return (
    <Panel as="section" padding="none">
      <div className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
        <ImageIcon size={18} className="mt-0.5 shrink-0 text-[var(--accent-primary)]" />
        <SectionHeading
          className="min-w-0 flex-1"
          title="游戏桌外观"
          description="设置只在自己看到的游戏桌上显示。"
          action={
            wallpaper ? (
              <div className="flex flex-wrap justify-end gap-1.5">
                {hasChanges ? <StatusBadge tone="accent">有未保存修改</StatusBadge> : null}
                <StatusBadge tone={wallpaper.canPublishToday ? 'success' : 'warning'}>
                  {wallpaper.canPublishToday ? '今天可保存 1 次' : '今天已保存'}
                </StatusBadge>
              </div>
            ) : null
          }
        />
      </div>

      <div className="grid gap-5 px-4 py-4 sm:px-5">
        {isLoading && !wallpaper ? (
          <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-[var(--text-secondary)]">
            <Loader2 size={16} className="animate-spin" /> 读取壁纸设置
          </div>
        ) : null}

        {!isLoading && !wallpaper ? (
          <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-4 text-center">
            <p className="text-sm text-[var(--semantic-error)]">
              {storeError ?? '壁纸设置暂时无法读取。'}
            </p>
            <ActionButton variant="secondary" size="compact" onClick={() => void load(true, true)}>
              <RefreshCcw size={14} /> 重新读取
            </ActionButton>
          </div>
        ) : null}

        {wallpaper ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-1.5 pl-3">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">
                牌桌预览模式
              </span>
              <div
                role="group"
                aria-label="壁纸预览模式"
                className="grid grid-cols-2 rounded-md bg-[var(--bg-surface)] p-0.5 shadow-[var(--shadow-sm)]"
              >
                {(['light', 'dark'] as const).map((theme) => (
                  <button
                    key={theme}
                    type="button"
                    aria-pressed={previewTheme === theme}
                    onClick={() => setPreviewTheme(theme)}
                    className={cn(
                      'flex min-h-8 items-center justify-center gap-1.5 rounded px-3 text-xs font-semibold transition-colors',
                      previewTheme === theme
                        ? 'bg-[var(--accent-primary)] text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    )}
                  >
                    {theme === 'light' ? <Sun size={13} /> : <Moon size={13} />}
                    {theme === 'light' ? '日间' : '夜间'}
                  </button>
                ))}
              </div>
            </div>
            {isNarrow ? (
              <div className="grid gap-3">
                <div className="grid grid-cols-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-1">
                  {(['WIDE', 'COMPACT'] as const).map((layout) => (
                    <button
                      key={layout}
                      type="button"
                      aria-pressed={mobilePreviewLayout === layout}
                      onClick={() => setMobilePreviewLayout(layout)}
                      className={cn(
                        'min-h-9 rounded-md px-3 text-xs font-semibold transition-colors',
                        mobilePreviewLayout === layout
                          ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                          : 'text-[var(--text-secondary)]'
                      )}
                    >
                      {layout === 'WIDE' ? 'PC' : '手机'}
                    </button>
                  ))}
                </div>
                {mobilePreviewLayout === 'WIDE' ? (
                  <WallpaperTablePreview
                    layout="WIDE"
                    sourceUrl={widePreviewUrl}
                    solidColor={widePreviewColor}
                    focus={wideDraft?.focus ?? CENTER_FOCUS}
                    theme={previewTheme}
                    label="PC / 宽屏牌桌"
                  />
                ) : (
                  <WallpaperTablePreview
                    layout="COMPACT"
                    sourceUrl={compactPreviewUrl}
                    solidColor={compactPreviewColor}
                    focus={compactPreviewFocus}
                    theme={previewTheme}
                    label="手机 / 紧凑牌桌"
                  />
                )}
              </div>
            ) : (
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(150px,0.7fr)]">
                <WallpaperTablePreview
                  layout="WIDE"
                  sourceUrl={widePreviewUrl}
                  solidColor={widePreviewColor}
                  focus={wideDraft?.focus ?? CENTER_FOCUS}
                  theme={previewTheme}
                  label="PC / 宽屏牌桌"
                />
                <WallpaperTablePreview
                  layout="COMPACT"
                  sourceUrl={compactPreviewUrl}
                  solidColor={compactPreviewColor}
                  focus={compactPreviewFocus}
                  theme={previewTheme}
                  label="手机 / 紧凑牌桌"
                />
              </div>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
              <WallpaperSlotEditor
                icon={<Monitor size={16} />}
                title="PC / 宽屏壁纸"
                stateLabel={wallpaperStateLabel(wideMode, wideSolidPreset)}
                mode={wideMode}
                solidPreset={wideSolidPreset}
                draft={wideDraft}
                onChooseFile={(file) => void chooseFile('WIDE', file)}
                onChooseSolid={(preset) => chooseSolid('WIDE', preset)}
                onRemove={wideMode !== 'DEFAULT' ? removeWide : undefined}
                onFocus={(axis, value) => updateFocus('WIDE', axis, value)}
              />
              <WallpaperSlotEditor
                icon={<Smartphone size={16} />}
                title="手机 / 紧凑壁纸"
                stateLabel={compactWallpaperStateLabel(compactMode, compactSolidPreset)}
                mode={compactMode}
                solidPreset={compactSolidPreset}
                draft={compactDraft}
                onChooseFile={(file) => void chooseFile('COMPACT', file)}
                onChooseSolid={(preset) => chooseSolid('COMPACT', preset)}
                secondaryAction={
                  compactMode !== 'INHERIT_PC' ? (
                    <ActionButton variant="ghost" size="compact" onClick={useWideForCompact}>
                      <RefreshCcw size={14} /> 跟随 PC 壁纸
                    </ActionButton>
                  ) : null
                }
                onFocus={(axis, value) => updateFocus('COMPACT', axis, value)}
              />
            </div>

            <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2.5 text-xs leading-5 text-[var(--text-secondary)]">
              可直接选择纯色；上传图片支持 JPG、PNG 或静态 WebP，每张不超过 8
              MB。只能上传自己有权使用的图片；不要上传隐私照片或敏感信息。
              {!wallpaper.canPublishToday && wallpaper.nextChangeAt ? (
                <span className="ml-1 font-semibold text-[var(--semantic-warning)]">
                  下次可更换：{formatShanghaiTime(wallpaper.nextChangeAt)}。
                </span>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-h-5 flex-1" aria-live="polite">
                {feedback || storeError ? (
                  <p
                    className={cn(
                      'flex items-start gap-1.5 text-xs leading-5',
                      feedback?.tone === 'success'
                        ? 'text-[var(--semantic-success)]'
                        : 'text-[var(--semantic-error)]'
                    )}
                  >
                    {feedback?.tone === 'success' ? (
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                    ) : (
                      <X size={14} className="mt-0.5 shrink-0" />
                    )}
                    {feedback?.message ?? storeError}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {hasChanges ? (
                  <ActionButton variant="ghost" disabled={isSaving} onClick={restoreSavedDraft}>
                    撤销草稿
                  </ActionButton>
                ) : null}
                {hasNonDefaultWallpaper ? (
                  <ActionButton
                    variant="ghost"
                    disabled={isSaving}
                    onClick={() => setPendingConfirmation('RESET')}
                  >
                    <RefreshCcw size={15} /> 恢复默认壁纸
                  </ActionButton>
                ) : null}
                <ActionButton disabled={!canSave} onClick={() => setPendingConfirmation('SAVE')}>
                  {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {isSaving ? '正在保存' : '保存壁纸'}
                </ActionButton>
              </div>
            </div>
          </>
        ) : null}
      </div>

      <ConfirmDialog
        isOpen={pendingConfirmation === 'SAVE'}
        title="保存这套壁纸？"
        message="保存后，今天不能再次更换壁纸或调整位置；明天 00:00 后可再次更换。"
        confirmLabel="保存壁纸"
        tone="primary"
        isConfirming={isSaving}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => void save()}
      />
      <ConfirmDialog
        isOpen={pendingConfirmation === 'RESET'}
        title="恢复默认壁纸？"
        message={
          wallpaper?.canPublishToday
            ? '当前纯色或自定义图片会从游戏桌移除。'
            : '当前纯色或自定义图片会从游戏桌移除，今天已使用的保存次数不会恢复。'
        }
        confirmLabel="恢复默认壁纸"
        isConfirming={isSaving}
        onCancel={() => setPendingConfirmation(null)}
        onConfirm={() => void reset()}
      />
    </Panel>
  );
}

function WallpaperSlotEditor({
  icon,
  title,
  stateLabel,
  mode,
  solidPreset,
  draft,
  onChooseFile,
  onChooseSolid,
  onRemove,
  onFocus,
  secondaryAction,
}: {
  icon: ReactNode;
  title: string;
  stateLabel: string;
  mode: WideWallpaperMode | CompactWallpaperMode;
  solidPreset: PlayerWallpaperSolidPreset | null;
  draft: SlotDraft | null;
  onChooseFile: (file: File) => void;
  onChooseSolid: (preset: PlayerWallpaperSolidPreset) => void;
  onRemove?: () => void;
  onFocus: (axis: keyof WallpaperFocus, value: number) => void;
  secondaryAction?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[var(--accent-primary)]">{icon}</span>
        <h3 className="mr-auto text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <StatusBadge tone={mode === 'DEFAULT' || mode === 'INHERIT_PC' ? 'neutral' : 'accent'}>
          {stateLabel}
        </StatusBadge>
      </div>
      <div
        className="mt-3 flex min-h-14 flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--border-default)] bg-[var(--bg-overlay)] p-2"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) onChooseFile(file);
        }}
      >
        <label className="ui-action-button ui-action-button--compact button-secondary inline-flex cursor-pointer items-center gap-1.5">
          <Upload size={14} /> 选择图片
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onChooseFile(file);
            }}
          />
        </label>
        <span className="text-[11px] text-[var(--text-muted)]">或拖放到这里</span>
        {secondaryAction}
        {onRemove ? (
          <ActionButton variant="ghost" size="compact" onClick={onRemove}>
            <X size={14} /> 移除
          </ActionButton>
        ) : null}
      </div>
      <fieldset className="mt-3">
        <legend className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
          <Palette size={13} /> 纯色壁纸
        </legend>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3 xl:grid-cols-6">
          {PLAYER_WALLPAPER_SOLID_PRESETS.map((preset) => {
            const selected = mode === 'SOLID' && solidPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={`使用${preset.label}纯色`}
                aria-pressed={selected}
                onClick={() => onChooseSolid(preset.id)}
                className={cn(
                  'group grid min-h-14 place-items-center gap-1 rounded-lg border p-1.5 transition',
                  selected
                    ? 'border-[var(--accent-primary)] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] shadow-[0_0_0_1px_var(--accent-primary)]'
                    : 'border-[var(--border-subtle)] hover:border-[var(--border-default)]'
                )}
              >
                <span
                  className="h-6 w-full rounded border border-white/15 shadow-inner"
                  style={{ backgroundColor: preset.color }}
                />
                <span className="text-[10px] leading-none text-[var(--text-secondary)]">
                  {preset.label}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
      {mode === 'CUSTOM' && draft ? (
        <div className="mt-4 grid gap-3">
          <FocusSlider
            label="左右位置"
            value={draft.focus.x}
            onChange={(value) => onFocus('x', value)}
          />
          <FocusSlider
            label="上下位置"
            value={draft.focus.y}
            onChange={(value) => onFocus('y', value)}
          />
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--text-muted)]">
          {mode === 'SOLID'
            ? '纯色会使用与自定义图片相同的日间／夜间遮罩。'
            : mode === 'INHERIT_PC'
              ? '当前跟随 PC 壁纸设置。'
              : '当前使用系统默认背景。'}
        </p>
      )}
    </div>
  );
}

function FocusSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[72px_minmax(0,1fr)_34px] items-center gap-2 text-xs text-[var(--text-secondary)]">
      <span>{label}</span>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        className="accent-[var(--accent-primary)]"
      />
      <span className="text-right font-mono text-[10px] text-[var(--text-muted)]">
        {Math.round(value * 100)}
      </span>
    </label>
  );
}

function draftFromAsset(
  asset: PlayerWallpaperAssetView | null,
  focusOverride?: WallpaperFocus
): SlotDraft | null {
  if (!asset) return null;
  return {
    source: 'CURRENT',
    currentAsset: asset,
    file: null,
    localUrl: null,
    width: asset.width,
    height: asset.height,
    focus: focusOverride ?? asset.focus,
  };
}

function resolveDraftUrl(
  draft: SlotDraft | null,
  objectUrls: Readonly<Record<string, string>>
): string | null {
  return (
    draft?.localUrl ?? (draft?.currentAsset ? (objectUrls[draft.currentAsset.id] ?? null) : null)
  );
}

function releaseDraftUrl(draft: SlotDraft | null, tracked: Set<string>): void {
  if (!draft?.localUrl) return;
  URL.revokeObjectURL(draft.localUrl);
  tracked.delete(draft.localUrl);
}

function buildSubmission(
  draft: SlotDraft | null,
  layout: WallpaperLayout,
  inheritedWideSource = false
): WallpaperLayoutSubmission {
  if (!draft) throw new Error('请选择要使用的壁纸图片。');
  const crop = computeWallpaperCrop(draft.width, draft.height, layout, draft.focus);
  const resolutionError = getWallpaperResolutionError(
    draft.width,
    draft.height,
    layout,
    inheritedWideSource
  );
  if (resolutionError) throw new Error(resolutionError);
  return {
    ...(layout === 'WIDE' || !inheritedWideSource ? { source: draft.source } : {}),
    crop,
    focus: draft.focus,
  };
}

function wallpaperSignature(
  wallpaper: ReturnType<typeof usePlayerWallpaperStore.getState>['wallpaper']
): string {
  if (!wallpaper) return '';
  return JSON.stringify({
    wideMode: wallpaper.wideMode,
    compactMode: wallpaper.compactMode,
    wideSolidPreset: wallpaper.wideSolidPreset,
    compactSolidPreset: wallpaper.compactSolidPreset,
    wide: wallpaper.wideSource
      ? {
          source: `current:${wallpaper.wideSource.id}`,
          focus: wallpaper.wide?.focus ?? wallpaper.wideSource.focus,
        }
      : null,
    compact:
      wallpaper.compactMode === 'INHERIT_PC' && wallpaper.wideMode !== 'CUSTOM'
        ? null
        : wallpaper.compactSource
          ? {
              source: `current:${wallpaper.compactSource.id}`,
              focus: wallpaper.compact?.focus ?? wallpaper.compactSource.focus,
            }
          : null,
  });
}

function wallpaperStateLabel(
  mode: WideWallpaperMode,
  solidPreset: PlayerWallpaperSolidPreset | null
): string {
  if (mode === 'CUSTOM') return '自定义图片';
  if (mode === 'SOLID') return solidPresetLabel(solidPreset);
  return '系统默认';
}

function compactWallpaperStateLabel(
  mode: CompactWallpaperMode,
  solidPreset: PlayerWallpaperSolidPreset | null
): string {
  if (mode === 'CUSTOM') return '独立图片';
  if (mode === 'SOLID') return solidPresetLabel(solidPreset);
  return '跟随 PC';
}

function solidPresetLabel(presetId: PlayerWallpaperSolidPreset | null): string {
  const preset = PLAYER_WALLPAPER_SOLID_PRESETS.find((candidate) => candidate.id === presetId);
  return preset ? `纯色 · ${preset.label}` : '纯色';
}

function draftIdentity(draft: SlotDraft | null): unknown {
  if (!draft) return null;
  return {
    source:
      draft.source === 'UPLOAD' && draft.file
        ? `upload:${draft.file.name}:${draft.file.size}:${draft.file.lastModified}`
        : `current:${draft.currentAsset?.id ?? ''}`,
    focus: draft.focus,
  };
}

function validateLocalFile(file: File): string | null {
  if (!SUPPORTED_TYPES.has(file.type)) return '请选择 JPG、PNG 或静态 WebP 图片。';
  if (file.size > MAX_FILE_BYTES) return '图片不能超过 8 MB，请压缩后重新选择。';
  return null;
}

function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('图片处理失败，请重新导出图片后再试。'));
    image.src = url;
  });
}

function newIdempotencyKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `wallpaper-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatShanghaiTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}
