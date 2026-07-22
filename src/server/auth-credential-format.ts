export const CURRENT_PASSWORD_HASH_PREFIX = '$loveca-bcrypt-sha256$';
export const PASSWORD_RESET_REQUIRED_HASH = '$loveca-password-reset-required$v1';

export const BCRYPT_HASH_PATTERN_SOURCE = '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$';
export const CURRENT_PASSWORD_HASH_PATTERN_SOURCE =
  '^\\$loveca-bcrypt-sha256\\$\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$';

const CURRENT_PASSWORD_HASH_PATTERN = new RegExp(CURRENT_PASSWORD_HASH_PATTERN_SOURCE);

export function readCurrentBcryptHash(storedHash: string): string | null {
  if (!CURRENT_PASSWORD_HASH_PATTERN.test(storedHash)) {
    return null;
  }
  return storedHash.slice(CURRENT_PASSWORD_HASH_PREFIX.length);
}
