/**
 * 重置密码页面组件
 * 用户通过邮件链接进入，输入新密码完成重置
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
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
            className="text-6xl"
          >
            🔐
          </motion.div>

          <p className="text-orange-700/80">
            你的密码已成功重置，请使用新密码登录。
          </p>

          <button
            onClick={onSwitchToLogin}
            className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 shadow-lg shadow-orange-400/30 hover:shadow-orange-400/50 transition-all duration-300"
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
          <label className="block text-orange-700 text-sm font-medium mb-2">
            新密码
          </label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="至少 6 个字符"
            autoComplete="new-password"
          />
        </div>

        {/* 确认密码输入 */}
        <div>
          <label className="block text-orange-700 text-sm font-medium mb-2">
            确认新密码
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="再次输入新密码"
            autoComplete="new-password"
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

        {/* 重置按钮 */}
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
              重置中...
            </span>
          ) : (
            '确认重置密码'
          )}
        </button>

        {/* 返回登录链接 */}
        <p className="text-center text-orange-600/70">
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
