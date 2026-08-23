import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCloudbaseCardSyncConfigurationStatus } from '../../src/server/services/cloudbase-card-sync-engine';

describe('CloudBase card sync production configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not accept legacy credential aliases when formal variables are missing', () => {
    vi.stubEnv('CLOUDBASE_ENV_ID', 'env-id');
    vi.stubEnv('CLOUDBASE_SECRET_ID', '');
    vi.stubEnv('CLOUDBASE_SECRET_KEY', '');
    vi.stubEnv('CLOUDBASE_SECRETID', 'legacy-id');
    vi.stubEnv('CLOUDBASE_SECRETKEY', 'legacy-key');

    expect(getCloudbaseCardSyncConfigurationStatus()).toEqual({
      configured: false,
      missing: ['CLOUDBASE_SECRET_ID', 'CLOUDBASE_SECRET_KEY'],
    });
  });

  it('accepts only the three formal server-side variables', () => {
    vi.stubEnv('CLOUDBASE_ENV_ID', 'env-id');
    vi.stubEnv('CLOUDBASE_SECRET_ID', 'secret-id');
    vi.stubEnv('CLOUDBASE_SECRET_KEY', 'secret-key');

    expect(getCloudbaseCardSyncConfigurationStatus()).toEqual({
      configured: true,
      missing: [],
    });
  });
});
