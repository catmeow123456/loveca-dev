export type LegalDocumentKey = 'disclaimer' | 'takedown' | 'privacy';

export const LEGAL_NOTICE_ZH =
  'Cyber Loveca 是非官方 Love Live! 爱好者社区项目，与官方及相关权利方不存在隶属、认可或赞助关系。';

export const LEGAL_DISCLAIMER_EN =
  'Cyber Loveca is an unofficial fan-made community project. It is not affiliated with or endorsed by the Love Live! franchise, Love Live! Series Official Card Game, or any of their rights holders. All rights to related characters, artwork, names, logos, and trademarks are held by their respective owners.';

export const LEGAL_DOCUMENT_LINKS: ReadonlyArray<{
  readonly key: LegalDocumentKey;
  readonly label: string;
  readonly href: string;
}> = [
  { key: 'disclaimer', label: '版权与免责声明', href: '/legal/disclaimer' },
  { key: 'takedown', label: '权利通知', href: '/legal/takedown' },
  { key: 'privacy', label: '隐私政策', href: '/legal/privacy' },
];

const LEGAL_DOCUMENT_PATHS = new Map(
  LEGAL_DOCUMENT_LINKS.map((document) => [document.href, document.key] as const)
);

export function resolveLegalDocumentPath(pathname: string): LegalDocumentKey | null {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  return LEGAL_DOCUMENT_PATHS.get(normalizedPath) ?? null;
}
