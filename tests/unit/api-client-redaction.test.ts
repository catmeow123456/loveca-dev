import { describe, expect, it } from 'vitest';
import { redactSensitiveApiPath, toApiClientError } from '../../client/src/lib/apiClient';

describe('api client sensitive path redaction', () => {
  it('遮蔽观战 token 与查询参数中的 sessionId', () => {
    expect(
      redactSensitiveApiPath(
        '/api/online/spectator-links/private-token/snapshot?sessionId=private-session&sinceSeq=12'
      )
    ).toBe('/api/online/spectator-links/[redacted]/snapshot?sessionId=[redacted]&sinceSeq=12');
  });

  it('遮蔽视角切换路径中的 sessionId', () => {
    expect(
      redactSensitiveApiPath(
        '/api/online/spectator-links/private-token/sessions/private-session/view'
      )
    ).toBe('/api/online/spectator-links/[redacted]/sessions/[redacted]/view');
  });

  it('保留结构化状态码、错误码与观战等待时间', () => {
    const error = toApiClientError(
      {
        data: null,
        status: 429,
        retryAfterMs: 3_000,
        error: {
          code: 'ONLINE_SPECTATOR_RATE_LIMITED',
          message: '观战同步暂时繁忙，请稍等',
        },
      },
      '读取观战快照失败'
    );

    expect(error).toMatchObject({
      status: 429,
      code: 'ONLINE_SPECTATOR_RATE_LIMITED',
      retryAfterMs: 3_000,
      message: '观战同步暂时繁忙，请稍等',
    });
  });
});
