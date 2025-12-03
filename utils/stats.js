/**
 * Statistical utility functions for analyzing finality times
 */

/**
 * Calculate average of an array of numbers
 */
function average(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

/**
 * Calculate median of an array of numbers
 */
function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Calculate standard deviation
 */
function standardDeviation(arr) {
  if (arr.length === 0) return 0;
  const avg = average(arr);
  const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
  const avgSquareDiff = average(squareDiffs);
  return Math.sqrt(avgSquareDiff);
}

/**
 * Calculate percentile (0-100)
 */
function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (lower === upper) {
    return sorted[lower];
  }
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Calculate comprehensive statistics for an array of latencies
 */
function calculateStats(latencies, failures = 0) {
  const validLatencies = latencies.filter(l => l !== null && !isNaN(l));

  if (validLatencies.length === 0) {
    return {
      count: 0,
      failures,
      average: 0,
      txPerSecond: 0,
      median: 0,
      stdDev: 0,
      min: 0,
      max: 0,
      p90: 0,
      p95: 0,
      p99: 0
    };
  }

  const avg = average(validLatencies);
  const txPerSecond = avg > 0 ? 1000 / avg : 0;

  return {
    count: validLatencies.length,
    failures,
    average: Math.round(avg),
    txPerSecond: Math.round(txPerSecond * 100) / 100, // Round to 2 decimal places
    median: Math.round(median(validLatencies)),
    stdDev: Math.round(standardDeviation(validLatencies)),
    min: Math.min(...validLatencies),
    max: Math.max(...validLatencies),
    p90: Math.round(percentile(validLatencies, 90)),
    p95: Math.round(percentile(validLatencies, 95)),
    p99: Math.round(percentile(validLatencies, 99))
  };
}

/**
 * Format statistics as a readable table row
 */
function formatStatsTable(network, stats) {
  return {
    Network: network,
    'Count': stats.count,
    'Failures': stats.failures,
    'ms/tx': stats.average,
    'tx/s': stats.txPerSecond,
    'Median (ms)': stats.median,
    'StdDev (ms)': stats.stdDev,
    'Min (ms)': stats.min,
    'Max (ms)': stats.max,
    'P90 (ms)': stats.p90,
    'P95 (ms)': stats.p95,
    'P99 (ms)': stats.p99
  };
}

module.exports = {
  average,
  median,
  standardDeviation,
  percentile,
  calculateStats,
  formatStatsTable
};
