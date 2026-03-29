/**
 * 忘记密码页面组件
 * 用户输入邮箱后发送密码重置邮件
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { AuthLayout } from './AuthLayout';

interface ForgotPasswordPageProps {
  onSwitchToLogin: () => void;
}

export function ForgotPasswordPage({ onSwitchToLogin }: ForgotPasswordPageProps) {
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { resetPassword, isLoading, error, clearError } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!email.trim()) {
      setLocalError('请输入邮箱地址');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLocalError('请输入有效的邮箱地址');
      return;
    }

    const result = await resetPassword(email.trim());
    if (result.success) {
      setSuccess(true);
    }
  };

  const displayError = localError || error;

  if (success) {
    return (
      <AuthLayout title="邮件已发送" subtitle="请查收密码重置邮件">
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
            我们已向 <span className="font-medium text-[var(--accent-primary)]">{email}</span> 发送了密码重置邮件，
            请点击邮件中的链接重置密码。
          </p>

          <p className="text-sm text-[var(--text-muted)]">
            如果没有收到邮件，请检查垃圾邮件文件夹。
          </p>

          <button
            onClick={onSwitchToLogin}
            className="button-primary w-full py-3 font-bold"
          >
            返回登录
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="忘记密码" subtitle="输入邮箱地址重置密码">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 邮箱输入 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            邮箱地址
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="输入注册时使用的邮箱"
            autoComplete="email"
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
              发送中...
            </span>
          ) : (
            <>
              <Mail size={18} />
              发送重置邮件
            </>
          )}
        </button>

        <p className="text-center text-[var(--text-secondary)]">
          想起密码了？{' '}
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
