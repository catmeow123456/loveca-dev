import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
  Clock3,
  Megaphone,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { AdminPageHeader } from './AdminPageHeader';
import type { PublicSiteStatus, SiteAnnouncementType, SiteStatusLifecycle } from '@/lib/appConfig';
import {
  createAdminSiteAnnouncement,
  deleteAdminSiteAnnouncement,
  fetchAdminSiteAnnouncements,
  fetchAdminBattleTimeoutConfig,
  fetchAdminSiteStatus,
  publishAdminSiteAnnouncement,
  updateAdminSiteStatusConfig,
  updateAdminBattleTimeoutConfig,
  updateAdminSiteAnnouncement,
  type AdminSiteAnnouncement,
  type AdminSiteStatusView,
  type PublicSnapshotInspection,
  type SiteAnnouncementInput,
  type SiteStatusConfigInput,
} from '@/lib/siteAnnouncementClient';
import { useKeyedState } from '@/hooks/useKeyedState';
import {
  CASUAL_CONFIRMATION_TTL_SECONDS_MAX,
  CASUAL_CONFIRMATION_TTL_SECONDS_MIN,
  CASUAL_HEARTBEAT_GRACE_SECONDS_MAX,
  CASUAL_HEARTBEAT_GRACE_SECONDS_MIN,
  DEFAULT_BATTLE_TIMEOUT_CONFIG,
  DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG,
  DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MAX,
  DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MIN,
  ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MAX,
  ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MIN,
  formatBattleTimeoutSeconds,
  type AdminBattleTimeoutSettings,
} from '@game/online';

const DEFAULT_ADMIN_BATTLE_TIMEOUT_SETTINGS: AdminBattleTimeoutSettings = {
  battleTimeouts: DEFAULT_BATTLE_TIMEOUT_CONFIG,
  roomLifecycle: DEFAULT_ROOM_LIFECYCLE_TIMEOUT_CONFIG,
};

const SITE_STATUS_LABELS: Record<SiteStatusLifecycle, string> = {
  NORMAL: '正常',
  RESTRICTING_NEW_GAMES: '限制新开局',
  MAINTENANCE: '维护中',
};

const ANNOUNCEMENT_TYPE_LABELS: Record<SiteAnnouncementType, string> = {
  MAINTENANCE: '维护',
  UPDATE: '更新',
  NEWS: '动态',
};

const ANNOUNCEMENT_TYPE_OPTIONS: readonly SiteAnnouncementType[] = [
  'MAINTENANCE',
  'UPDATE',
  'NEWS',
];

const SITE_STATUS_OPTIONS: readonly {
  value: SiteStatusLifecycle;
  label: string;
  description: string;
  defaultTitle: string;
  defaultSummary: string;
}[] = [
  {
    value: 'NORMAL',
    label: '正常运行',
    description: '普通页面和新对局均可使用。',
    defaultTitle: '',
    defaultSummary: '',
  },
  {
    value: 'RESTRICTING_NEW_GAMES',
    label: '限制新对局',
    description: '非对局页面可用；拒绝创建、加入、开局和重开，存量对局可收尾。',
    defaultTitle: '维护准备中',
    defaultSummary: '平台正在为维护排空对局，暂时不能开始新的对局。',
  },
  {
    value: 'MAINTENANCE',
    label: '整站维护',
    description: '普通用户只看到维护页；进入前应确认存量对局已经排空。',
    defaultTitle: '舞台正在整备',
    defaultSummary: '稍后再见，下一场 LIVE 很快开始。',
  },
];

interface AnnouncementFormState {
  type: SiteAnnouncementType;
  title: string;
  summary: string;
  detail: string;
  startsAt: string;
  endsAt: string;
  priority: string;
  impactScopes: string;
}

const EMPTY_ANNOUNCEMENT_FORM: AnnouncementFormState = {
  type: 'MAINTENANCE',
  title: '',
  summary: '',
  detail: '',
  startsAt: '',
  endsAt: '',
  priority: '0',
  impactScopes: '',
};

interface SiteStatusFormState {
  lifecycle: SiteStatusLifecycle;
  title: string;
  summary: string;
  detail: string;
  startsAt: string;
  estimatedEndsAt: string;
  restrictsNewGamesAt: string;
  impactScopes: string;
  restrictions: string;
  action: string;
}

interface SiteAnnouncementsAdminPageProps {
  onBack: () => void;
  siteStatus: PublicSiteStatus;
  onSiteStatusChanged?: () => void | Promise<void>;
}

export function SiteAnnouncementsAdminPage({
  onBack,
  siteStatus,
  onSiteStatusChanged,
}: SiteAnnouncementsAdminPageProps) {
  const [announcements, setAnnouncements] = useState<readonly AdminSiteAnnouncement[]>([]);
  const [isLoadingAnnouncements, setIsLoadingAnnouncements] = useState(true);
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const [workingAnnouncementId, setWorkingAnnouncementId] = useState<string | null>(null);
  const [announcementError, setAnnouncementError] = useState<string | null>(null);
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null);
  const [form, setForm] = useState<AnnouncementFormState>(EMPTY_ANNOUNCEMENT_FORM);
  const [adminSiteStatus, setAdminSiteStatus] = useState<AdminSiteStatusView | null>(null);
  const effectiveSiteStatus = adminSiteStatus?.siteStatus ?? siteStatus;
  const [siteStatusForm, setSiteStatusForm] = useKeyedState<SiteStatusFormState>(
    JSON.stringify(effectiveSiteStatus),
    buildSiteStatusForm(effectiveSiteStatus)
  );
  const [isSavingSiteStatus, setIsSavingSiteStatus] = useState(false);
  const [siteStatusError, setSiteStatusError] = useState<string | null>(null);
  const [battleTimeoutSettings, setBattleTimeoutSettings] = useState<AdminBattleTimeoutSettings>(
    DEFAULT_ADMIN_BATTLE_TIMEOUT_SETTINGS
  );
  const [battleTimeoutDraft, setBattleTimeoutDraft] = useState<AdminBattleTimeoutSettings>(
    DEFAULT_ADMIN_BATTLE_TIMEOUT_SETTINGS
  );
  const [isLoadingBattleTimeouts, setIsLoadingBattleTimeouts] = useState(true);
  const [isSavingBattleTimeouts, setIsSavingBattleTimeouts] = useState(false);
  const [battleTimeoutError, setBattleTimeoutError] = useState<string | null>(null);
  const maintenance = effectiveSiteStatus.maintenance;
  const editingAnnouncement =
    editingAnnouncementId !== null
      ? announcements.find((announcement) => announcement.id === editingAnnouncementId)
      : null;

  const loadAnnouncements = useCallback(async () => {
    setIsLoadingAnnouncements(true);
    setAnnouncementError(null);
    try {
      setAnnouncements(await fetchAdminSiteAnnouncements());
    } catch (error) {
      setAnnouncementError(error instanceof Error ? error.message : '读取公告失败');
    } finally {
      setIsLoadingAnnouncements(false);
    }
  }, []);

  const refreshPublicStatus = useCallback(async () => {
    await onSiteStatusChanged?.();
  }, [onSiteStatusChanged]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAnnouncements();
      void fetchAdminSiteStatus()
        .then(setAdminSiteStatus)
        .catch((error) =>
          setSiteStatusError(error instanceof Error ? error.message : '读取平台状态失败')
        );
      void fetchAdminBattleTimeoutConfig()
        .then((config) => {
          setBattleTimeoutSettings(config);
          setBattleTimeoutDraft(config);
        })
        .catch((error) =>
          setBattleTimeoutError(error instanceof Error ? error.message : '读取对战时限配置失败')
        )
        .finally(() => setIsLoadingBattleTimeouts(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAnnouncements]);

  const saveBattleTimeouts = useCallback(async () => {
    setIsSavingBattleTimeouts(true);
    setBattleTimeoutError(null);
    try {
      const saved = await updateAdminBattleTimeoutConfig(battleTimeoutDraft);
      setBattleTimeoutSettings(saved);
      setBattleTimeoutDraft(saved);
      await onSiteStatusChanged?.();
    } catch (error) {
      setBattleTimeoutError(error instanceof Error ? error.message : '保存对战时限配置失败');
    } finally {
      setIsSavingBattleTimeouts(false);
    }
  }, [battleTimeoutDraft, onSiteStatusChanged]);

  const saveSiteStatus = useCallback(async () => {
    const input = buildSiteStatusConfigInput(siteStatusForm);
    if (
      input.lifecycle === 'MAINTENANCE' &&
      effectiveSiteStatus.lifecycle !== 'MAINTENANCE' &&
      !window.confirm('进入整站维护后，普通用户将只能看到系统维护页。确认继续吗？')
    ) {
      return;
    }
    input.maintenanceConfirmed = input.lifecycle === 'MAINTENANCE';
    setIsSavingSiteStatus(true);
    setSiteStatusError(null);
    try {
      setAdminSiteStatus(await updateAdminSiteStatusConfig(input));
      await refreshPublicStatus();
    } catch (error) {
      setSiteStatusError(error instanceof Error ? error.message : '保存平台状态失败');
    } finally {
      setIsSavingSiteStatus(false);
    }
  }, [effectiveSiteStatus.lifecycle, refreshPublicStatus, siteStatusForm]);

  const resetForm = useCallback(() => {
    setEditingAnnouncementId(null);
    setForm(EMPTY_ANNOUNCEMENT_FORM);
  }, []);

  const handleEditAnnouncement = useCallback((announcement: AdminSiteAnnouncement) => {
    setEditingAnnouncementId(announcement.id);
    setForm({
      type: announcement.type,
      title: announcement.title,
      summary: announcement.summary,
      detail: announcement.detail ?? '',
      startsAt: toDateTimeLocalInputValue(announcement.startsAt),
      endsAt: toDateTimeLocalInputValue(announcement.endsAt),
      priority: String(announcement.priority),
      impactScopes: announcement.impactScopes.join('、'),
    });
  }, []);

  const saveAnnouncement = useCallback(
    async (publish: boolean) => {
      const input = buildAnnouncementInput(form, publish);
      setIsSavingAnnouncement(true);
      setAnnouncementError(null);
      try {
        if (editingAnnouncementId) {
          const saved = await updateAdminSiteAnnouncement(editingAnnouncementId, input);
          if (publish && saved.status !== 'PUBLISHED') {
            await publishAdminSiteAnnouncement(saved.id);
          }
        } else {
          await createAdminSiteAnnouncement(input);
        }

        resetForm();
        await loadAnnouncements();
        await refreshPublicStatus();
      } catch (error) {
        setAnnouncementError(error instanceof Error ? error.message : '保存公告失败');
      } finally {
        setIsSavingAnnouncement(false);
      }
    },
    [editingAnnouncementId, form, loadAnnouncements, refreshPublicStatus, resetForm]
  );

  const handlePublishAnnouncement = useCallback(
    async (announcementId: string) => {
      setWorkingAnnouncementId(announcementId);
      setAnnouncementError(null);
      try {
        await publishAdminSiteAnnouncement(announcementId);
        await loadAnnouncements();
        await refreshPublicStatus();
      } catch (error) {
        setAnnouncementError(error instanceof Error ? error.message : '发布公告失败');
      } finally {
        setWorkingAnnouncementId(null);
      }
    },
    [loadAnnouncements, refreshPublicStatus]
  );

  const handleDeleteAnnouncement = useCallback(
    async (announcement: AdminSiteAnnouncement) => {
      if (!window.confirm(`确定删除公告“${announcement.title}”吗？`)) {
        return;
      }

      setWorkingAnnouncementId(announcement.id);
      setAnnouncementError(null);
      try {
        await deleteAdminSiteAnnouncement(announcement.id);
        if (editingAnnouncementId === announcement.id) {
          resetForm();
        }
        await loadAnnouncements();
        await refreshPublicStatus();
      } catch (error) {
        setAnnouncementError(error instanceof Error ? error.message : '删除公告失败');
      } finally {
        setWorkingAnnouncementId(null);
      }
    },
    [editingAnnouncementId, loadAnnouncements, refreshPublicStatus, resetForm]
  );

  return (
    <div className="app-shell min-h-screen">
      <AdminPageHeader title="平台配置" category="内容与平台" onBack={onBack} />

      <main className="product-page-main flex flex-col gap-4">
        <SiteStatusControlPanel
          siteStatus={effectiveSiteStatus}
          publicSnapshot={adminSiteStatus?.publicSnapshot ?? null}
          maintenanceSummary={maintenance?.summary ?? null}
          form={siteStatusForm}
          error={siteStatusError}
          isSaving={isSavingSiteStatus}
          onFormChange={setSiteStatusForm}
          onSave={() => void saveSiteStatus()}
        />

        <BattleTimeoutControlPanel
          value={battleTimeoutDraft}
          savedValue={battleTimeoutSettings}
          loading={isLoadingBattleTimeouts}
          saving={isSavingBattleTimeouts}
          error={battleTimeoutError}
          onChange={setBattleTimeoutDraft}
          onSave={() => void saveBattleTimeouts()}
        />

        <section className="product-workbench p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Megaphone size={16} className="text-[var(--accent-primary)]" />
              <h3 className="text-sm font-bold text-[var(--text-primary)]">公告列表</h3>
              <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                {announcements.length} 条
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void loadAnnouncements()}
                disabled={isLoadingAnnouncements}
                className="button-ghost inline-flex h-9 items-center justify-center gap-1.5 px-2.5 text-xs"
              >
                <RefreshCw size={14} className={isLoadingAnnouncements ? 'animate-spin' : ''} />
                刷新公告
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="button-secondary inline-flex h-9 items-center justify-center gap-1.5 px-2.5 text-xs"
              >
                <Plus size={14} />
                新建公告
              </button>
            </div>
          </div>

          {announcementError ? (
            <div className="mb-3 rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
              {announcementError}
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="product-list content-start overflow-hidden rounded-lg border border-[var(--border-subtle)]">
              {isLoadingAnnouncements ? (
                <div className="flex min-h-40 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-sm text-[var(--text-secondary)]">
                  <RefreshCw size={16} className="mr-2 animate-spin text-[var(--accent-primary)]" />
                  正在读取公告
                </div>
              ) : announcements.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-5 text-sm text-[var(--text-secondary)]">
                  当前没有管理员公告。可先创建维护公告或版本更新，再发布到首页。
                </div>
              ) : (
                announcements.map((announcement) => (
                  <AdminAnnouncementRow
                    key={announcement.id}
                    announcement={announcement}
                    selected={announcement.id === editingAnnouncementId}
                    working={workingAnnouncementId === announcement.id}
                    onEdit={() => handleEditAnnouncement(announcement)}
                    onPublish={() => void handlePublishAnnouncement(announcement.id)}
                    onDelete={() => void handleDeleteAnnouncement(announcement)}
                  />
                ))
              )}
            </div>

            <AnnouncementEditor
              form={form}
              editingAnnouncement={editingAnnouncement ?? null}
              isSaving={isSavingAnnouncement}
              onFormChange={setForm}
              onCancelEdit={resetForm}
              onSave={(publish) => void saveAnnouncement(publish)}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

interface TimeoutFieldDefinition {
  key: string;
  label: string;
  detail: string;
  min: number;
  max: number;
  step: number;
  getValue: (settings: AdminBattleTimeoutSettings) => number;
  update: (settings: AdminBattleTimeoutSettings, seconds: number) => AdminBattleTimeoutSettings;
}

const RANKED_TIMEOUT_FIELDS: readonly TimeoutFieldDefinition[] = [
  {
    key: 'playerActionTimeoutSeconds',
    label: '玩家操作超时',
    detail: '排位中轮到某位玩家操作时，连续这么久没有成功操作即判负。',
    min: 60,
    max: 900,
    step: 30,
    getValue: (settings) => settings.battleTimeouts.playerActionTimeoutSeconds,
    update: (settings, seconds) => ({
      ...settings,
      battleTimeouts: { ...settings.battleTimeouts, playerActionTimeoutSeconds: seconds },
    }),
  },
  {
    key: 'reconnectGracePeriodSeconds',
    label: '断线重连期限',
    detail: '排位中玩家断线后，这么久内重连可回到对局；超时未归由断线方判负。',
    min: 15,
    max: 300,
    step: 15,
    getValue: (settings) => settings.battleTimeouts.reconnectGracePeriodSeconds,
    update: (settings, seconds) => ({
      ...settings,
      battleTimeouts: { ...settings.battleTimeouts, reconnectGracePeriodSeconds: seconds },
    }),
  },
  {
    key: 'doubleDisconnectNoContestWindowSeconds',
    label: '双方断线判定窗口',
    detail:
      '双方都断线且都超过重连期限时，比较两人最后在线时间：相差不超过该窗口则本局无结果、不计积分；超过则较早离线方判负。',
    min: DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MIN,
    max: DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_SECONDS_MAX,
    step: 1,
    getValue: (settings) => settings.battleTimeouts.doubleDisconnectNoContestWindowSeconds,
    update: (settings, seconds) => ({
      ...settings,
      battleTimeouts: { ...settings.battleTimeouts, doubleDisconnectNoContestWindowSeconds: seconds },
    }),
  },
];

const ROOM_LIFECYCLE_TIMEOUT_FIELDS: readonly TimeoutFieldDefinition[] = [
  {
    key: 'roomDestroyAfterAllAbsentSeconds',
    label: '全员离线销房期限',
    detail: '房间里所有人都离线后，再过这么久房间被回收、未完成的对局封存。',
    min: ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MIN,
    max: ROOM_DESTROY_AFTER_ALL_ABSENT_SECONDS_MAX,
    step: 30,
    getValue: (settings) => settings.roomLifecycle.roomDestroyAfterAllAbsentSeconds,
    update: (settings, seconds) => ({
      ...settings,
      roomLifecycle: { ...settings.roomLifecycle, roomDestroyAfterAllAbsentSeconds: seconds },
    }),
  },
  {
    key: 'casualHeartbeatGraceSeconds',
    label: '休闲房间心跳宽限',
    detail:
      '休闲配对准备中，心跳（约每 15 秒一次）中断这么久后席位失效并被回收。下限 45 秒保证至少三次心跳余量。',
    min: CASUAL_HEARTBEAT_GRACE_SECONDS_MIN,
    max: CASUAL_HEARTBEAT_GRACE_SECONDS_MAX,
    step: 15,
    getValue: (settings) => settings.roomLifecycle.casualHeartbeatGraceSeconds,
    update: (settings, seconds) => ({
      ...settings,
      roomLifecycle: { ...settings.roomLifecycle, casualHeartbeatGraceSeconds: seconds },
    }),
  },
  {
    key: 'casualConfirmationTtlSeconds',
    label: '休闲房间配对确认期限',
    detail: '配对进入双方确认阶段后，需在这么久内完成确认；超时按无过错恢复处理。',
    min: CASUAL_CONFIRMATION_TTL_SECONDS_MIN,
    max: CASUAL_CONFIRMATION_TTL_SECONDS_MAX,
    step: 15,
    getValue: (settings) => settings.roomLifecycle.casualConfirmationTtlSeconds,
    update: (settings, seconds) => ({
      ...settings,
      roomLifecycle: { ...settings.roomLifecycle, casualConfirmationTtlSeconds: seconds },
    }),
  },
];

const ALL_TIMEOUT_FIELDS: readonly TimeoutFieldDefinition[] = [
  ...RANKED_TIMEOUT_FIELDS,
  ...ROOM_LIFECYCLE_TIMEOUT_FIELDS,
];

function BattleTimeoutControlPanel({
  value,
  savedValue,
  loading,
  saving,
  error,
  onChange,
  onSave,
}: {
  value: AdminBattleTimeoutSettings;
  savedValue: AdminBattleTimeoutSettings;
  loading: boolean;
  saving: boolean;
  error: string | null;
  onChange: (value: AdminBattleTimeoutSettings) => void;
  onSave: () => void;
}) {
  const hasChanges = ALL_TIMEOUT_FIELDS.some(
    (field) => field.getValue(value) !== field.getValue(savedValue)
  );
  const isValid = ALL_TIMEOUT_FIELDS.every((field) => {
    const seconds = field.getValue(value);
    return Number.isInteger(seconds) && seconds >= field.min && seconds <= field.max;
  });

  return (
    <section className="product-workbench overflow-hidden" aria-labelledby="battle-timeout-title">
      <header className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--accent-primary)]">
            <Clock3 size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="battle-timeout-title"
                className="text-base font-bold text-[var(--text-primary)]"
              >
                对战时限
              </h2>
              {hasChanges ? (
                <span className="rounded-md border border-[color:var(--semantic-warning)]/40 bg-[color:var(--semantic-warning)]/10 px-2 py-0.5 text-xs font-semibold text-[var(--semantic-warning)]">
                  未保存的修改
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              全局统一设置，不随赛季或活动分别配置。排位裁定在开局时冻结，房间回收立即生效。
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(DEFAULT_ADMIN_BATTLE_TIMEOUT_SETTINGS)}
            disabled={loading || saving}
            className="button-secondary inline-flex h-10 items-center justify-center gap-1.5 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-45"
          >
            <RefreshCw size={14} />
            恢复默认
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={loading || saving || !hasChanges || !isValid}
            className="button-primary inline-flex h-10 items-center justify-center gap-1.5 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? '保存中' : '保存对战时限'}
          </button>
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-4 rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <TimeoutGroupCard
          title="排位裁定"
          scopeLabel="赛季排位 · 开局冻结"
          description="仅影响赛季排位对局。开局时锁定当时的值，保存后只影响之后开始的对局。"
        >
          {RANKED_TIMEOUT_FIELDS.map((field) => (
            <TimeoutNumberField
              key={field.key}
              label={field.label}
              detail={field.detail}
              value={field.getValue(value)}
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={loading || saving}
              modified={field.getValue(value) !== field.getValue(savedValue)}
              onChange={(seconds) => onChange(field.update(value, seconds))}
            />
          ))}
        </TimeoutGroupCard>
        <TimeoutGroupCard
          title="房间与配对回收"
          scopeLabel="休闲房间 · 立即生效"
          description="影响休闲房间，不含排位／主题候场队列。保存后立即生效，进行中房间在下一个清理周期采用新值。"
        >
          {ROOM_LIFECYCLE_TIMEOUT_FIELDS.map((field) => (
            <TimeoutNumberField
              key={field.key}
              label={field.label}
              detail={field.detail}
              value={field.getValue(value)}
              min={field.min}
              max={field.max}
              step={field.step}
              disabled={loading || saving}
              modified={field.getValue(value) !== field.getValue(savedValue)}
              onChange={(seconds) => onChange(field.update(value, seconds))}
            />
          ))}
        </TimeoutGroupCard>
      </div>
    </section>
  );
}

function TimeoutGroupCard({
  title,
  scopeLabel,
  description,
  children,
}: {
  title: string;
  scopeLabel: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid content-start gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
        <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
          {scopeLabel}
        </span>
      </header>
      <p className="text-xs leading-5 text-[var(--text-secondary)]">{description}</p>
      <div className="grid divide-y divide-[var(--border-subtle)]">{children}</div>
    </section>
  );
}

function TimeoutNumberField({
  label,
  detail,
  value,
  min,
  max,
  step,
  disabled,
  modified,
  onChange,
}: {
  label: string;
  detail: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  modified: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-1.5 py-3">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]">{label}</span>
        {modified ? (
          <span className="rounded-md border border-[color:var(--accent-primary)]/40 bg-[color:var(--accent-primary)]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent-primary)]">
            已修改
          </span>
        ) : null}
      </span>
      <span className="text-xs leading-5 text-[var(--text-muted)]">{detail}</span>
      <span className="mt-1 flex max-w-56 items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-invalid={!Number.isInteger(value) || value < min || value > max}
          onChange={(event) => onChange(Number(event.target.value))}
          className="input-field h-10 min-w-0 flex-1 text-sm tabular-nums"
        />
        <span className="text-xs font-semibold text-[var(--text-secondary)]">秒</span>
      </span>
      <span className="text-[11px] text-[var(--text-muted)]">
        当前 {formatBattleTimeoutSeconds(value)}；可设置 {min}–{max} 秒
      </span>
    </label>
  );
}

function SiteStatusControlPanel({
  siteStatus,
  publicSnapshot,
  maintenanceSummary,
  form,
  error,
  isSaving,
  onFormChange,
  onSave,
}: {
  siteStatus: PublicSiteStatus;
  publicSnapshot: PublicSnapshotInspection | null;
  maintenanceSummary: string | null;
  form: SiteStatusFormState;
  error: string | null;
  isSaving: boolean;
  onFormChange: (nextForm: SiteStatusFormState) => void;
  onSave: () => void;
}) {
  const isRestricted =
    siteStatus.lifecycle === 'MAINTENANCE' || siteStatus.lifecycle === 'RESTRICTING_NEW_GAMES';

  return (
    <section className="product-workbench p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] ${
              isRestricted ? 'text-[var(--semantic-warning)]' : 'text-[var(--accent-primary)]'
            }`}
          >
            <ShieldCheck size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-[var(--text-primary)]">平台状态</h2>
              <span
                className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${
                  isRestricted
                    ? 'border-[color:var(--semantic-warning)]/40 bg-[color:var(--semantic-warning)]/10 text-[var(--semantic-warning)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-secondary)]'
                }`}
              >
                {SITE_STATUS_LABELS[siteStatus.lifecycle]}
              </span>
            </div>
            <div className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
              {maintenanceSummary ?? '当前没有计划维护或限制策略。'}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
              <span>首页已发布公告 {siteStatus.announcements.length} 条</span>
              <span>
                公开快照：{publicSnapshot ? formatSnapshotStatus(publicSnapshot) : '正在核验'}
              </span>
              {siteStatus.maintenance?.startsAt ? (
                <span>开始 {formatSiteStatusDateTime(siteStatus.maintenance.startsAt)}</span>
              ) : null}
              {siteStatus.maintenance?.estimatedEndsAt ? (
                <span>
                  预计结束 {formatSiteStatusDateTime(siteStatus.maintenance.estimatedEndsAt)}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onSave}
          disabled={isSaving}
          className="button-primary inline-flex h-10 shrink-0 items-center justify-center gap-1.5 px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save size={14} />
          {isSaving ? '保存中' : '保存平台状态'}
        </button>
      </div>

      {error || (publicSnapshot && publicSnapshot.status !== 'SYNCED') ? (
        <div className="mb-3 rounded-lg border border-[color:var(--semantic-error)]/40 bg-[color:var(--semantic-error)]/10 px-3 py-2 text-sm text-[var(--semantic-error)]">
          {error ?? publicSnapshot?.error ?? '公开维护快照无法核验，请检查持久目录与代理接线。'}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-xs font-semibold text-[var(--text-secondary)]">
            平台运行状态
          </legend>
          {SITE_STATUS_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition ${
                form.lifecycle === option.value
                  ? 'border-[color:var(--semantic-warning)]/45 bg-[color:var(--semantic-warning)]/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
              }`}
            >
              <input
                type="radio"
                name="site-lifecycle"
                checked={form.lifecycle === option.value}
                onChange={() =>
                  onFormChange({
                    ...form,
                    lifecycle: option.value,
                    title:
                      option.value !== 'NORMAL' && !form.title ? option.defaultTitle : form.title,
                    summary:
                      option.value !== 'NORMAL' && !form.summary
                        ? option.defaultSummary
                        : form.summary,
                  })
                }
                className="mt-1 h-4 w-4 accent-[var(--semantic-warning)]"
              />
              <span>
                <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                  <Power size={14} />
                  {option.label}
                </span>
                <span className="mt-1 block text-xs leading-5 text-[var(--text-secondary)]">
                  {option.description}
                </span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              标题
              <input
                value={form.title}
                onChange={(event) => onFormChange({ ...form, title: event.target.value })}
                maxLength={120}
                className="input-field h-10 text-sm"
                placeholder="例如：今晚维护更新"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              行动提示
              <input
                value={form.action}
                onChange={(event) => onFormChange({ ...form, action: event.target.value })}
                maxLength={120}
                className="input-field h-10 text-sm"
                placeholder="例如：准备完成后，回来看看吧"
              />
            </label>
          </div>

          <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            摘要
            <textarea
              value={form.summary}
              onChange={(event) => onFormChange({ ...form, summary: event.target.value })}
              maxLength={280}
              className="input-field min-h-16 resize-y text-sm leading-5"
              placeholder="一句话说明维护影响"
            />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            详情
            <textarea
              value={form.detail}
              onChange={(event) => onFormChange({ ...form, detail: event.target.value })}
              maxLength={4000}
              className="input-field min-h-20 resize-y text-sm leading-5"
              placeholder="补充维护内容、预计恢复方式或临时限制说明"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              开始时间
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(event) => onFormChange({ ...form, startsAt: event.target.value })}
                className="input-field h-10 text-sm"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              预计结束
              <input
                type="datetime-local"
                value={form.estimatedEndsAt}
                onChange={(event) => onFormChange({ ...form, estimatedEndsAt: event.target.value })}
                className="input-field h-10 text-sm"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              限制开始
              <input
                type="datetime-local"
                value={form.restrictsNewGamesAt}
                onChange={(event) =>
                  onFormChange({ ...form, restrictsNewGamesAt: event.target.value })
                }
                className="input-field h-10 text-sm"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              影响范围
              <input
                value={form.impactScopes}
                onChange={(event) => onFormChange({ ...form, impactScopes: event.target.value })}
                className="input-field h-10 text-sm"
                placeholder="正式联机、对墙打、卡组同步"
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              限制说明
              <input
                value={form.restrictions}
                onChange={(event) => onFormChange({ ...form, restrictions: event.target.value })}
                className="input-field h-10 text-sm"
                placeholder="限制新对局、限制加入房间"
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}

function AnnouncementEditor({
  form,
  editingAnnouncement,
  isSaving,
  onFormChange,
  onCancelEdit,
  onSave,
}: {
  form: AnnouncementFormState;
  editingAnnouncement: AdminSiteAnnouncement | null;
  isSaving: boolean;
  onFormChange: (nextForm: AnnouncementFormState) => void;
  onCancelEdit: () => void;
  onSave: (publish: boolean) => void;
}) {
  return (
    <form
      className="h-fit rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 xl:sticky xl:top-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(false);
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-bold text-[var(--text-primary)]">
            {editingAnnouncement ? '编辑公告' : '新建公告'}
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
            {editingAnnouncement
              ? `${ANNOUNCEMENT_TYPE_LABELS[editingAnnouncement.type]} · ${
                  editingAnnouncement.status === 'PUBLISHED' ? '已发布' : '草稿'
                }`
              : '保存草稿后可单独发布'}
          </div>
        </div>
        {editingAnnouncement ? (
          <button type="button" onClick={onCancelEdit} className="button-ghost h-8 px-2 text-xs">
            取消编辑
          </button>
        ) : null}
      </div>

      <div className="grid gap-3">
        <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
          类型
          <select
            value={form.type}
            onChange={(event) =>
              onFormChange({
                ...form,
                type: event.target.value as SiteAnnouncementType,
              })
            }
            className="input-field h-10 text-sm"
          >
            {ANNOUNCEMENT_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {ANNOUNCEMENT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
          标题
          <input
            value={form.title}
            onChange={(event) => onFormChange({ ...form, title: event.target.value })}
            maxLength={120}
            className="input-field h-10 text-sm"
            placeholder="例如：今晚 19:00 维护"
          />
        </label>

        <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
          摘要
          <textarea
            value={form.summary}
            onChange={(event) => onFormChange({ ...form, summary: event.target.value })}
            maxLength={280}
            className="input-field min-h-20 resize-y text-sm leading-5"
            placeholder="一句话说明影响范围和用户需要知道的动作"
          />
        </label>

        <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
          详情
          <textarea
            value={form.detail}
            onChange={(event) => onFormChange({ ...form, detail: event.target.value })}
            maxLength={4000}
            className="input-field min-h-24 resize-y text-sm leading-5"
            placeholder="可选，补充维护内容、预计恢复方式或更新说明"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            开始时间
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) => onFormChange({ ...form, startsAt: event.target.value })}
              className="input-field h-10 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            结束时间
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) => onFormChange({ ...form, endsAt: event.target.value })}
              className="input-field h-10 text-sm"
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
          <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            优先级
            <input
              type="number"
              min={-100}
              max={100}
              value={form.priority}
              onChange={(event) => onFormChange({ ...form, priority: event.target.value })}
              className="input-field h-10 text-sm"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
            影响范围
            <input
              value={form.impactScopes}
              onChange={(event) => onFormChange({ ...form, impactScopes: event.target.value })}
              className="input-field h-10 text-sm"
              placeholder="正式联机、对墙打、历史回放"
            />
          </label>
        </div>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="submit"
            disabled={isSaving}
            className="button-secondary inline-flex h-10 items-center justify-center gap-1.5 px-3 text-sm"
          >
            <Save size={14} />
            {editingAnnouncement ? '保存修改' : '保存草稿'}
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => onSave(true)}
            className="button-primary inline-flex h-10 items-center justify-center gap-1.5 px-3 text-sm"
          >
            <Send size={14} />
            发布
          </button>
        </div>
      </div>
    </form>
  );
}

function AdminAnnouncementRow({
  announcement,
  selected,
  working,
  onEdit,
  onPublish,
  onDelete,
}: {
  announcement: AdminSiteAnnouncement;
  selected: boolean;
  working: boolean;
  onEdit: () => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const isPublished = announcement.status === 'PUBLISHED';
  const meta = buildAnnouncementMeta(announcement);

  return (
    <div
      className={`product-list-row px-3 py-3 transition ${
        selected
          ? 'bg-[color:var(--accent-primary)]/10'
          : 'bg-transparent hover:bg-[var(--bg-elevated)]'
      }`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                isPublished
                  ? 'border-[color:var(--semantic-success)]/35 bg-[color:var(--semantic-success)]/10 text-[var(--semantic-success)]'
                  : 'border-[color:var(--semantic-warning)]/35 bg-[color:var(--semantic-warning)]/10 text-[var(--semantic-warning)]'
              }`}
            >
              <Bell size={12} />
              {isPublished ? '已发布' : '草稿'}
            </span>
            <span className="rounded-md border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
              {ANNOUNCEMENT_TYPE_LABELS[announcement.type]}
            </span>
            <h4 className="min-w-0 text-sm font-bold text-[var(--text-primary)]">
              {announcement.title}
            </h4>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--text-secondary)]">
            {announcement.summary}
          </p>
          {meta.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
              {meta.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="button-ghost inline-flex h-8 items-center justify-center gap-1.5 px-2 text-xs"
          >
            <Pencil size={13} />
            编辑
          </button>
          {!isPublished ? (
            <button
              type="button"
              onClick={onPublish}
              disabled={working}
              className="button-primary inline-flex h-8 items-center justify-center gap-1.5 px-2 text-xs"
            >
              <Send size={13} />
              发布
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            disabled={working}
            className="button-ghost inline-flex h-8 items-center justify-center gap-1.5 border border-[color:var(--semantic-error)]/30 px-2 text-xs text-[var(--semantic-error)]"
          >
            <Trash2 size={13} />
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

function buildSiteStatusForm(siteStatus: PublicSiteStatus): SiteStatusFormState {
  const maintenance = siteStatus.maintenance;

  return {
    lifecycle: siteStatus.lifecycle,
    title: maintenance?.title ?? '',
    summary: maintenance?.summary ?? '',
    detail: maintenance?.detail ?? '',
    startsAt: toDateTimeLocalInputValue(maintenance?.startsAt ?? null),
    estimatedEndsAt: toDateTimeLocalInputValue(maintenance?.estimatedEndsAt ?? null),
    restrictsNewGamesAt: toDateTimeLocalInputValue(maintenance?.restrictsNewGamesAt ?? null),
    impactScopes: maintenance?.impactScopes.join('、') ?? '',
    restrictions: maintenance?.restrictions.join('、') ?? '',
    action: maintenance?.action ?? '',
  };
}

function buildSiteStatusConfigInput(form: SiteStatusFormState): SiteStatusConfigInput {
  return {
    lifecycle: form.lifecycle,
    title: form.title.trim() || null,
    summary: form.summary.trim() || null,
    detail: form.detail.trim() || null,
    startsAt: dateTimeLocalInputToIso(form.startsAt),
    estimatedEndsAt: dateTimeLocalInputToIso(form.estimatedEndsAt),
    restrictsNewGamesAt: dateTimeLocalInputToIso(form.restrictsNewGamesAt),
    impactScopes: splitAdminCsv(form.impactScopes),
    restrictions: splitAdminCsv(form.restrictions),
    action: form.action.trim() || null,
  };
}

function buildAnnouncementInput(
  form: AnnouncementFormState,
  publish: boolean
): SiteAnnouncementInput {
  return {
    type: form.type,
    title: form.title.trim(),
    summary: form.summary.trim(),
    detail: form.detail.trim() || null,
    startsAt: dateTimeLocalInputToIso(form.startsAt),
    endsAt: dateTimeLocalInputToIso(form.endsAt),
    priority: Number.isFinite(Number(form.priority)) ? Math.trunc(Number(form.priority)) : 0,
    impactScopes: splitAdminCsv(form.impactScopes),
    publish,
  };
}

function splitAdminCsv(value: string): readonly string[] {
  return value
    .split(/[、,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function toDateTimeLocalInputValue(value: string | null): string {
  if (!value) {
    return '';
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function dateTimeLocalInputToIso(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function buildAnnouncementMeta(announcement: AdminSiteAnnouncement): readonly string[] {
  return [
    announcement.publishedAt ? `发布 ${formatSiteStatusDateTime(announcement.publishedAt)}` : null,
    announcement.startsAt ? `开始 ${formatSiteStatusDateTime(announcement.startsAt)}` : null,
    announcement.endsAt ? `结束 ${formatSiteStatusDateTime(announcement.endsAt)}` : null,
    announcement.impactScopes.length > 0 ? `影响 ${announcement.impactScopes.join('、')}` : null,
    `更新 ${formatSiteStatusDateTime(announcement.updatedAt)}`,
  ].filter((item): item is string => item !== null);
}

function formatSiteStatusDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatSnapshotStatus(snapshot: PublicSnapshotInspection): string {
  if (snapshot.status === 'SYNCED') {
    return snapshot.availability === 'MAINTENANCE' ? '已同步（维护）' : '已同步（开放）';
  }
  if (snapshot.status === 'FAILED') return '同步失败';
  return '无法核验';
}
