import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { BadgeCheck, ChevronLeft, ChevronRight, Loader2, Search, UserCog } from 'lucide-react';
import type { UserRole } from '@game/shared/auth/permissions';
import { PageHeader, SelectMenu, type SelectMenuOption } from '@/components/common';
import { changeAdminUserRole, listAdminUsers, type AdminUserSummary } from '@/lib/adminUserClient';
import { notifyAuthorizationStale } from '@/lib/apiClient';
import { useAuthStore } from '@/store/authStore';

const PAGE_SIZE = 50;

const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  user: '普通玩家',
  season_admin: '赛季管理员',
  admin: '平台管理员',
};

const ROLE_OPTIONS: readonly SelectMenuOption<UserRole>[] = [
  { value: 'user', label: ROLE_LABELS.user, leading: <RoleDot role="user" /> },
  {
    value: 'season_admin',
    label: ROLE_LABELS.season_admin,
    leading: <RoleDot role="season_admin" />,
  },
  { value: 'admin', label: ROLE_LABELS.admin, leading: <RoleDot role="admin" /> },
];

const ROLE_FILTER_OPTIONS: readonly SelectMenuOption<UserRole | ''>[] = [
  { value: '', label: '全部角色' },
  ...ROLE_OPTIONS,
];

export function UserAdminPage({ onBack }: { readonly onBack: () => void }) {
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);
  const [users, setUsers] = useState<readonly AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingRoleUserId, setSavingRoleUserId] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void listAdminUsers({
      query: query || undefined,
      role: role || undefined,
      limit: PAGE_SIZE,
      offset,
    })
      .then((page) => {
        if (cancelled) return;
        setUsers(page.users);
        setTotal(page.total);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : '读取用户列表失败');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [offset, query, reloadKey, role]);

  const prepareReload = () => {
    setIsLoading(true);
    setLoadError(null);
  };

  const reloadUsers = () => {
    prepareReload();
    setReloadKey((current) => current + 1);
  };

  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const resultSummary = useMemo(() => {
    if (isLoading) return '正在读取账号';
    if (total === 0) return '没有符合条件的账号';
    const start = offset + 1;
    const end = Math.min(offset + users.length, total);
    return `显示 ${start}–${end}，共 ${total} 个账号`;
  }, [isLoading, offset, total, users.length]);

  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    prepareReload();
    setOffset(0);
    setQuery(queryInput.trim());
    setReloadKey((current) => current + 1);
    setSaveMessage(null);
    setSaveError(null);
  };

  const saveRoleChange = async (user: AdminUserSummary, nextRole: UserRole) => {
    if (nextRole === user.role) return;
    setSavingRoleUserId(user.id);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const result = await changeAdminUserRole({
        userId: user.id,
        role: nextRole,
        expectedRole: user.role,
      });
      setUsers((current) =>
        current.map((user) => (user.id === result.user.id ? result.user : user))
      );
      setSaveMessage(result.changed ? '角色已更新，目标账号的旧会话已失效' : '角色没有变化');

      if (result.changed && result.user.id === currentUserId) {
        notifyAuthorizationStale();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '修改用户角色失败');
    } finally {
      setSavingRoleUserId(null);
    }
  };

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title="用户管理"
        description="检索账号并委派平台角色"
        icon={<UserCog size={18} />}
        onBack={onBack}
        backLabel="返回管理中心"
      />

      <main className="product-page-main">
        <div className="mx-auto flex max-w-6xl flex-col gap-5">
          <section
            className="product-workbench overflow-hidden"
            aria-labelledby="user-search-title"
          >
            <header className="border-b border-[var(--border-subtle)] px-4 py-4 sm:px-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] text-[var(--accent-primary)]">
                  <Search size={17} />
                </span>
                <div>
                  <h2
                    id="user-search-title"
                    className="text-sm font-semibold text-[var(--text-primary)]"
                  >
                    查找账号
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                    搜索用户名、显示名称或邮箱；结果由服务端分页返回。
                  </p>
                </div>
              </div>
            </header>

            <form
              onSubmit={applyFilters}
              className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:px-5"
            >
              <label className="grid gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                账号信息
                <input
                  value={queryInput}
                  onChange={(event) => setQueryInput(event.target.value)}
                  className="input-field h-10 text-sm font-normal"
                  placeholder="用户名、显示名称或邮箱"
                  maxLength={100}
                />
              </label>
              <div className="grid gap-1.5 text-xs font-semibold text-[var(--text-secondary)]">
                <span>当前角色</span>
                <SelectMenu
                  label="筛选当前角色"
                  value={role}
                  options={ROLE_FILTER_OPTIONS}
                  onChange={(nextRole) => {
                    prepareReload();
                    setRole(nextRole);
                    setOffset(0);
                  }}
                  className="w-full font-normal"
                />
              </div>
              <button
                type="submit"
                className="button-primary mt-auto inline-flex h-10 items-center justify-center gap-2 px-4 text-sm font-semibold"
              >
                <Search size={15} />
                查询
              </button>
            </form>
          </section>

          <section
            className="product-workbench overflow-hidden"
            aria-labelledby="user-results-title"
          >
            <header className="flex items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
              <div>
                <h2
                  id="user-results-title"
                  className="text-sm font-semibold text-[var(--text-primary)]"
                >
                  账号列表
                </h2>
                <p
                  role="status"
                  className={`mt-0.5 text-xs ${
                    saveError
                      ? 'text-[var(--semantic-error)]'
                      : saveMessage
                        ? 'text-[var(--semantic-success)]'
                        : 'text-[var(--text-muted)]'
                  }`}
                >
                  {saveError ?? saveMessage ?? resultSummary}
                </p>
              </div>
              <button
                type="button"
                onClick={reloadUsers}
                disabled={isLoading}
                className="button-ghost inline-flex h-9 items-center gap-2 border border-[var(--border-default)] px-3 text-xs font-semibold disabled:opacity-45"
              >
                {isLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                刷新
              </button>
            </header>

            {loadError ? (
              <div className="px-4 py-8 text-center sm:px-5">
                <p className="text-sm text-[var(--semantic-error)]">{loadError}</p>
                <button
                  type="button"
                  onClick={reloadUsers}
                  className="button-ghost mt-3 border border-[var(--border-default)] px-3 py-2 text-sm"
                >
                  重新读取
                </button>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-[var(--text-muted)]">
                <Loader2 size={16} className="animate-spin" />
                正在读取账号
              </div>
            ) : users.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                没有符合当前条件的账号，请调整搜索条件。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] border-collapse text-left text-sm">
                  <thead className="bg-[var(--bg-elevated)] text-xs text-[var(--text-muted)]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">用户</th>
                      <th className="px-4 py-3 font-semibold">邮箱</th>
                      <th className="px-4 py-3 font-semibold">角色</th>
                      <th className="px-4 py-3 text-right font-semibold">卡组</th>
                      <th className="px-4 py-3 font-semibold">注册时间</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td className="px-5 py-3">
                          <div className="font-semibold text-[var(--text-primary)]">
                            {user.display_name || user.username}
                          </div>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            @{user.username} · {shortUserId(user.id)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)]">
                          <div className="flex items-center gap-1.5">
                            {user.email_verified ? (
                              <BadgeCheck
                                size={14}
                                aria-label="邮箱已验证"
                                className="text-[var(--semantic-success)]"
                              />
                            ) : null}
                            <span>{user.email}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <SelectMenu
                            label={`修改 ${user.display_name || user.username} 的角色`}
                            value={user.role}
                            options={ROLE_OPTIONS}
                            disabled={savingRoleUserId !== null}
                            loading={savingRoleUserId === user.id}
                            onChange={(nextRole) => void saveRoleChange(user, nextRole)}
                            className="h-9 min-w-40 text-xs font-semibold"
                            menuMinWidth={176}
                          />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--text-secondary)]">
                          {user.deck_count}
                        </td>
                        <td className="px-4 py-3 text-xs text-[var(--text-secondary)]">
                          {formatDateTime(user.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <footer className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] px-4 py-3 sm:px-5">
              <span className="text-xs tabular-nums text-[var(--text-muted)]">
                第 {pageNumber} / {pageCount} 页
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="上一页"
                  disabled={offset === 0 || isLoading}
                  onClick={() => {
                    prepareReload();
                    setOffset((current) => Math.max(0, current - PAGE_SIZE));
                  }}
                  className="button-ghost flex h-9 w-9 items-center justify-center border border-[var(--border-default)] disabled:opacity-40"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  aria-label="下一页"
                  disabled={offset + users.length >= total || isLoading}
                  onClick={() => {
                    prepareReload();
                    setOffset((current) => current + PAGE_SIZE);
                  }}
                  className="button-ghost flex h-9 w-9 items-center justify-center border border-[var(--border-default)] disabled:opacity-40"
                >
                  <ChevronRight size={15} />
                </button>
              </div>
            </footer>
          </section>
        </div>
      </main>
    </div>
  );
}

function RoleDot({ role }: { readonly role: UserRole }) {
  const className =
    role === 'admin'
      ? 'bg-[var(--semantic-error)]'
      : role === 'season_admin'
        ? 'bg-[var(--accent-primary)]'
        : 'bg-[var(--text-muted)]';
  return <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${className}`} />;
}

function shortUserId(userId: string): string {
  return userId.length > 12 ? `${userId.slice(0, 8)}…${userId.slice(-4)}` : userId;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
