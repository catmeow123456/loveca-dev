import { requirePermission } from './require-permission.js';

/**
 * Requires the authenticated user to have admin role.
 * Must be used after requireAuth.
 * Returns 403 if not admin.
 */
export const requireAdmin = requirePermission('platform.manage');
