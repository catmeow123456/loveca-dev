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
}

type VerificationStatus = 'loading' | 'success' | 'error';

const verificationRequests = new Map<string, Promise<{ success: boolean; error?: string }>>();

function getVerificationRequest(
  token: string,
  verifyEmail: (token: string) => Promise<{ success: boolean; error?: string }>
): Promise<{ success: boolean; error?: string }> {
  const existing = verificationRequests.get(token);
  if (existing) {
    return existing;
  }

  const request = verifyEmail(token);
  verificationRequests.set(token, request);
  const clearRequest = () => {
    if (verificationRequests.get(token) === request) {
      verificationRequests.delete(token);
    }
  };
  void request.then(clearRequest, clearRequest);
  return request;
}

export function VerifyEmailPage({ onSwitchToLogin, token }: VerifyEmailPageProps) {
  const verificationToken = token?.trim() ?? '';
  const [status, setStatus] = useState<VerificationStatus>(() =>
    verificationToken ? 'loading' : 'error'
  );
  const [message, setMessage] = useState<string | null>(() =>
    verificationToken ? null : '验证链接缺少 token，请重新发送验证邮件'
  );
  const verifyEmail = useAuthStore((s) => s.verifyEmail);

  useEffect(() => {
    if (!verificationToken) {
      return;
    }

    let cancelled = false;

    void getVerificationRequest(verificationToken, verifyEmail).then((result) => {
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
    });

    return () => {
      cancelled = true;
    };
  }, [verificationToken, verifyEmail]);

  if (status === 'loading') {
    return (
      <AuthLayout title="正在验证邮箱" subtitle="请稍候">
        <div className="space-y-6 text-center">
          <div className="flex justify-center text-[var(--accent-primary)]">
            <Loader2 size={56} className="animate-spin" />
          </div>
          <p className="text-[var(--text-secondary)]">正在处理邮箱验证链接。</p>
        </div>
      </AuthLayout>
    );
  }

  if (status === 'success') {
    return (
      <AuthLayout title="邮箱已验证" subtitle="你现在可以登录了">
        <div className="space-y-6 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200 }}
            className="flex justify-center text-[var(--semantic-success)]"
          >
            <CheckCircle2 size={56} />
          </motion.div>

          <p className="text-[var(--text-secondary)]">邮箱验证已完成，请返回登录页面继续。</p>

          <button onClick={onSwitchToLogin} className="button-primary w-full py-3 font-bold">
            前往登录
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="验证失败" subtitle="验证链接无效或已过期">
      <div className="space-y-6 text-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200 }}
          className="flex justify-center text-[var(--semantic-error)]"
        >
          <XCircle size={56} />
        </motion.div>

        <p className="text-[var(--text-secondary)]">{message ?? '邮箱验证失败'}</p>

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
