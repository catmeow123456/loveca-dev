import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  AtSign,
  Award,
  BadgeCheck,
  CheckCircle2,
  KeyRound,
  Loader2,
  LockKeyhole,
  Mail,
  Palette,
  Save,
  Send,
  ShieldCheck,
  UserRound,
  Volume2,
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
import { WallpaperSettings } from '@/components/player-wallpaper/WallpaperSettings';
import { fetchMyPlayerBadges } from '@/lib/playerBadgeClient';
import { useAuthStore } from '@/store/authStore';
import type { PlayerBadgeView } from '@game/online/player-badge-types';

interface AccountCenterPageProps {
  emailChangeEnabled: boolean;
  onBack: () => void;
}

type Feedback = { tone: 'success' | 'error'; message: string } | null;
type AccountSection = 'profile' | 'security' | 'sound' | 'appearance' | 'badges';

const ACCOUNT_SECTIONS: ReadonlyArray<{
  key: AccountSection;
  label: string;
  icon: ReactNode;
}> = [
  { key: 'profile', label: '个人资料', icon: <AtSign size={17} /> },
  { key: 'security', label: '账号与安全', icon: <ShieldCheck size={17} /> },
  { key: 'sound', label: '声音设置', icon: <Volume2 size={17} /> },
  { key: 'appearance', label: '游戏桌外观', icon: <Palette size={17} /> },
  { key: 'badges', label: '徽章展示', icon: <Award size={17} /> },
];

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
  const [waitingMusicEnabled, setWaitingMusicEnabled] = useState(
    profile?.matchmaking_bgm_enabled ?? true
  );
  const [matchFoundSoundEnabled, setMatchFoundSoundEnabled] = useState(
    profile?.matchmaking_match_sound_enabled ?? true
  );
  const [soundFeedback, setSoundFeedback] = useState<Feedback>(null);

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
  const [activeSection, setActiveSection] = useState<AccountSection>(readAccountSection);
  const authenticatedUserId = user?.id;

  useEffect(() => {
    setWaitingMusicEnabled(profile?.matchmaking_bgm_enabled ?? true);
    setMatchFoundSoundEnabled(profile?.matchmaking_match_sound_enabled ?? true);
  }, [profile?.matchmaking_bgm_enabled, profile?.matchmaking_match_sound_enabled]);

  useEffect(() => {
    const handlePopState = () => setActiveSection(readAccountSection());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

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

  const selectSection = (section: AccountSection) => {
    if (section === activeSection) return;

    window.history.pushState(null, '', accountSectionHref(section));
    setActiveSection(section);
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
              activeSection={activeSection}
              onSelectSection={selectSection}
            />
          </aside>

          <div id="account-settings-panel" className="grid min-w-0 gap-4">
            {activeSection === 'profile' ? (
              <SettingsSection icon={<AtSign size={18} />} title="个人资料">
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
            ) : null}

            {activeSection === 'security' ? (
              <>
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
                    <p className="text-xs text-[var(--text-muted)]">暂不可换绑。</p>
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
              </>
            ) : null}

            {activeSection === 'sound' ? (
              <SettingsSection icon={<Volume2 size={18} />} title="声音设置">
                <form
                  className="grid gap-4"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    setSoundFeedback(null);
                    const result = await updateProfile({
                      matchmaking_bgm_enabled: waitingMusicEnabled,
                      matchmaking_match_sound_enabled: matchFoundSoundEnabled,
                    });
                    setSoundFeedback(
                      result.success
                        ? { tone: 'success', message: '声音设置已保存。' }
                        : { tone: 'error', message: result.error ?? '保存声音设置失败。' }
                    );
                  }}
                >
                  <SoundToggle
                    label="候场时播放背景音乐"
                    checked={waitingMusicEnabled}
                    onChange={setWaitingMusicEnabled}
                  />
                  <SoundToggle
                    label="匹配成功时播放提示音"
                    checked={matchFoundSoundEnabled}
                    onChange={setMatchFoundSoundEnabled}
                  />
                  <FormFooter feedback={soundFeedback}>
                    <SubmitButton
                      loading={isLoading}
                      idleLabel="保存声音设置"
                      loadingLabel="保存中"
                      icon={<Save size={16} />}
                    />
                  </FormFooter>
                </form>
              </SettingsSection>
            ) : null}

            {activeSection === 'appearance' ? <WallpaperSettings /> : null}

            {activeSection === 'badges' ? (
              <BadgeShelf
                badges={badges}
                loading={badgesLoading}
                error={badgesError}
                onRetry={retryBadges}
              />
            ) : null}
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
  activeSection,
  onSelectSection,
}: {
  initials: string;
  username: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  deckCount: number;
  activeSection: AccountSection;
  onSelectSection: (section: AccountSection) => void;
}) {
  return (
    <Panel as="section" padding="none">
      <div className="p-4 sm:p-5 lg:p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--brand-stage-plum)] text-base font-bold text-[var(--brand-card-white)] lg:h-14 lg:w-14 lg:text-lg">
            {initials}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-[var(--text-primary)]">
              {displayName}
            </h2>
            <p className="truncate text-xs text-[var(--text-secondary)]">@{username}</p>
          </div>
        </div>

        <div className="my-4 hidden border-t border-[var(--border-subtle)] lg:block" />

        <dl className="hidden gap-2.5 text-xs lg:grid">
          <PassRow label="登录邮箱" value={email} />
          <PassRow label="邮箱状态" value={emailVerified ? '已验证' : '待验证'} />
          <PassRow label="云端卡组" value={`${deckCount} 副`} />
        </dl>
      </div>

      <nav
        className="grid grid-cols-2 gap-1 border-t border-[var(--border-subtle)] p-2 lg:grid-cols-1"
        aria-label="个人中心设置"
      >
        {ACCOUNT_SECTIONS.map((section) => {
          const isActive = section.key === activeSection;
          return (
            <a
              key={section.key}
              href={accountSectionHref(section.key)}
              aria-current={isActive ? 'page' : undefined}
              aria-controls="account-settings-panel"
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                onSelectSection(section.key);
              }}
              className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-surface)] ${
                isActive
                  ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_32%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--accent-primary)_11%,var(--bg-surface))] text-[var(--accent-primary)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span className="shrink-0" aria-hidden="true">
                {section.icon}
              </span>
              <span>{section.label}</span>
            </a>
          );
        })}
      </nav>
    </Panel>
  );
}

function readAccountSection(): AccountSection {
  const section = new URLSearchParams(window.location.search).get('section');
  return section === 'security' ||
    section === 'sound' ||
    section === 'appearance' ||
    section === 'badges'
    ? section
    : 'profile';
}

function SoundToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-3">
      <span className="text-sm font-semibold text-[var(--text-primary)]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--accent-primary)]"
      />
    </label>
  );
}

function accountSectionHref(section: AccountSection): string {
  const url = new URL(window.location.href);
  url.searchParams.set('page', 'account');
  if (section === 'profile') {
    url.searchParams.delete('section');
  } else {
    url.searchParams.set('section', section);
  }
  return `${url.pathname}${url.search}${url.hash}`;
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
