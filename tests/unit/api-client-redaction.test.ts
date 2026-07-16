import { describe, expect, it } from 'vitest';
import { redactSensitiveApiPath } from '../../client/src/lib/apiClient';

describe('api client sensitive path redaction', () => {
  it('遮蔽观战 token 与查询参数中的 sessionId', () => {
    expect(
      redactSensitiveApiPath(
        '/api/online/spectator-links/private-token/snapshot?sessionId=private-session&sinceSeq=12'
      )
    ).toBe(
      '/api/online/spectator-links/[redacted]/snapshot?sessionId=[redacted]&sinceSeq=12'
    );
  });

  it('遮蔽视角切换路径中的 sessionId', () => {
    expect(
      redactSensitiveApiPath(
        '/api/online/spectator-links/private-token/sessions/private-session/view'
      )
    ).toBe('/api/online/spectator-links/[redacted]/sessions/[redacted]/view');
  });
});
