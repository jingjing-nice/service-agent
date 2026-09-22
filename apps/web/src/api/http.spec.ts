import { readApiError } from './http';

describe('readApiError', () => {
  it('uses a server business message when available', async () => {
    const response = new Response(JSON.stringify({ message: '文档状态不允许发布' }), {
      status: 409, headers: { 'content-type': 'application/json' },
    });
    await expect(readApiError(response, '发布失败')).resolves.toEqual(
      new Error('文档状态不允许发布'),
    );
  });

  it('falls back safely for a non-JSON response', async () => {
    const response = new Response('upstream failed', { status: 502 });
    await expect(readApiError(response, '请求失败')).resolves.toEqual(
      new Error('请求失败：HTTP 502'),
    );
  });
});
