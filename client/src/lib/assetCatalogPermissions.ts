import {
  hasPermission,
  type ManagementPermission,
  type UserRole,
} from '@game/shared/auth/permissions';

export const IMAGE_ASSET_CATALOG_PERMISSIONS: readonly ManagementPermission[] = [
  'platform.manage',
  'season.ranked.manage',
  'season.theme.manage',
];

export const ASSET_CATALOG_PERMISSIONS: readonly ManagementPermission[] = [
  'cards.manage',
  ...IMAGE_ASSET_CATALOG_PERMISSIONS,
];

export function canViewImageAssetCatalog(role: UserRole): boolean {
  return IMAGE_ASSET_CATALOG_PERMISSIONS.some((permission) => hasPermission(role, permission));
}
