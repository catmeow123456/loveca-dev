/**
 * 注册页面组件
 * 橙色轻亮色调主题
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, UserPlus, WifiOff } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { AuthLayout } from './AuthLayout';
import { isApiConfigured, isEmailEnabled } from '@/lib/apiClient';

interface RegisterPageProps {
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onSwitchToLogin }: RegisterPageProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  
  const { signUp, isLoading, error, clearError } = useAuthStore();

  const validateForm = (): boolean => {
    setLocalError(null);
    clearError();
    
    if (!username.trim()) {
      setLocalError('请输入用户名');
      return false;
    }
    
    if (username.length < 3) {
      setLocalError('用户名至少需要 3 个字符');
      return false;
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      setLocalError('用户名只能包含字母、数字和下划线');
      return false;
    }
    
    if (email.trim()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setLocalError('请输入有效的邮箱地址');
        return false;
      }
    } else if (isEmailEnabled) {
      setLocalError('请输入邮箱');
      return false;
    }
    
    if (!password) {
      setLocalError('请输入密码');
      return false;
    }
    
    if (password.length < 6) {
      setLocalError('密码至少需要 6 个字符');
      return false;
    }
    
    if (password !== confirmPassword) {
      setLocalError('两次输入的密码不一致');
      return false;
    }
    
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;
    
    const result = await signUp(
      username.trim(),
      email.trim(),
      password,
      displayName.trim() || username.trim()
    );
    
    if (result.success) {
      setSuccess(true);
    }
  };

  const displayError = localError || error;

  if (success) {
    return (
      <AuthLayout
        title="注册成功！"
        subtitle={isEmailEnabled ? '请查收验证邮件' : '欢迎加入 Loveca'}
      >
        <div className="text-center space-y-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="flex justify-center text-[var(--semantic-success)]"
          >
            <CheckCircle2 size={56} />
          </motion.div>

          {isEmailEnabled ? (
            <p className="text-[var(--text-secondary)]">
              我们已向 <span className="font-medium text-[var(--accent-primary)]">{email}</span> 发送了验证邮件，
              请点击邮件中的链接完成注册。
            </p>
          ) : (
            <p className="text-[var(--text-secondary)]">
              账号已创建成功，现在可以直接登录了。
            </p>
          )}

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
    <AuthLayout title="创建账号" subtitle="加入 Loveca 卡牌游戏">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 用户名输入 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            用户名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="字母、数字、下划线"
            autoComplete="username"
          />
        </div>

        {/* 显示名称输入 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            显示昵称 <span className="text-[var(--text-muted)]">(可选)</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="游戏中显示的名称"
          />
        </div>

        {/* 邮箱输入 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            邮箱 {isEmailEnabled ? <span className="text-red-500">*</span> : <span className="text-[var(--text-muted)]">(可选)</span>}
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="your@email.com"
            autoComplete="email"
          />
        </div>

        {/* 密码输入 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            密码 <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="至少 6 个字符"
            autoComplete="new-password"
          />
        </div>

        {/* 确认密码输入 */}
        <div>
          <label className="mb-2 block text-sm font-medium text-[var(--text-primary)]">
            确认密码 <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="input-field px-4 py-3"
            placeholder="再次输入密码"
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

        {!isApiConfigured && (
          <div className="flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,transparent)] p-3 text-sm text-[var(--semantic-warning)]">
            <WifiOff size={16} />
            服务器未配置，无法注册。请使用离线模式游玩。
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
              注册中...
            </span>
          ) : (
            <>
              <UserPlus size={18} />
              创建账号
            </>
          )}
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
          已有账号？{' '}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="inline-flex items-center gap-1 font-medium text-[var(--accent-primary)] transition-colors hover:text-[var(--accent-primary-hover)]"
          >
            <ArrowRight size={14} />
            立即登录
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
