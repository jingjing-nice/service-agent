export async function readApiError(response: Response, fallback: string): Promise<Error> {
  try {
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null) {
      const message = Reflect.get(body, 'message');
      if (typeof message === 'string' && message.trim()) return new Error(message);
      const nested = Reflect.get(body, 'error');
      if (typeof nested === 'string' && nested.trim()) return new Error(nested);
    }
  } catch {
    // Non-JSON failures fall back to the stable UI message below.
  }
  return new Error(`${fallback}：HTTP ${response.status}`);
}
