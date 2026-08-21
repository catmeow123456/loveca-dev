import { useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type { PublicSiteMaintenanceStatus } from '@/lib/appConfig';
import './service-status-page.css';

interface ServiceStatusPageProps {
  readonly kind: 'MAINTENANCE' | 'UNAVAILABLE';
  readonly maintenance?: PublicSiteMaintenanceStatus | null;
}

export function ServiceStatusPage({ kind, maintenance = null }: ServiceStatusPageProps) {
  const [adminMessage, setAdminMessage] = useState<string | null>(null);
  const isMaintenance = kind === 'MAINTENANCE';

  const checkStatus = () => {
    window.location.reload();
  };

  const openAdminRecovery = async () => {
    setAdminMessage(null);
    try {
      const response = await fetch(`/api/ready?t=${Date.now()}`, { cache: 'no-store' });
      if (!response.ok) {
        setAdminMessage('管理服务尚未就绪，请先恢复 API 与数据库。');
        return;
      }
      const target = new URL(window.location.href);
      target.pathname = '/';
      target.search = '?page=announcement-admin&maintenanceAdmin=1';
      target.hash = '';
      window.location.assign(target.toString());
    } catch {
      setAdminMessage('管理服务尚未就绪，请先恢复 API 与数据库。');
    }
  };

  return (
    <main className="service-status-page">
      <section className="service-status-card" aria-labelledby="service-status-title">
        <div className="service-status-stage" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="service-status-kicker">
          <span className="service-status-dot" />
          {isMaintenance ? 'INTERMISSION' : 'CONNECTION LOST'}
        </div>
        <h1 id="service-status-title">{isMaintenance ? '幕间维护' : '暂时无法入场'}</h1>
        <p className="service-status-summary">
          {isMaintenance
            ? (maintenance?.title ?? '舞台正在整备')
            : '当前没有连上 Loveca。'}
        </p>
        <p className="service-status-detail">
          {isMaintenance
            ? (maintenance?.summary ?? '稍后再见，下一场 LIVE 很快开始。')
            : '请检查网络，或稍后再试。'}
        </p>

        <div className="service-status-actions">
          <button type="button" className="button-primary" onClick={checkStatus}>
            <RefreshCw size={16} />
            {isMaintenance ? '再试一次' : '重新连接'}
          </button>
          <button
            type="button"
            className="service-status-admin"
            onClick={() => void openAdminRecovery()}
          >
            <ShieldCheck size={14} />
            运营入口
          </button>
        </div>

        {adminMessage ? (
          <div className="service-status-check" role="status">
            {adminMessage}
          </div>
        ) : null}

        {isMaintenance && maintenance?.detail ? (
          <p className="service-status-note">{maintenance.detail}</p>
        ) : null}

        {isMaintenance &&
        (maintenance?.startsAt ||
          maintenance?.estimatedEndsAt ||
          (maintenance?.impactScopes.length ?? 0) > 0) ? (
          <dl className="service-status-meta">
            {maintenance?.startsAt ? (
              <div>
                <dt>开始时间</dt>
                <dd>{formatDateTime(maintenance.startsAt)}</dd>
              </div>
            ) : null}
            {maintenance?.estimatedEndsAt ? (
              <div>
                <dt>预计恢复</dt>
                <dd>{formatDateTime(maintenance.estimatedEndsAt)}</dd>
              </div>
            ) : null}
            {(maintenance?.impactScopes.length ?? 0) > 0 ? (
              <div>
                <dt>影响范围</dt>
                <dd>{maintenance?.impactScopes.join('、')}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {isMaintenance && maintenance?.action ? (
          <p className="service-status-action">{maintenance.action}</p>
        ) : null}
      </section>
    </main>
  );
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(new Date(timestamp));
}
