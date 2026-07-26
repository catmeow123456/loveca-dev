/**
 * 邮箱验证页面组件
 * 用户通过验证邮件链接进入，自动完成邮箱验证。
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { AuthLayout } from './AuthLayout';

interface VerifyEmailPageProps {
  onSwitchToLogin: () => void;
  token?: string | null;
  purpose?: 'registration' | 'email-change';
}

type VerificationStatus = 'loading' | 'success' | 'error';

const verificationRequests = new Map<string, Promise<{ success: boolean; error?: string }>>();

function getVerificationRequest(
  requestKey: string,
  token: string,
  verify: (token: string) => Promise<{ success: boolean; error?: string }>
): Promise<{ success: boolean; error?: string }> {
  const existing = verificationRequests.get(requestKey);
  if (existing) {
    return existing;
  }

  const request = verify(token);
  verificationRequests.set(requestKey, request);
  const clearRequest = () => {
    if (verificationRequests.get(requestKey) === request) {
      verificationRequests.delete(requestKey);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function VerifyEmailPage({
  onSwitchToLogin,
  token,
  purpose = 'registration',
}: VerifyEmailPageProps) {
  const verificationToken = token?.trim() ?? '';
  const [status, setStatus] = useState<VerificationStatus>(() =>
    verificationToken ? 'loading' : 'error'
  );
  const [message, setMessage] = useState<string | null>(() =>
    verificationToken ? null : '验证链接缺少 token，请重新发送验证邮件'
  );
  const verifyEmail = useAuthStore((s) => s.verifyEmail);
  const verifyEmailChange = useAuthStore((s) => s.verifyEmailChange);
  const isEmailChange = purpose === 'email-change';

  useEffect(() => {
    if (!verificationToken) {
      return;
    }

    let cancelled = false;

    const verify = isEmailChange ? verifyEmailChange : verifyEmail;
    void getVerificationRequest(`${purpose}:${verificationToken}`, verificationToken, verify).then(
      (result) => {
        if (cancelled) {
          return;
        }

        if (result.success) {
          setStatus('success');
          setMessage(null);
        } else {
          setStatus('error');
          setMessage(result.error ?? '邮箱验证失败');
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [isEmailChange, purpose, verificationToken, verifyEmail, verifyEmailChange]);

  if (status === 'loading') {
    return (
      <AuthLayout title={isEmailChange ? '正在确认新邮箱' : '正在验证邮箱'} subtitle="请稍候">
        <div className="space-y-6 text-center">
          <div className="flex justify-center text-[var(--accent-primary)]">
            <Loader2 size={56} className="animate-spin" />
          </div>
          <p className="text-[var(--text-secondary)]">
            正在处理{isEmailChange ? '邮箱换绑' : '邮箱验证'}链接。
          </p>
        </div>
      </AuthLayout>
    );
  }

  if (status === 'success') {
    return (
      <AuthLayout title={isEmailChange ? '邮箱已换绑' : '邮箱已验证'} subtitle="你现在可以登录了">
        <div className="space-y-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="flex justify-center text-[var(--semantic-success)]"
          >
            <CheckCircle2 size={56} />
          </motion.div>

          <p className="text-[var(--text-secondary)]">
            {isEmailChange
              ? '新邮箱已经生效，其他设备上的登录会话已失效。'
              : '邮箱验证已完成，请返回登录页面继续。'}
          </p>

          <button onClick={onSwitchToLogin} className="button-primary w-full py-3 font-bold">
            前往登录
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={isEmailChange ? '换绑失败' : '验证失败'}
      subtitle={isEmailChange ? '换绑链接无效或已过期' : '验证链接无效或已过期'}
    >
      <div className="space-y-6 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200 }}
          className="flex justify-center text-[var(--semantic-error)]"
        >
          <XCircle size={56} />
        </motion.div>

        <p className="text-[var(--text-secondary)]">
          {message ?? (isEmailChange ? '邮箱换绑失败' : '邮箱验证失败')}
        </p>

        <button
          type="button"
          onClick={onSwitchToLogin}
          className="inline-flex items-center gap-1 font-medium text-[var(--accent-primary)] transition-colors hover:text-[var(--accent-primary-hover)]"
        >
          <ArrowLeft size={14} />
          返回登录
        </button>
      </div>
    </AuthLayout>
  );
}
