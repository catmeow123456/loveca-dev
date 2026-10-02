import { useEffect, useState } from 'react';
import {
  fetchAdminCardEntranceConfig,
  updateAdminCardEntranceConfig,
} from '@/lib/siteAnnouncementClient';

export function CardEntranceConfigPanel({ onSaved }: { onSaved?: () => void | Promise<void> }) {
  const [saved, setSaved] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function load() {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const config = await fetchAdminCardEntranceConfig();
      setSaved(config.enabled);
      setEnabled(config.enabled);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取卡牌动效配置失败');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const config = await updateAdminCardEntranceConfig({ enabled });
      setSaved(config.enabled);
      setEnabled(config.enabled);
      setNotice(config.enabled ? '已向玩家开放卡牌登场动效' : '已关闭全站卡牌登场动效');
      await onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请刷新确认当前状态');
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="product-workbench p-4" aria-labelledby="entrance-config-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id="entrance-config-title" className="text-sm font-bold text-[var(--text-primary)]">
            卡牌登场动效
          </h3>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            控制是否向所有玩家开放人物登场及落场演出。普通移牌动画不受影响。
          </p>
        </div>
        <span className="text-xs text-[var(--text-secondary)]">
          {loading
            ? '读取中…'
            : saved === null
              ? '未读取'
              : saved
                ? '当前：已开放'
                : '当前：已关闭'}
        </span>
      </div>
      <label className="mt-4 flex items-center gap-3 text-sm text-[var(--text-primary)]">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={loading || saving || saved === null}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setNotice('');
          }}
        />
        向所有玩家开放卡牌登场动效
      </label>
      <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
        关闭后不再播放登场演出，并隐藏玩家右上角的动效开关；正在等待的演出将结束，卡效继续处理。重新开放后恢复玩家原有个人设置。
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-[var(--accent-primary)]">
          {notice}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          className="rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm text-white disabled:opacity-40"
          disabled={loading || saving || saved === null || saved === enabled}
          onClick={() => void save()}
        >
          {saving ? '保存中…' : '保存动效设置'}
        </button>
        <button
          className="rounded-lg border border-[var(--border-subtle)] px-4 py-2 text-sm text-[var(--text-secondary)] disabled:opacity-40"
          disabled={loading || saving}
          onClick={() => void load()}
        >
          刷新状态
        </button>
      </div>
    </section>
  );
}
