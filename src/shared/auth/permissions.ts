export const USER_ROLES = ['user', 'season_admin', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const MANAGEMENT_PERMISSIONS = [
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
] as const;

export type ManagementPermission = (typeof MANAGEMENT_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly ManagementPermission[]>> = {
  user: [],
  season_admin: [
    'season.ranked.manage',
    'season.deck_classifier.manage',
    'season.theme.manage',
    'season.entry_visibility.manage',
  ],
  admin: MANAGEMENT_PERMISSIONS,
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function hasPermission(role: UserRole, permission: ManagementPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAnyManagementPermission(role: UserRole): boolean {
  return ROLE_PERMISSIONS[role].length > 0;
}

export function getRolePermissions(role: UserRole): readonly ManagementPermission[] {
  return ROLE_PERMISSIONS[role];
}
