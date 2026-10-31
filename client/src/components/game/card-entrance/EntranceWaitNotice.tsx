import { useEffect, useState } from 'react';

/** Covers ordinary poll/start skew and the ACK round trip, without delaying completion. */
export function EntranceWaitNotice({ viewerWaiting }: { viewerWaiting: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return visible ? (
    <div className="card-entrance-wait" role="status">
      {viewerWaiting ? '正在同步演出结果' : '等待对方演出结束'}
    </div>
  ) : null;
}
