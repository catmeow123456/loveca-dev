import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleLegalDocumentNavigation,
  LEGAL_DISCLAIMER_EN,
  LEGAL_DOCUMENT_LINKS,
  LEGAL_NOTICE_ZH,
  resolveLegalDocumentPath,
} from './legalPages';

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('uses client-side history for ordinary clicks and preserves modified clicks', () => {
    const pushState = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      location: { pathname: '/', search: '', hash: '' },
      history: { pushState },
      dispatchEvent,
    });
    const preventDefault = vi.fn();
    const ordinaryClick = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault,
    };

    expect(handleLegalDocumentNavigation(ordinaryClick, '/legal/privacy')).toBe(true);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(pushState).toHaveBeenCalledWith(null, '', '/legal/privacy');
    expect(dispatchEvent).toHaveBeenCalledOnce();

    expect(
      handleLegalDocumentNavigation(
        { ...ordinaryClick, ctrlKey: true, preventDefault: vi.fn() },
        '/legal/takedown'
      )
    ).toBe(false);
    expect(pushState).toHaveBeenCalledOnce();
  });
});
