import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Award, ImagePlus, Loader2, Upload, X } from 'lucide-react';
import type {
  ActivityBadgeActivityType,
  ActivityBadgeAdminView,
} from '@game/online/activity-badge-types';
import { ActionButton, Panel, SectionHeading, StatusBadge } from '@/components/common';
import { fetchActivityBadgeAdmin, saveActivityBadge } from '@/lib/activityBadgeClient';
import './activity-badge-editor.css';

export function ActivityBadgeEditor({
  activityType,
  activityId,
  activityName,
  onClose,
}: {
  readonly activityType: ActivityBadgeActivityType;
  readonly activityId: string;
  readonly activityName: string;
  readonly onClose: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<ActivityBadgeAdminView | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchActivityBadgeAdmin(activityType, activityId)
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : '读取活动徽章失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, activityType]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl]
  );

  const selectImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return;
    setError(null);
    setNotice(null);
    if (file.size > 8 * 1024 * 1024) {
      setError('图片不能超过 8 MB，请压缩后重新选择。');
      return;
    }
    try {
      await decodeImage(file);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));
      setSelectedFile(file);
    } catch {
      setError('图片无法读取，请选择 JPG、PNG 或静态 WebP 图片。');
    }
  };

  const save = async () => {
    if (!selectedFile || !view) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveActivityBadge(activityType, activityId, {
        expectedRevision: view.badge?.revision ?? 0,
        idempotencyKey: createIdempotencyKey(),
        file: selectedFile,
      });
      setView(result.badge);
      setSelectedFile(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      setNotice(
        result.awardedPlayerCount > 0
          ? `徽章已保存，并为 ${result.awardedPlayerCount} 名已达标玩家补发。`
          : result.changed
            ? '徽章已保存。'
            : '图片内容未改变。'
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '保存活动徽章失败');
    } finally {
      setSaving(false);
    }
  };

  const imageUrl = previewUrl ?? view?.badge?.imageUrl ?? null;
  const minimumMatchCount = view?.badge?.minimumCompletedMatchCount ?? 3;

  return (
    <Panel as="section" padding="none" className="activity-badge-editor">
      <header className="activity-badge-editor__header">
        <Award size={19} aria-hidden="true" />
        <SectionHeading
          className="min-w-0 flex-1"
          title={`活动徽章 · ${activityName}`}
          description="上传后启用本期纪念徽章；替换图片会同步更新所有已获得玩家的展示。"
          action={
            view?.badge ? (
              <StatusBadge tone="success">已启用</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">未设置</StatusBadge>
            )
          }
        />
        <button className="button-icon" type="button" onClick={onClose} aria-label="关闭徽章设置">
          <X size={16} />
        </button>
      </header>

      {loading ? (
        <div className="activity-badge-editor__loading">
          <Loader2 size={17} className="animate-spin" /> 正在读取徽章……
        </div>
      ) : (
        <div className="activity-badge-editor__body">
          <div className="activity-badge-editor__preview-stage">
            <div className="activity-badge-editor__preview-card">
              <div className="activity-badge-editor__preview-image">
                {imageUrl ? (
                  <img src={imageUrl} alt="徽章预览" />
                ) : (
                  <ImagePlus size={34} aria-hidden="true" />
                )}
              </div>
              <div>
                <strong>{activityName}纪念徽章</strong>
                <span>个人中心实际展示尺寸</span>
              </div>
            </div>
          </div>

          <div className="activity-badge-editor__controls">
            <div className="activity-badge-editor__rule">
              <span>获得条件</span>
              <strong>完成 {minimumMatchCount} 场有效对局</strong>
              <p>上传成功后开始自动授予；已经达标的玩家会立即补发。替换图片不会重复授予。</p>
            </div>
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="选择活动徽章图片"
              onChange={selectImage}
            />
            <div className="activity-badge-editor__actions">
              <ActionButton
                variant="secondary"
                type="button"
                disabled={saving}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={15} />
                {view?.badge ? '选择新图片' : '选择图片'}
              </ActionButton>
              <ActionButton
                type="button"
                disabled={!selectedFile || saving}
                onClick={() => void save()}
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Award size={15} />}
                {view?.badge ? '更换徽章' : '启用徽章'}
              </ActionButton>
            </div>
            <p className="activity-badge-editor__hint">
              支持 JPG、PNG、静态 WebP，宽和高至少 128 像素，最大 8 MB。透明背景会保留。
            </p>
            {selectedFile ? (
              <p className="activity-badge-editor__selection">已选择：{selectedFile.name}</p>
            ) : null}
            {error ? (
              <p className="activity-badge-editor__error" role="alert">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="activity-badge-editor__notice" role="status">
                {notice}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}

async function decodeImage(file: File): Promise<void> {
  if ('createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    image.src = url;
  });
}

function createIdempotencyKey(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `activity-badge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
