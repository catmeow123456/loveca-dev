import { describe, expect, it } from 'vitest';
import {
  LEGAL_DISCLAIMER_EN,
  LEGAL_DOCUMENT_LINKS,
  LEGAL_NOTICE_ZH,
  resolveLegalDocumentPath,
} from './legalPages';

describe('legal page navigation', () => {
  it('keeps the unofficial status visible in both Chinese and English copy', () => {
    expect(LEGAL_NOTICE_ZH).toContain('非官方 Love Live! 爱好者社区项目');
    expect(LEGAL_NOTICE_ZH).toContain('不存在隶属、认可或赞助关系');
    expect(LEGAL_DISCLAIMER_EN).toContain('unofficial fan-made community project');
    expect(LEGAL_DISCLAIMER_EN).toContain('not affiliated with or endorsed by');
    expect(LEGAL_DISCLAIMER_EN).toContain('Love Live! Series Official Card Game');
  });

  it('publishes stable routes for every footer link', () => {
    expect(LEGAL_DOCUMENT_LINKS.map((link) => link.href)).toEqual([
      '/legal/disclaimer',
      '/legal/takedown',
      '/legal/privacy',
    ]);
    expect(resolveLegalDocumentPath('/legal/disclaimer/')).toBe('disclaimer');
    expect(resolveLegalDocumentPath('/legal/takedown')).toBe('takedown');
    expect(resolveLegalDocumentPath('/legal/privacy')).toBe('privacy');
    expect(resolveLegalDocumentPath('/')).toBeNull();
  });
});
