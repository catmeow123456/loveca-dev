// ============================================
// Configuration
// ============================================

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function resolveApiBaseUrl(): string {
  if (!configuredApiBaseUrl) {
    return typeof window === 'undefined' ? '' : window.location.origin;
  }

  const normalizedConfigured = configuredApiBaseUrl.replace(/\/+$/, '');
  if (typeof window === 'undefined') {
    return normalizedConfigured;
  }

  if (normalizedConfigured === window.location.origin) {
    return '';
  }

  // Production is deployed behind the same Nginx origin. If the same build is
  // served from an alternate host, a baked-in absolute API URL would become a
  // cross-origin request and fail because production CORS is intentionally off.
  if (!import.meta.env.DEV && !isLocalOrigin(window.location.origin)) {
    return '';
  }

  return normalizedConfigured;
}

const API_BASE_URL = resolveApiBaseUrl();

/** Whether the API backend is configured */
export const isApiConfigured = true;

/** Whether email verification / password reset is enabled */
export const isEmailEnabled = import.meta.env.VITE_EMAIL_ENABLED === 'true';

// ============================================
// Types
// ============================================

export interface Profile {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  deck_count: number;
  created_at: string;
  updated_at: string;
}

export interface DeckRecord {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  main_deck: { card_code: string; count: number; card_type?: 'MEMBER' | 'LIVE' }[];
  energy_deck: { card_code: string; count: number }[];
  is_valid: boolean;
  validation_errors: string[];
  is_public: boolean;
  share_id?: string | null;
  share_enabled?: boolean;
  shared_at?: string | null;
  forked_from_deck_id?: string | null;
  forked_from_share_id?: string | null;
  forked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SharedDeckRecord extends DeckRecord {
  author_display_name: string | null;
  author_username: string;
}

export interface ApiResponse<T = unknown> {
  data: T | null;
  error: { code: string; message: string } | null;
  total?: number;
}

// ============================================
// Token management (in-memory only)
// ============================================

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

// ============================================
// Core fetch wrapper
// ============================================

const REQUEST_TIMEOUT = 15000; // 15 seconds
const NETWORK_RETRY_DELAY = 300;

/** Safely parse JSON from a response, returning an error ApiResponse for non-JSON bodies */
async function safeResponseJson<T>(response: Response): Promise<ApiResponse<T>> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('json')) {
    return {
      data: null,
      error: {
        code: 'INVALID_RESPONSE',
        message: `服务器返回了非预期的响应 (${response.status})`,
      },
    };
  }
  try {
    return await response.json() as ApiResponse<T>;
  } catch {
    return {
      data: null,
      error: {
        code: 'INVALID_RESPONSE',
        message: '服务器返回的 JSON 格式异常',
      },
    };
  }
}

function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function isSafeMethod(method: string | undefined): boolean {
  const normalized = (method ?? 'GET').toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD';
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getNetworkErrorMessage(path: string, err: unknown): string {
  const lines = [
    err instanceof Error ? err.message : '网络错误',
    `请求地址: ${buildApiUrl(path)}`,
  ];

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    lines.push('浏览器当前处于离线状态');
  }

  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    API_BASE_URL.startsWith('http:')
  ) {
    lines.push('HTTPS 页面正在请求 HTTP API，浏览器会阻止该请求');
  }

  return lines.join('\n');
}

async function sendApiRequest(
  path: string,
  options: RequestInit,
  headers: Record<string, string>
): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    return await fetch(buildApiUrl(path), {
      ...options,
      headers,
      credentials: 'include', // Send httpOnly cookies
      cache: options.cache ?? (isSafeMethod(options.method) ? 'no-store' : undefined),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  // Don't set Content-Type for GET/HEAD or FormData; otherwise cross-origin GETs
  // become CORS preflight requests and fail if the API is not explicitly allowlisted.
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  try {
    let response: Response;
    try {
      response = await sendApiRequest(path, options, headers);
    } catch (err) {
      if (!isAbortError(err) && isSafeMethod(options.method)) {
        await wait(NETWORK_RETRY_DELAY);
        response = await sendApiRequest(path, options, headers);
      } else {
        throw err;
      }
    }

    const body = await safeResponseJson<T>(response);

    // Auto-refresh protected API requests on 401. This also covers tab restores where
    // the in-memory access token was lost but the httpOnly refresh cookie still exists.
    if (response.status === 401 && shouldAttemptTokenRefresh(path)) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        // Retry with new token
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        } else {
          delete headers['Authorization'];
        }
        const retryResponse = await sendApiRequest(path, options, headers);
        return await safeResponseJson<T>(retryResponse);
      }
      // Refresh failed — clear token
      accessToken = null;
    }

    return body;
  } catch (err) {
    if (isAbortError(err)) {
      return {
        data: null,
        error: { code: 'TIMEOUT', message: '请求超时，请检查网络连接' },
      };
    }
    return {
      data: null,
      error: {
        code: 'NETWORK_ERROR',
        message: getNetworkErrorMessage(path, err),
      },
    };
  }
}

// ============================================
// Token refresh
// ============================================

let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  // Deduplicate concurrent refresh requests
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) return false;

      const body = await response.json() as ApiResponse<{
        accessToken: string;
      }>;

      if (body.data?.accessToken) {
        accessToken = body.data.accessToken;
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function shouldAttemptTokenRefresh(path: string): boolean {
  return !path.startsWith('/api/auth/');
}

// ============================================
// Public API methods
// ============================================

export const apiClient = {
  get<T>(path: string): Promise<ApiResponse<T>> {
    return apiFetch<T>(path, { method: 'GET' });
  },

  post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const isFormData = body instanceof FormData;
    return apiFetch<T>(path, {
      method: 'POST',
      body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return apiFetch<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  delete<T>(path: string): Promise<ApiResponse<T>> {
    return apiFetch<T>(path, { method: 'DELETE' });
  },

  /** Try to restore session from refresh token cookie */
  async refreshSession(): Promise<ApiResponse<{
    accessToken: string;
    user: { id: string; email: string; emailVerified: boolean };
    profile: Profile;
  }>> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });

      // 未登录或刷新令牌失效：静默返回，不抛异常
      if (response.status === 401) {
        accessToken = null;
        return {
          data: null,
          error: { code: 'UNAUTHORIZED', message: '未登录或登录已过期' },
        };
      }

      const body = await safeResponseJson<{
        accessToken: string;
        user: { id: string; email: string; emailVerified: boolean };
        profile: Profile;
      }>(response);

      if (body.data?.accessToken) {
        accessToken = body.data.accessToken;
      }

      return body;
    } catch {
      return {
        data: null,
        error: { code: 'NETWORK_ERROR', message: '网络错误' },
      };
    }
  },
};
