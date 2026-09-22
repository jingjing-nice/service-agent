import { withRetry } from './retry.js';

describe('withRetry', () => {
  it('retries transient Milvus or Embedding failures and returns the successful result', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValue('ok');
    await expect(withRetry(operation, { attempts: 3, baseDelayMs: 0 })).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when cancelled', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const operation = vi.fn();
    await expect(withRetry(operation, { signal: controller.signal })).rejects.toThrow('cancelled');
    expect(operation).not.toHaveBeenCalled();
  });
});
