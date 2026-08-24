export const CARD_IMAGE_VERSION_FLAG = 'imageObjectVersioned';
export const CARD_IMAGE_ORIGINAL_BASENAME_FLAG = 'imageOriginalBaseName';

type SourceFlags = Readonly<Record<string, unknown>>;

export type CardImageVersionMetadataState =
  | { readonly status: 'UNMARKED' }
  | { readonly status: 'VALID'; readonly originalBaseName: string }
  | { readonly status: 'INVALID'; readonly reason: string };

function hasOwn(record: SourceFlags, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function hasCardImageVersionMetadata(sourceFlags: SourceFlags | null | undefined): boolean {
  return Boolean(
    sourceFlags &&
    (hasOwn(sourceFlags, CARD_IMAGE_VERSION_FLAG) ||
      hasOwn(sourceFlags, CARD_IMAGE_ORIGINAL_BASENAME_FLAG))
  );
}

export function clearCardImageVersionMetadata(
  sourceFlags: SourceFlags | null | undefined
): Record<string, unknown> | null {
  if (!sourceFlags) return null;
  const remaining = Object.fromEntries(
    Object.entries(sourceFlags).filter(
      ([key]) => key !== CARD_IMAGE_VERSION_FLAG && key !== CARD_IMAGE_ORIGINAL_BASENAME_FLAG
    )
  );
  return Object.keys(remaining).length > 0 ? remaining : null;
}

export function inspectCardImageVersionMetadata(
  imageFilename: string | null | undefined,
  sourceFlags: SourceFlags | null | undefined
): CardImageVersionMetadataState {
  if (!sourceFlags || !hasCardImageVersionMetadata(sourceFlags)) {
    return { status: 'UNMARKED' };
  }

  if (
    !hasOwn(sourceFlags, CARD_IMAGE_VERSION_FLAG) ||
    !hasOwn(sourceFlags, CARD_IMAGE_ORIGINAL_BASENAME_FLAG)
  ) {
    return { status: 'INVALID', reason: '版本化标记必须与原始 basename 同时存在' };
  }
  if (sourceFlags[CARD_IMAGE_VERSION_FLAG] !== true) {
    return { status: 'INVALID', reason: '版本化标记必须为 true' };
  }

  const rawOriginalBaseName = sourceFlags[CARD_IMAGE_ORIGINAL_BASENAME_FLAG];
  const originalBaseName =
    typeof rawOriginalBaseName === 'string' ? rawOriginalBaseName.trim() : '';
  if (
    !originalBaseName ||
    rawOriginalBaseName !== originalBaseName ||
    originalBaseName.includes('/') ||
    originalBaseName.includes('\\')
  ) {
    return { status: 'INVALID', reason: '原始 basename 必须是无路径的非空字符串' };
  }

  const normalizedImageFilename = imageFilename?.trim() ?? '';
  if (!normalizedImageFilename || normalizedImageFilename !== imageFilename) {
    return { status: 'INVALID', reason: '版本化标记存在时 image_filename 不得为空' };
  }
  if (normalizedImageFilename.includes('/') || normalizedImageFilename.includes('\\')) {
    return { status: 'INVALID', reason: 'image_filename 必须是无路径的文件名' };
  }

  const expectedPrefix = `${originalBaseName}-`;
  const expectedExtension = '.webp';
  const versionDigest = normalizedImageFilename.startsWith(expectedPrefix)
    ? normalizedImageFilename.slice(expectedPrefix.length, -expectedExtension.length)
    : '';
  if (
    !normalizedImageFilename.endsWith(expectedExtension) ||
    !/^[0-9a-f]{24}$/u.test(versionDigest) ||
    normalizedImageFilename !== `${expectedPrefix}${versionDigest}${expectedExtension}`
  ) {
    return {
      status: 'INVALID',
      reason: 'image_filename 必须与原始 basename 及 24 位版本摘要完全对应',
    };
  }

  return { status: 'VALID', originalBaseName };
}

export function setCardImageVersionMetadata(
  sourceFlags: SourceFlags | null | undefined,
  imageFilename: string,
  originalBaseName: string
): Record<string, unknown> {
  const next = {
    ...(clearCardImageVersionMetadata(sourceFlags) ?? {}),
    [CARD_IMAGE_VERSION_FLAG]: true,
    [CARD_IMAGE_ORIGINAL_BASENAME_FLAG]: originalBaseName,
  };
  const state = inspectCardImageVersionMetadata(imageFilename, next);
  if (state.status !== 'VALID') {
    throw new Error(state.status === 'INVALID' ? state.reason : '版本化图片元数据未能被正确写入');
  }
  return next;
}
