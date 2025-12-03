/**
 * Common utility functions shared across all network modules
 */

/**
 * Sleep utility for rate limiting
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff
 */
async function retry(fn, maxRetries = 3, baseDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = baseDelay * Math.pow(2, i);
      console.warn(`  Retry ${i + 1}/${maxRetries} after ${delay}ms: ${error.message}`);
      await sleep(delay);
    }
  }
}

module.exports = {
  sleep,
  retry
};
