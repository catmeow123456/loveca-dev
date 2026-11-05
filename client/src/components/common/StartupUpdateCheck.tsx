import { useRef, useState } from 'react';
import { appUpdateCoordinator, useAppUpdateState } from '@/lib/appUpdateCoordinator';

/** Keep recovery on the existing updater, including its active-match guard. */
export function StartupUpdateCheck() {
  const update = useAppUpdateState();
  const pending = useRef(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const updating = update.status === 'PREPARING' || update.status === 'APPLYING';

  const check = async () => {
    if (pending.current || updating) return;
    pending.current = true;
    setChecking(true);
    setMessage('');
    try {
      const result = await appUpdateCoordinator.checkVersionManifest(fetch, { manual: true });
      setMessage(
        result === 'available'
          ? '发现新版，请通过更新提示完成升级。'
          : result === 'current'
            ? '当前已是最新版，请重试连接。'
            : result === 'busy'
              ? '正在更新，请稍候。'
              : '暂时无法检查版本，请检查网络后重试。'
      );
    } finally {
      pending.current = false;
      setChecking(false);
    }
  };

  return (
    <div className="mt-4 text-center">
      <button
        type="button"
        className="button-secondary px-4 py-2"
        onClick={() => void check()}
        disabled={checking || updating}
      >
        {checking ? '正在检查版本…' : '检查版本更新'}
      </button>
      {message && (
        <p role="status" className="mt-2 text-sm text-[var(--text-secondary)]">
          {message}
        </p>
      )}
    </div>
  );
}
