/**
 * 重置密码页面组件
 * 用户通过邮件链接进入，输入新密码完成重置
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, KeyRound } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { AuthLayout } from './AuthLayout';

interface ResetPasswordPageProps {
  onSwitchToLogin: () => void;
}

export function ResetPasswordPage({ onSwitchToLogin }: ResetPasswordPageProps) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { updatePassword, isLoading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!newPassword) {
      setLocalError('请输入新密码');
      return;
    }

    if (newPassword.length < 6) {
      setLocalError('密码至少需要 6 个字符');
      return;
    }

    if (newPassword !== confirmPassword) {
      setLocalError('两次输入的密码不一致');
      return;
    }

    const result = await updatePassword(newPassword);
    if (result.success) {
      setSuccess(true);
    }
  };

  const displayError = localError || error;

  if (success) {
    return (
      <AuthLayout title="密码已重置" subtitle="你可以使用新密码登录了">
        <div className="text-center space-y-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="flex justify-center text-[var(--semantic-success)]"
          >
            <CheckCircle2 size={56} />
          </motion.div>

          <p className="text-[var(--text-secondary)]">
            你的密码已成功重置，请使用新密码登录。
          </p>

          <button
            onClick={onSwitchToLogin}
            className="button-primary w-full py-3 font-bold"
          >
            前往登录
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="重置密码" subtitle="请输入你的新密码">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 新密码输入 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            新密码
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="至少 6 个字符"
            autoComplete="new-password"
          />
        </div>

        {/* 确认密码输入 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            确认新密码
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="再次输入新密码"
            autoComplete="new-password"
          />
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

        <button
          type="submit"
          disabled={isLoading}
          className={`button-primary flex w-full items-center justify-center gap-2 py-3 font-bold ${isLoading ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              重置中...
            </span>
          ) : (
            <>
              <KeyRound size={18} />
              确认重置密码
            </>
          )}
        </button>

        <p className="text-center text-[var(--text-secondary)]">
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="inline-flex items-center gap-1 font-medium text-[var(--accent-primary)] transition-colors hover:text-[var(--accent-primary-hover)]"
          >
            <ArrowLeft size={14} />
            返回登录
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
