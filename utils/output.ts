/**
 * Output formatting utilities for JSON and CSV export
 */

import fs from 'fs';
import path from 'path';
import { calculateStats, formatStatsTable, Stats, StatsTableRow } from './stats.js';

export interface TransactionResult {
  txId: string | null;
  sendTime: number;
  finalTime: number;
  latency: number | null;
  status: 'success' | 'failed';
  error?: string;
  blockHash?: string;
  blockNumber?: bigint | number;
  confirmations?: number;
  miningLatency?: number;
  version?: string;
  gasUsed?: string;
  blockTime?: number;
  slot?: number;
  checkpoint?: string;
}

export interface NetworkResult {
  config: any;
  stats: Stats;
  results: TransactionResult[];
}

export interface NetworkResults {
  [network: string]: NetworkResult;
}

export interface JSONOutput {
  timestamp: string;
  networks: {
    [network: string]: {
      config: any;
      stats: Stats;
      results: TransactionResult[];
    };
  };
}

/**
 * Convert results to CSV format
 */
export function resultsToCSV(results: TransactionResult[], network: string): string {
  const headers = [
    'network',
    'tx_id',
    'send_time',
    'final_time',
    'latency_ms',
    'status',
    'error'
  ];

  const rows = results.map(r => [
    network,
    r.txId || 'N/A',
    new Date(r.sendTime).toISOString(),
    new Date(r.finalTime).toISOString(),
    r.latency || 'N/A',
    r.status,
    r.error || ''
  ]);

  const csvLines = [
    headers.join(','),
    ...rows.map(row => row.map(cell => {
      // Escape commas and quotes in CSV
      const str = String(cell);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(','))
  ];

  return csvLines.join('\n');
}

/**
 * Write results to JSON file
 */
export async function writeJSON(filePath: string, data: JSONOutput): Promise<void> {
  const dir = path.dirname(filePath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write JSON with pretty formatting
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`✓ JSON output written to: ${filePath}`);
}

/**
 * Write results to CSV file
 */
export async function writeCSV(filePath: string, csvContent: string): Promise<void> {
  const dir = path.dirname(filePath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, csvContent);
  console.log(`✓ CSV output written to: ${filePath}`);
}

/**
 * Append to CSV file (for streaming results from multiple networks)
 */
export async function appendCSV(
  filePath: string,
  csvContent: string,
  includeHeader: boolean = false
): Promise<void> {
  const dir = path.dirname(filePath);

  // Create directory if it doesn't exist
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = csvContent.split('\n');
  const content = includeHeader ? csvContent : lines.slice(1).join('\n');

  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, '\n' + content);
  } else {
    fs.writeFileSync(filePath, csvContent);
  }
}

/**
 * Save benchmark results to files
 */
export async function saveResults(
  networkResults: NetworkResults,
  outputPath?: string
): Promise<void> {
  if (!outputPath) {
    console.log('\nNo output path specified, skipping file export.');
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const basePath = outputPath.replace(/\.(json|csv)$/, '');

  // Prepare JSON output
  const jsonData: JSONOutput = {
    timestamp: new Date().toISOString(),
    networks: {}
  };

  // Prepare CSV output
  let csvContent = '';
  let firstNetwork = true;

  for (const [network, data] of Object.entries(networkResults)) {
    // Add to JSON
    jsonData.networks[network] = {
      config: data.config,
      stats: data.stats,
      results: data.results
    };

    // Add to CSV
    const networkCSV = resultsToCSV(data.results, network);
    if (firstNetwork) {
      csvContent = networkCSV;
      firstNetwork = false;
    } else {
      // Append without header
      const lines = networkCSV.split('\n');
      csvContent += '\n' + lines.slice(1).join('\n');
    }
  }

  // Write files
  const jsonPath = `${basePath}-${timestamp}.json`;
  const csvPath = `${basePath}-${timestamp}.csv`;

  await writeJSON(jsonPath, jsonData);
  await writeCSV(csvPath, csvContent);

  console.log('');
}

/**
 * Print results summary table to console
 */
export function printSummaryTable(summaryData: StatsTableRow[]): void {
  console.log('\n' + '='.repeat(120));
  console.log('FINALITY BENCHMARK SUMMARY');
  console.log('='.repeat(120));

  // Calculate column widths
  const headers = [
    'Network',
    'Count',
    'Failures',
    'ms/tx',
    'tx/s',
    'Median (ms)',
    'StdDev (ms)',
    'Min (ms)',
    'Max (ms)',
    'P90 (ms)',
    'P95 (ms)',
    'P99 (ms)'
  ];

  const colWidths = headers.map((h, i) => {
    const dataWidth = Math.max(
      ...summaryData.map(row => String(Object.values(row)[i] || '').length)
    );
    return Math.max(h.length, dataWidth) + 2;
  });

  // Print header
  const headerRow = headers.map((h, i) => h.padEnd(colWidths[i])).join('');
  console.log(headerRow);
  console.log('-'.repeat(120));

  // Print data rows
  for (const row of summaryData) {
    const values = Object.values(row);
    const dataRow = values.map((v, i) => String(v).padEnd(colWidths[i])).join('');
    console.log(dataRow);
  }

  console.log('='.repeat(120) + '\n');
}

// Re-export for convenience
export { calculateStats, formatStatsTable };
