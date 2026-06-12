import { apiClient } from './apiClient';

export interface PublicAppConfig {
  features: {
    email: {
      enabled: boolean;
      verificationRequired: boolean;
      passwordResetEnabled: boolean;
    };
  };
}

export const DEFAULT_APP_CONFIG: PublicAppConfig = {
  features: {
    email: {
      enabled: false,
      verificationRequired: false,
      passwordResetEnabled: false,
    },
  },
};

function normalizeAppConfig(config: Partial<PublicAppConfig> | null | undefined): PublicAppConfig {
  const email = config?.features?.email;

  return {
    features: {
      email: {
        enabled: email?.enabled === true,
        verificationRequired: email?.verificationRequired === true,
        passwordResetEnabled: email?.passwordResetEnabled === true,
      },
    },
  };
}

export async function loadPublicAppConfig(): Promise<PublicAppConfig> {
  const result = await apiClient.get<PublicAppConfig>('/api/config');

  if (!result.data) {
    if (result.error) {
      console.warn('[AppConfig] Failed to load public config:', result.error.message);
    }
    return DEFAULT_APP_CONFIG;
  }

  return normalizeAppConfig(result.data);
}
