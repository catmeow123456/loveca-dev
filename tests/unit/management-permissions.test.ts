import { describe, expect, it } from 'vitest';
import {
  MANAGEMENT_PERMISSIONS,
  USER_ROLES,
  hasPermission,
} from '../../src/shared/auth/permissions';

describe('management permission matrix', () => {
  it('defines every role and permission as an explicit allow-list', () => {
    expect(USER_ROLES).toEqual(['user', 'season_admin', 'admin']);
    expect(MANAGEMENT_PERMISSIONS).toEqual([
      'season.ranked.manage',
      'season.deck_classifier.manage',
      'season.theme.manage',
      'season.entry_visibility.manage',
      'platform.manage',
      'cards.manage',
      'cards.sync',
      'rules.manage',
      'users.list',
      'users.roles.manage',
    ]);

    for (const permission of MANAGEMENT_PERMISSIONS) {
      expect(hasPermission('user', permission)).toBe(false);
      expect(hasPermission('admin', permission)).toBe(true);
    }

    expect(
      MANAGEMENT_PERMISSIONS.filter((permission) => hasPermission('season_admin', permission))
    ).toEqual([
      'season.ranked.manage',
      'season.deck_classifier.manage',
      'season.theme.manage',
      'season.entry_visibility.manage',
    ]);
  });
});
