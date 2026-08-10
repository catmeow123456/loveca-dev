import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AtSign,
  BadgeCheck,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  Save,
  Send,
  UserRound,
} from 'lucide-react';
import {
  ActionButton,
  PageHeader,
  Panel,
  SectionHeading,
  StatusBadge,
  TextInput,
} from '@/components/common';
import { BadgeShelf } from '@/components/player-badges/BadgeShelf';
import { fetchMyPlayerBadges } from '@/lib/playerBadgeClient';
import { useAuthStore } from '@/store/authStore';
import type { PlayerBadgeView } from '@game/online/player-badge-types';

interface AccountCenterPageProps {
  emailChangeEnabled: boolean;
  onBack: () => void;
}

type Feedback = { tone: 'success' | 'error'; message: string } | null;

export function AccountCenterPage({ emailChangeEnabled, onBack }: AccountCenterPageProps) {
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const isLoading = useAuthStore((state) => state.isLoading);
  const updateProfile = useAuthStore((state) => state.updateProfile);
  const requestEmailChange = useAuthStore((state) => state.requestEmailChange);
  const updatePassword = useAuthStore((state) => state.updatePassword);

  const [username, setUsername] = useState(profile?.username ?? '');
  const [displayName, setDisplayName] = useState(profile?.display_name ?? profile?.username ?? '');
  const [profileFeedback, setProfileFeedback] = useState<Feedback>(null);

  const [newEmail, setNewEmail] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailFeedback, setEmailFeedback] = useState<Feedback>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [badges, setBadges] = useState<PlayerBadgeView[]>([]);
  const [badgesLoading, setBadgesLoading] = useState(true);
  const [badgesError, setBadgesError] = useState<string | null>(null);
  const [badgeRequestVersion, setBadgeRequestVersion] = useState(0);
  const authenticatedUserId = user?.id;

  useEffect(() => {
    if (!authenticatedUserId) {
      return;
    }

    let cancelled = false;

    void fetchMyPlayerBadges()
      .then((nextBadges) => {
        if (!cancelled) {
          setBadges(nextBadges);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBadgesError(error instanceof Error ? error.message : '读取徽章失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBadgesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authenticatedUserId, badgeRequestVersion]);

  const retryBadges = () => {
    setBadgesLoading(true);
    setBadgesError(null);
    setBadgeRequestVersion((version) => version + 1);
  };

  const initials = useMemo(() => {
    const source = (profile?.display_name || profile?.username || 'L').trim();
    return Array.from(source).slice(0, 2).join('').toUpperCase();
  }, [profile?.display_name, profile?.username]);

  if (!user || !profile) {
    return null;
  }

  const submitProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileFeedback(null);

    const normalizedUsername = username.trim();
    const normalizedDisplayName = displayName.trim();
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(normalizedUsername)) {
      setProfileFeedback({
        tone: 'error',
        message: '用户名需为 3–30 位字母、数字或下划线。',
      });
      return;
    }
    if (!normalizedDisplayName || normalizedDisplayName.length > 50) {
      setProfileFeedback({ tone: 'error', message: '显示名称需为 1–50 个字符。' });
      return;
    }
    if (
      normalizedUsername === profile.username &&
      normalizedDisplayName === (profile.display_name ?? profile.username)
    ) {
      setProfileFeedback({ tone: 'success', message: '资料没有变化。' });
      return;
    }

    const result = await updateProfile({
      username: normalizedUsername,
      display_name: normalizedDisplayName,
    });
    setProfileFeedback(
      result.success
        ? { tone: 'success', message: '个人资料已保存。' }
        : { tone: 'error', message: result.error ?? '保存个人资料失败。' }
    );
  };

  const submitEmailChange = async (event: FormEvent) => {
    event.preventDefault();
    setEmailFeedback(null);
    const normalizedEmail = newEmail.trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setEmailFeedback({ tone: 'error', message: '请输入有效的新邮箱地址。' });
      return;
    }
    if (!emailPassword) {
      setEmailFeedback({ tone: 'error', message: '请输入当前密码确认身份。' });
      return;
    }

    const result = await requestEmailChange(normalizedEmail, emailPassword);
    if (result.success) {
      setEmailPassword('');
      setEmailFeedback({
        tone: 'success',
        message: `验证邮件已发送至 ${normalizedEmail}，确认前当前邮箱仍然有效。`,
      });
    } else {
      setEmailFeedback({ tone: 'error', message: result.error ?? '申请邮箱换绑失败。' });
    }
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordFeedback(null);

    if (!currentPassword) {
      setPasswordFeedback({ tone: 'error', message: '请输入当前密码。' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordFeedback({ tone: 'error', message: '新密码至少需要 6 个字符。' });
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordFeedback({ tone: 'error', message: '新密码不能与当前密码相同。' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ tone: 'error', message: '两次输入的新密码不一致。' });
      return;
    }

    const result = await updatePassword(newPassword, undefined, currentPassword);
    if (!result.success) {
      setPasswordFeedback({ tone: 'error', message: result.error ?? '修改密码失败。' });
    }
  };

  return (
    <div className="app-shell min-h-screen overflow-x-hidden">
      <PageHeader
        title="个人中心"
        icon={<UserRound size={19} />}
        onBack={onBack}
        backLabel="返回大厅"
      />

      <main className="product-page-main">
        <div className="mx-auto grid w-full max-w-5xl items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-5">
            <IdentityPass
              initials={initials}
              username={profile.username}
              displayName={profile.display_name ?? profile.username}
              email={user.email}
              emailVerified={user.emailVerified}
              deckCount={profile.deck_count}
            />
          </aside>

          <div className="grid gap-4">
            <BadgeShelf
              badges={badges}
              loading={badgesLoading}
              error={badgesError}
              onRetry={retryBadges}
            />

            <SettingsSection
              icon={<AtSign size={18} />}
              title="公开身份"
              description="用户名用于登录，显示名称用于对局。"
            >
              <form onSubmit={submitProfile} className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="用户名">
                    <TextInput
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      autoComplete="username"
                      maxLength={30}
                    />
                  </Field>
                  <Field label="显示名称">
                    <TextInput
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      autoComplete="nickname"
                      maxLength={50}
                    />
                  </Field>
                </div>
                <FormFooter feedback={profileFeedback}>
                  <SubmitButton
                    loading={isLoading}
                    idleLabel="保存资料"
                    loadingLabel="保存中"
                    icon={<Save size={16} />}
                  />
                </FormFooter>
              </form>
            </SettingsSection>

            <SettingsSection icon={<Mail size={18} />} title="登录邮箱">
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">
                  {user.email}
                </span>
                <StatusBadge tone={user.emailVerified ? 'success' : 'warning'}>
                  {user.emailVerified ? <BadgeCheck size={14} /> : <Mail size={14} />}
                  {user.emailVerified ? '已验证' : '未验证'}
                </StatusBadge>
              </div>

              {emailChangeEnabled ? (
                <form onSubmit={submitEmailChange} className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="新邮箱">
                      <TextInput
                        type="email"
                        value={newEmail}
                        onChange={(event) => setNewEmail(event.target.value)}
                        placeholder="name@example.com"
                        autoComplete="email"
                        maxLength={254}
                      />
                    </Field>
                    <Field label="当前密码">
                      <TextInput
                        type="password"
                        value={emailPassword}
                        onChange={(event) => setEmailPassword(event.target.value)}
                        autoComplete="current-password"
                        maxLength={128}
                      />
                    </Field>
                  </div>
                  <FormFooter feedback={emailFeedback}>
                    <SubmitButton
                      loading={isLoading}
                      idleLabel="发送验证邮件"
                      loadingLabel="发送中"
                      icon={<Send size={16} />}
                    />
                  </FormFooter>
                </form>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">邮件服务未开启，暂不可换绑。</p>
              )}
            </SettingsSection>

            <SettingsSection icon={<LockKeyhole size={18} />} title="修改密码">
              <form onSubmit={submitPassword} className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="当前密码">
                    <TextInput
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      autoComplete="current-password"
                      maxLength={128}
                    />
                  </Field>
                  <Field label="新密码">
                    <TextInput
                      type="password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder="至少 6 个字符"
                      maxLength={128}
                    />
                  </Field>
                  <Field label="确认新密码">
                    <TextInput
                      type="password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      maxLength={128}
                    />
                  </Field>
                </div>
                <FormFooter feedback={passwordFeedback}>
                  <SubmitButton
                    loading={isLoading}
                    idleLabel="修改密码"
                    loadingLabel="修改中"
                    icon={<KeyRound size={16} />}
                  />
                </FormFooter>
              </form>
            </SettingsSection>
          </div>
        </div>
      </main>
    </div>
  );
}

function IdentityPass({
  initials,
  username,
  displayName,
  email,
  emailVerified,
  deckCount,
}: {
  initials: string;
  username: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  deckCount: number;
}) {
  return (
    <Panel as="section">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-stage-plum)] text-lg font-bold text-[var(--brand-card-white)]">
          {initials}
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-[var(--text-primary)]">
            {displayName}
          </h2>
          <p className="truncate text-xs text-[var(--text-secondary)]">@{username}</p>
        </div>
      </div>

      <div className="my-4 border-t border-[var(--border-subtle)]" />

      <dl className="grid gap-2.5 text-xs">
        <PassRow label="登录邮箱" value={email} />
        <PassRow label="邮箱状态" value={emailVerified ? '已验证' : '待验证'} />
        <PassRow label="云端卡组" value={`${deckCount} 副`} />
      </dl>
    </Panel>
  );
}

function PassRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <dt className="text-[var(--text-muted)]">{label}</dt>
      <dd className="truncate text-right font-semibold text-[var(--text-primary)]" title={value}>
        {value}
      </dd>
    </div>
  );
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Panel as="section" padding="none">
      <div className="flex items-start gap-2.5 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
        <span className="mt-0.5 shrink-0 text-[var(--accent-primary)]">{icon}</span>
        <SectionHeading className="min-w-0 flex-1" title={title} description={description} />
      </div>
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </Panel>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm font-semibold text-[var(--text-primary)]">
        {label}
        {hint ? (
          <span className="text-[11px] font-normal text-[var(--text-muted)]">{hint}</span>
        ) : null}
      </span>
      {children}
    </label>
  );
}

function FormFooter({ feedback, children }: { feedback: Feedback; children: ReactNode }) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-h-5 flex-1" aria-live="polite">
        {feedback ? (
          <p
            className={`flex items-start gap-1.5 text-xs leading-5 ${
              feedback.tone === 'success'
                ? 'text-[var(--semantic-success)]'
                : 'text-[var(--semantic-error)]'
            }`}
          >
            {feedback.tone === 'success' ? (
              <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            ) : (
              <LockKeyhole size={14} className="mt-0.5 shrink-0" />
            )}
            {feedback.message}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function SubmitButton({
  loading,
  idleLabel,
  loadingLabel,
  icon,
}: {
  loading: boolean;
  idleLabel: string;
  loadingLabel: string;
  icon: ReactNode;
}) {
  return (
    <ActionButton type="submit" disabled={loading} className="disabled:opacity-55">
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {loading ? loadingLabel : idleLabel}
    </ActionButton>
  );
}
