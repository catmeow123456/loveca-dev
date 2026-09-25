import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { appUpdateCoordinator, useAppUpdateState } from '@/lib/appUpdateCoordinator';
import { ConfirmDialog } from './ConfirmDialog';

export function AppUpdateNotice({ canApplyUpdateNow }: { canApplyUpdateNow: boolean }) {
  const updateState = useAppUpdateState();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isApplying = updateState.status === 'APPLYING' || updateState.status === 'PREPARING';
  const isVisible =
    updateState.status === 'AVAILABLE' || updateState.status === 'ERROR' || isApplying;

  if (!canApplyUpdateNow || !isVisible) return null;

  return (
    <>
      <aside
        role="status"
        aria-live="polite"
        className="surface-panel-frosted fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-[170] mx-auto max-w-lg p-3 shadow-[var(--shadow-lg)] md:inset-x-auto md:right-4 md:bottom-4 md:mx-0 md:w-[min(420px,calc(100vw-2rem))]"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--accent-primary)]">
            <RefreshCw size={16} className={isApplying ? 'animate-spin' : ''} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {updateState.status === 'PREPARING'
                ? '正在下载并准备新版…'
                : updateState.status === 'APPLYING'
                  ? '正在切换到新版…'
                  : updateState.status === 'ERROR'
                    ? '更新未完成。'
                    : updateState.waitingWorkerAvailable
                      ? '新版已准备好，可以更新。'
                      : '发现新版，可以开始更新。'}
            </p>
            {updateState.error ? (
              <p className="mt-1 text-xs leading-5 text-[var(--semantic-error)]">
                {updateState.error}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={isApplying}
                onClick={() => appUpdateCoordinator.deferCurrentUpdate()}
                className="button-ghost min-h-9 px-3 text-sm font-semibold disabled:opacity-50"
              >
                稍后
              </button>
              <button
                type="button"
                disabled={isApplying}
                onClick={() => setConfirmOpen(true)}
                className="button-primary min-h-9 px-3 text-sm font-semibold disabled:opacity-50"
              >
                {updateState.status === 'ERROR' ? '重试更新' : '立即更新'}
              </button>
            </div>
          </div>
        </div>
      </aside>

      <ConfirmDialog
        isOpen={confirmOpen}
        title="立即更新 Loveca？"
        message="页面将重新加载，尚未保存的页面操作会丢失。"
        confirmLabel="重新加载并更新"
        tone="primary"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void appUpdateCoordinator.applyCurrentUpdate();
        }}
      />
    </>
  );
}
