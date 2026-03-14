/**
 * 忘记密码页面组件
 * 用户输入邮箱后发送密码重置邮件
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
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
            className="text-6xl"
          >
            📧
          </motion.div>

          <p className="text-orange-700/80">
            我们已向 <span className="text-orange-600 font-medium">{email}</span> 发送了密码重置邮件，
            请点击邮件中的链接重置密码。
          </p>

          <p className="text-orange-500/60 text-sm">
            如果没有收到邮件，请检查垃圾邮件文件夹。
          </p>

          <button
            onClick={onSwitchToLogin}
            className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 shadow-lg shadow-orange-400/30 hover:shadow-orange-400/50 transition-all duration-300"
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
          <label className="block text-orange-700 text-sm font-medium mb-2">
            邮箱地址
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="输入注册时使用的邮箱"
            autoComplete="email"
          />
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

        {/* 发送按钮 */}
        <button
          type="submit"
          disabled={isLoading}
          className={`w-full py-3 rounded-xl font-bold text-white transition-all duration-300 ${
            isLoading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 shadow-lg shadow-orange-400/30 hover:shadow-orange-400/50 hover:scale-[1.02]'
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              发送中...
            </span>
          ) : (
            '发送重置邮件'
          )}
        </button>

        {/* 返回登录链接 */}
        <p className="text-center text-orange-600/70">
          想起密码了？{' '}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-orange-600 hover:text-orange-500 font-medium transition-colors"
          >
            返回登录
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
