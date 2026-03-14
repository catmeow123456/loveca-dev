/**
 * 登录页面组件
 * 橙色轻亮色调主题
 */

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
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
        {/* 用户名/邮箱输入 */}
        <div>
          <label className="block text-orange-700 text-sm font-medium mb-2">
            用户名或邮箱
          </label>
          <input
            type="text"
            value={usernameOrEmail}
            onChange={(e) => setUsernameOrEmail(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="输入你的用户名或邮箱"
            autoComplete="username"
          />
        </div>

        {/* 密码输入 */}
        <div>
          <label className="block text-orange-700 text-sm font-medium mb-2">
            密码
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="输入你的密码"
            autoComplete="current-password"
          />
          {/* 忘记密码链接 */}
          {isApiConfigured && isEmailEnabled && (
            <div className="text-right mt-1.5">
              <button
                type="button"
                onClick={onSwitchToForgotPassword}
                className="text-orange-500/70 hover:text-orange-600 text-sm transition-colors"
              >
                忘记密码？
              </button>
            </div>
          )}
        </div>

        {/* 错误提示 */}
        {displayError && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-red-100 border border-red-300 rounded-lg text-red-600 text-sm"
          >
            {displayError}
          </motion.div>
        )}

        {/* 重新发送验证邮件 */}
        {showResendVerification && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-700 text-sm space-y-2"
          >
            {resendSuccess ? (
              <p>验证邮件已重新发送，请查收邮箱。</p>
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
                  className={`text-orange-600 font-medium transition-colors ${
                    resendLoading || resendCooldown > 0 ? 'opacity-50 cursor-not-allowed' : 'hover:text-orange-500'
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

        {/* API 未配置提示 */}
        {!isApiConfigured && (
          <div className="p-3 bg-amber-100 border border-amber-300 rounded-lg text-amber-700 text-sm">
            服务器未配置，仅支持离线模式
          </div>
        )}

        {/* 登录按钮 */}
        <button
          type="submit"
          disabled={isLoading || !isApiConfigured}
          className={`w-full py-3 rounded-xl font-bold text-white transition-all duration-300 ${
            isLoading || !isApiConfigured
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 shadow-lg shadow-orange-400/30 hover:shadow-orange-400/50 hover:scale-[1.02]'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              登录中...
            </span>
          ) : (
            '登录'
          )}
        </button>

        {/* 离线模式按钮 */}
        <button
          type="button"
          onClick={handleOfflineMode}
          className="w-full py-3 rounded-xl font-medium text-orange-700 bg-amber-100/80 border border-orange-300/50 hover:bg-amber-200/80 hover:border-orange-400/50 transition-all duration-300"
        >
          离线模式游玩
        </button>

        {/* 分隔线 */}
        <div className="relative py-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-orange-300/30" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-4 text-orange-500/60 text-sm bg-white/70">
              或者
            </span>
          </div>
        </div>

        {/* 注册链接 */}
        <p className="text-center text-orange-600/70">
          还没有账号？{' '}
          <button
            type="button"
            onClick={onSwitchToRegister}
            className="text-orange-600 hover:text-orange-500 font-medium transition-colors"
          >
            立即注册
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
