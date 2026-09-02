import { createUploadRateLimitMiddleware } from './upload-rate-limit.js';

const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const USER_ATTEMPT_LIMIT = 12;
const ADDRESS_ATTEMPT_LIMIT = 30;
const USER_BYTE_LIMIT = 48 * 1024 * 1024;
const ADDRESS_BYTE_LIMIT = 120 * 1024 * 1024;

const imageUploadRateLimit = createUploadRateLimitMiddleware({
  windowMs: ATTEMPT_WINDOW_MS,
  userAttemptLimit: USER_ATTEMPT_LIMIT,
  addressAttemptLimit: ADDRESS_ATTEMPT_LIMIT,
  userByteLimit: USER_BYTE_LIMIT,
  addressByteLimit: ADDRESS_BYTE_LIMIT,
  attemptErrorCode: 'IMAGE_UPLOAD_RATE_LIMIT',
  byteErrorCode: 'IMAGE_UPLOAD_BYTE_LIMIT',
  attemptErrorMessage: '图片上传尝试过于频繁，请稍后再试。',
  byteErrorMessage: '短时间内上传的图片总量过大，请稍后再试。',
});

export const enforceImageUploadAttemptLimit = imageUploadRateLimit.enforceAttemptLimit;
export const enforceImageUploadedByteLimit = imageUploadRateLimit.enforceUploadedByteLimit;
