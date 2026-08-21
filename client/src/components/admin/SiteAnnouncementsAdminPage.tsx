import { useCallback, useEffect, useState } from 'react';
import {
  Bell,
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
  fetchAdminSiteStatus,
  publishAdminSiteAnnouncement,
  updateAdminSiteStatusConfig,
  updateAdminSiteAnnouncement,
  type AdminSiteAnnouncement,
  type AdminSiteStatusView,
  type PublicSnapshotInspection,
  type SiteAnnouncementInput,
  type SiteStatusConfigInput,
} from '@/lib/siteAnnouncementClient';
import { useKeyedState } from '@/hooks/useKeyedState';

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
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAnnouncements]);

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
