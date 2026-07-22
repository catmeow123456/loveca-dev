/**
 * Authentication state management
 * Handles login, register, logout, session restoration via self-hosted API
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiClient, isApiConfigured, setAccessToken, type Profile } from '@/lib/apiClient';

interface AuthUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

interface AuthState {
  // State
  user: AuthUser | null;
  profile: Profile | null;
  isLoading: boolean;
  isInitialized: boolean;
  error: string | null;

  // Offline mode
  offlineMode: boolean;
  offlineUser: { username: string; displayName: string } | null;

  // Actions
  initialize: () => Promise<void>;
  signUp: (
    username: string,
    email: string,
    password: string,
    displayName?: string
  ) => Promise<{
    success: boolean;
    error?: string;
    code?: string;
    message?: string;
    verificationRequired?: boolean;
    verificationEmailSent?: boolean;
  }>;
  signIn: (
    usernameOrEmail: string,
    password: string
  ) => Promise<{ success: boolean; error?: string; code?: string }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<{ success: boolean; error?: string }>;
  resetPassword: (email: string) => Promise<{ success: boolean; error?: string }>;
  updatePassword: (
    newPassword: string,
    token?: string,
    currentPassword?: string
  ) => Promise<{ success: boolean; error?: string }>;
  verifyEmail: (token: string) => Promise<{ success: boolean; error?: string }>;
  resendVerificationEmail: (email: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;

  // Offline mode
  enterOfflineMode: (username: string) => void;
  exitOfflineMode: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      profile: null,
      isLoading: false,
      isInitialized: false,
      error: null,
      offlineMode: false,
      offlineUser: null,

      initialize: async () => {
        if (get().isInitialized) return;

        set({ isLoading: true });

        if (!isApiConfigured) {
          console.log('API not configured, entering offline mode');
          set({
            isLoading: false,
            isInitialized: true,
            offlineMode: true,
          });
          return;
        }

        try {
          // Abort the underlying request as well as the wait. A timed-out refresh must
          // never overwrite a later interactive login with a stale access token.
          const controller = new AbortController();
          const timeout = window.setTimeout(() => controller.abort(), 5000);
          const result = await apiClient.refreshSession({ signal: controller.signal });
          window.clearTimeout(timeout);

          if (result.data) {
            set({
              user: result.data.user,
              profile: result.data.profile,
            });
          }
        } catch (err) {
          console.error('Failed to initialize auth:', err);
        } finally {
          set({ isLoading: false, isInitialized: true });
        }
      },

      signUp: async (username, email, password, displayName) => {
        if (!isApiConfigured) {
          return { success: false, error: '服务器未配置' };
        }

        set({ isLoading: true, error: null });

        try {
          const result = await apiClient.post<{
            id: string;
            username: string;
            message: string;
            verificationRequired: boolean;
            verificationEmailSent: boolean;
          }>('/api/auth/register', { username, email: email || undefined, password, displayName });

          if (result.error) {
            set({ isLoading: false, error: result.error.message });
            return {
              success: false,
              error: result.error.message,
              code: result.error.code,
            };
          }

          set({ isLoading: false });
          return {
            success: true,
            message: result.data?.message,
            verificationRequired: result.data?.verificationRequired,
            verificationEmailSent: result.data?.verificationEmailSent,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : '注册失败';
          set({ isLoading: false, error: message });
          return { success: false, error: message };
        }
      },

      signIn: async (usernameOrEmail, password) => {
        if (!isApiConfigured) {
          return { success: false, error: '服务器未配置' };
        }

        set({ isLoading: true, error: null });

        try {
          const result = await apiClient.post<{
            accessToken: string;
            user: AuthUser;
            profile: Profile;
          }>('/api/auth/login', { usernameOrEmail, password });

          if (result.error) {
            set({ isLoading: false, error: result.error.message });
            return {
              success: false,
              error: result.error.message,
              code: result.error.code,
            };
          }

          if (result.data) {
            setAccessToken(result.data.accessToken);
            set({
              user: result.data.user,
              profile: result.data.profile,
              offlineMode: false,
              offlineUser: null,
            });
          }

          set({ isLoading: false });
          return { success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : '登录失败';
          set({ isLoading: false, error: message });
          return { success: false, error: message };
        }
      },

      signOut: async () => {
        set({ isLoading: true });
        try {
          if (isApiConfigured) {
            await apiClient.post('/api/auth/logout');
          }
        } finally {
          setAccessToken(null);
          set({
            user: null,
            profile: null,
            offlineMode: false,
            offlineUser: null,
            isLoading: false,
          });
        }
      },

      updateProfile: async (updates) => {
        const { profile } = get();

        if (!isApiConfigured || !profile) {
          return { success: false, error: '未登录' };
        }

        set({ isLoading: true, error: null });

        try {
          const result = await apiClient.put<Profile>(`/api/profiles/${profile.id}`, updates);

          if (result.error) {
            set({ isLoading: false, error: result.error.message });
            return { success: false, error: result.error.message };
          }

          set({
            profile: result.data,
            isLoading: false,
          });

          return { success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : '更新失败';
          set({ isLoading: false, error: message });
          return { success: false, error: message };
        }
      },

      resetPassword: async (email) => {
        if (!isApiConfigured) {
          return { success: false, error: '服务器未配置' };
        }

        set({ isLoading: true, error: null });

        try {
          const result = await apiClient.post('/api/auth/reset-password', { email });

          if (result.error) {
            set({ isLoading: false, error: result.error.message });
            return { success: false, error: result.error.message };
          }

          set({ isLoading: false });
          return { success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : '发送重置邮件失败';
          set({ isLoading: false, error: message });
          return { success: false, error: message };
        }
      },

      updatePassword: async (newPassword, token, currentPassword) => {
        if (!isApiConfigured) {
          return { success: false, error: '服务器未配置' };
        }

        set({ isLoading: true, error: null });

        try {
          if (!token && !currentPassword) {
            set({ isLoading: false, error: '请输入当前密码' });
            return { success: false, error: '请输入当前密码' };
          }
          const payload = token
            ? { token, newPassword }
            : { currentPassword: currentPassword!, newPassword };
          const result = await apiClient.put('/api/auth/password', payload);

          if (result.error) {
            set({ isLoading: false, error: result.error.message });
            return { success: false, error: result.error.message };
          }

          setAccessToken(null);
          set({
            user: null,
            profile: null,
            offlineMode: false,
            offlineUser: null,
            isLoading: false,
          });
          return { success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : '更新密码失败';
          set({ isLoading: false, error: message });
          return { success: false, error: message };
        }
      },

      verifyEmail: async (token) => {
        if (!isApiConfigured) {
          return { success: false, error: '服务器未配置' };
        }

        set({ isLoading: true, error: null });

        try {
          const result = await apiClient.post('/api/auth/verify-email', { token });

          if (result.error) {
            set({ isLoading: false, error: result.error.message });
            return { success: false, error: result.error.message };
          }

          set({ isLoading: false });
          return { success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : '邮箱验证失败';
          set({ isLoading: false, error: message });
          return { success: false, error: message };
        }
      },

      resendVerificationEmail: async (email) => {
        if (!isApiConfigured) {
          return { success: false, error: '服务器未配置' };
        }

        try {
          const result = await apiClient.post('/api/auth/resend-verification', { email });

          if (result.error) {
            return { success: false, error: result.error.message };
          }

          return { success: true };
        } catch (err) {
          const message = err instanceof Error ? err.message : '重新发送验证邮件失败';
          return { success: false, error: message };
        }
      },

      clearError: () => set({ error: null }),

      enterOfflineMode: (username) => {
        set({
          offlineMode: true,
          offlineUser: { username, displayName: username },
          user: null,
          profile: null,
        });
      },

      exitOfflineMode: () => {
        set({
          offlineMode: false,
          offlineUser: null,
        });
      },
    }),
    {
      name: 'loveca-auth',
      partialize: (state) => ({
        offlineMode: state.offlineMode,
        offlineUser: state.offlineUser,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && !state.offlineMode) {
          state.isInitialized = false;
        }
      },
    }
  )
);
