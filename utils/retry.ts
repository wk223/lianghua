/**
 * 重试机制
 * 异步函数重试 + 指数退避
 *
 * @module utils/retry
 * @todo 完善重试策略
 */

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    onRetry?: (error: Error, attempt: number) => void;
  } = {},
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        onRetry?.(lastError, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
