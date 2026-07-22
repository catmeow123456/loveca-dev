import { describe, expect, it } from 'vitest';
import { hashCurrentPassword } from '../../scripts/lib/current-password-hash.mjs';
import { CURRENT_PASSWORD_HASH_PREFIX } from '../../src/server/auth-credential-format';
import { verifyPassword } from '../../src/server/services/auth-service';

describe('test environment admin credential', () => {
  it('生成当前认证服务可验证的密码摘要', async () => {
    const password = 'test_admin_password';
    const hash = await hashCurrentPassword(password);

    expect(hash.startsWith(CURRENT_PASSWORD_HASH_PREFIX)).toBe(true);
    expect(hash.slice(CURRENT_PASSWORD_HASH_PREFIX.length)).toMatch(/^\$2[aby]\$12\$/);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });
});
