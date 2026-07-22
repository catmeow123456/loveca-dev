import bcrypt from 'bcrypt';
import crypto from 'node:crypto';

const SALT_ROUNDS = 12;
const CURRENT_PASSWORD_HASH_PREFIX = '$loveca-bcrypt-sha256$';

function preparePasswordForBcrypt(password) {
  return crypto
    .createHash('sha256')
    .update('loveca-password-v1\0', 'utf8')
    .update(password, 'utf8')
    .digest('base64url');
}

export async function hashCurrentPassword(password) {
  const bcryptHash = await bcrypt.hash(preparePasswordForBcrypt(password), SALT_ROUNDS);
  return `${CURRENT_PASSWORD_HASH_PREFIX}${bcryptHash}`;
}
