/**
 * 注册页面组件
 * 橙色轻亮色调主题
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/store/authStore';
import { AuthLayout } from './AuthLayout';
import { isApiConfigured } from '@/lib/apiClient';

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
    
    if (!email.trim()) {
      setLocalError('请输入邮箱');
      return false;
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLocalError('请输入有效的邮箱地址');
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
      <AuthLayout title="注册成功！" subtitle="请查收验证邮件">
        <div className="text-center space-y-6">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="text-6xl"
          >
            🎉
          </motion.div>
          
          <p className="text-orange-700/80">
            我们已向 <span className="text-orange-600 font-medium">{email}</span> 发送了验证邮件，
            请点击邮件中的链接完成注册。
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
    <AuthLayout title="创建账号" subtitle="加入 Loveca 卡牌游戏">
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* 用户名输入 */}
        <div>
          <label className="block text-orange-700 text-sm font-medium mb-2">
            用户名 <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="字母、数字、下划线"
            autoComplete="username"
          />
        </div>

        {/* 显示名称输入 */}
        <div>
          <label className="block text-orange-700 text-sm font-medium mb-2">
            显示昵称 <span className="text-orange-400/60">(可选)</span>
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="游戏中显示的名称"
          />
        </div>

        {/* 邮箱输入 */}
        <div>
          <label className="block text-orange-700 text-sm font-medium mb-2">
            邮箱 <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="your@email.com"
            autoComplete="email"
          />
        </div>

        {/* 密码输入 */}
        <div>
          <label className="block text-orange-700 text-sm font-medium mb-2">
            密码 <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="至少 6 个字符"
            autoComplete="new-password"
          />
        </div>

        {/* 确认密码输入 */}
        <div>
          <label className="block text-orange-700 text-sm font-medium mb-2">
            确认密码 <span className="text-red-500">*</span>
          </label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full px-4 py-3 bg-white/80 border border-orange-300/50 rounded-xl text-gray-800 placeholder-orange-400/50 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-400/20 transition-all"
            placeholder="再次输入密码"
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
            ⚠️ {displayError}
          </motion.div>
        )}

        {/* API 未配置提示 */}
        {!isApiConfigured && (
          <div className="p-3 bg-amber-100 border border-amber-300 rounded-lg text-amber-700 text-sm">
            ⚡ 服务器未配置，无法注册。请使用离线模式游玩。
          </div>
        )}

        {/* 注册按钮 */}
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
              注册中...
            </span>
          ) : (
            '✨ 创建账号'
          )}
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

        {/* 登录链接 */}
        <p className="text-center text-orange-600/70">
          已有账号？{' '}
          <button
            type="button"
            onClick={onSwitchToLogin}
            className="text-orange-600 hover:text-orange-500 font-medium transition-colors"
          >
            立即登录
          </button>
        </p>
      </form>
    </AuthLayout>
  );
}
