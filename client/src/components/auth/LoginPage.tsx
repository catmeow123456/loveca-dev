/**
 * 登录页面组件
 * 橙色轻亮色调主题
 */

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, LogIn, Mail, WifiOff } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { AuthLayout } from './AuthLayout';
import { isApiConfigured, isEmailEnabled } from '@/lib/apiClient';

interface LoginPageProps {
  onSwitchToRegister: () => void;
  onSwitchToForgotPassword: () => void;
}

export function LoginPage({ onSwitchToRegister, onSwitchToForgotPassword }: LoginPageProps) {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const { signIn, enterOfflineMode, resendVerificationEmail, isLoading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    setShowResendVerification(false);
    setResendSuccess(false);
    clearError();

    if (!usernameOrEmail.trim()) {
      setLocalError('请输入用户名或邮箱');
      return;
    }

    if (!password) {
      setLocalError('请输入密码');
      return;
    }

    const result = await signIn(usernameOrEmail, password);

    // 检测邮箱未验证错误（服务端返回的消息为 '请先验证邮箱'，错误码为 EMAIL_NOT_VERIFIED）
    if (!result.success && (result.error?.includes('验证邮箱') || result.error?.includes('EMAIL_NOT_VERIFIED') || result.error?.includes('Email not confirmed'))) {
      setLocalError('邮箱尚未验证，请查收验证邮件后再登录');
      setShowResendVerification(true);
    }
  };

  const handleResendVerification = async () => {
    if (resendCooldown > 0 || resendLoading) return;

    // 需要邮箱地址来重新发送验证邮件
    const email = usernameOrEmail.includes('@') ? usernameOrEmail.trim() : '';
    if (!email) {
      setResendError('请使用邮箱地址登录，以便重新发送验证邮件');
      return;
    }

    setResendLoading(true);
    setResendError(null);

    const result = await resendVerificationEmail(email);
    setResendLoading(false);

    if (result.success) {
      setResendSuccess(true);
      // 60秒冷却
      setResendCooldown(60);
      cooldownRef.current = setInterval(() => {
        setResendCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(cooldownRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setResendError(result.error || '发送失败，请稍后重试');
    }
  };

  const handleOfflineMode = () => {
    const username = usernameOrEmail.trim() || 'Guest';
    enterOfflineMode(username);
  };

  const displayError = localError || error;

  return (
    <AuthLayout title="欢迎回来" subtitle="登录你的 Loveca 账号">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            用户名或邮箱
          </label>
          <input
            type="text"
            value={usernameOrEmail}
            onChange={(e) => setUsernameOrEmail(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="输入你的用户名或邮箱"
            autoComplete="username"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            密码
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="输入你的密码"
            autoComplete="current-password"
          />
          {isApiConfigured && isEmailEnabled && (
            <div className="text-right mt-1.5">
              <button
                type="button"
                onClick={onSwitchToForgotPassword}
                className="button-ghost px-2 py-1 text-sm"
              >
                忘记密码？
              </button>
            </div>
          )}
        </div>

        {displayError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-3 text-sm text-[var(--semantic-error)]"
          >
            {displayError}
          </motion.div>
        )}

        {showResendVerification && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,transparent)] p-3 text-sm text-[var(--semantic-warning)]"
          >
            {resendSuccess ? (
              <p className="flex items-center gap-2"><Mail size={14} />验证邮件已重新发送，请查收邮箱。</p>
            ) : (
              <>
                <p>未收到验证邮件？</p>
                {resendError && (
                  <p className="text-red-600">{resendError}</p>
                )}
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={resendLoading || resendCooldown > 0}
                  className={`font-medium transition-colors ${
                    resendLoading || resendCooldown > 0 ? 'cursor-not-allowed opacity-50' : 'text-[var(--accent-primary)] hover:text-[var(--accent-primary-hover)]'
                  }`}
                >
                  {resendLoading
                    ? '发送中...'
                    : resendCooldown > 0
                      ? `重新发送 (${resendCooldown}s)`
                      : '重新发送验证邮件'}
                </button>
              </>
            )}
          </motion.div>
        )}

        {!isApiConfigured && (
          <div className="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,transparent)] p-3 text-sm text-[var(--semantic-warning)]">
            <WifiOff size={16} />
            服务器未配置，仅支持离线模式
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading || !isApiConfigured}
          className={`button-primary flex w-full items-center justify-center gap-2 py-3 font-bold ${isLoading || !isApiConfigured ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              登录中...
            </span>
          ) : (
            <>
              <LogIn size={18} />
              登录
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleOfflineMode}
          className="button-secondary flex w-full items-center justify-center gap-2 py-3 font-medium"
        >
          <WifiOff size={18} />
          离线模式游玩
        </button>

        <div className="relative py-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--border-subtle)]" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-[var(--bg-surface)] px-4 text-sm text-[var(--text-muted)]">
              或者
            </span>
          </div>
        </div>

        <p className="text-center text-[var(--text-secondary)]">
          还没有账号？{' '}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="inline-flex items-center gap-1 font-medium text-[var(--accent-primary)] transition-colors hover:text-[var(--accent-primary-hover)]"
          >
            <ArrowRight size={14} />
            立即注册
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
