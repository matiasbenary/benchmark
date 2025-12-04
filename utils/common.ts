/**
 * Common utility functions shared across all network modules
 */

/**
 * Sleep utility for rate limiting
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, i);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`  Retry ${i + 1}/${maxRetries} after ${delay}ms: ${errorMessage}`);
      await sleep(delay);
    }
  }
  throw new Error('Retry failed'); // This line should never be reached
}
