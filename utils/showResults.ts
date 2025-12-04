#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { calculateStats, Stats } from './stats.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface NetworkStats {
  [network: string]: Stats;
}

interface CSVNetworkData {
  latencies: number[];
  failures: number;
}

interface JSONNetworkData {
  stats: Stats;
}

function readCSV(filePath: string): NetworkStats {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');

  const results: { [network: string]: CSVNetworkData } = {};

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const network = values[0];
    const latency = parseInt(values[4]);
    const status = values[5];

    if (!results[network]) {
      results[network] = {
        latencies: [],
        failures: 0
      };
    }

    if (status === 'success') {
      results[network].latencies.push(latency);
    } else {
      results[network].failures++;
    }
  }

  const stats: NetworkStats = {};
  for (const [network, data] of Object.entries(results)) {
    stats[network] = calculateStats(data.latencies, data.failures);
  }

  return stats;
}

function readJSON(filePath: string): NetworkStats {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  const stats: NetworkStats = {};

  for (const [network, networkData] of Object.entries(data.networks)) {
    stats[network] = (networkData as JSONNetworkData).stats;
  }

  return stats;
}

function displayTable(stats: NetworkStats, fileName: string): void {
  const separator = '='.repeat(120);
  const lineSeparator = '-'.repeat(120);

  console.log(separator);
  console.log('FINALITY BENCHMARK SUMMARY');
  console.log(separator);

  // Header
  const header = 'Network  Count  Failures  ms/tx     tx/s      Median (ms)  StdDev (ms)  Min (ms)  Max (ms)  P90 (ms)  P95 (ms)  P99 (ms)';
  console.log(header);
  console.log(lineSeparator);

  // Data rows
  for (const [network, data] of Object.entries(stats)) {
    const row = [
      network.toUpperCase().padEnd(8),
      String(data.count).padEnd(6),
      String(data.failures).padEnd(9),
      String(data.average).padEnd(9),
      String(data.txPerSecond || 0).padEnd(9),
      String(data.median).padEnd(12),
      String(data.stdDev).padEnd(12),
      String(data.min).padEnd(9),
      String(data.max).padEnd(9),
      String(data.p90).padEnd(9),
      String(data.p95).padEnd(9),
      String(data.p99).padEnd(9)
    ].join(' ');

    console.log(row);
  }

  console.log(separator);
  console.log('');
}

function listAvailableFiles(): string[] {
  const resultsDir = path.join(__dirname, 'results');

  if (!fs.existsSync(resultsDir)) {
    console.log('Directory "results" not found');
    return [];
  }

  const files = fs.readdirSync(resultsDir)
    .filter(f => f.endsWith('.json') || f.endsWith('.csv'))
    .sort()
    .reverse(); // Most recent first

  return files;
}

// Main
function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('\nUsage: node showResults.js [file]');
    console.log('\nAvailable files in ./results:');

    const files = listAvailableFiles();

    if (files.length === 0) {
      console.log('  (no files found)');
      process.exit(1);
    }

    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const csvFiles = files.filter(f => f.endsWith('.csv'));

    if (jsonFiles.length > 0) {
      console.log('\n  JSON Files:');
      jsonFiles.forEach((f, i) => {
        console.log(`    ${i + 1}. ${f}`);
      });
    }

    if (csvFiles.length > 0) {
      console.log('\n  CSV Files:');
      csvFiles.forEach((f, i) => {
        console.log(`    ${i + 1}. ${f}`);
      });
    }

    console.log('\nExamples:');
    console.log(`  node showResults.js results/${files[0]}`);
    console.log('  node showResults.js results/benchmark-2025-12-03T16-46-51-035Z.json');
    console.log('\nTo show the most recent:');
    console.log(`  node showResults.js results/${files[0]}`);
    console.log('');
    process.exit(1);
  }

  const filePath = args[0];

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File "${filePath}" does not exist`);
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  let stats: NetworkStats;

  if (ext === '.json') {
    stats = readJSON(filePath);
  } else if (ext === '.csv') {
    stats = readCSV(filePath);
  } else {
    console.error('Error: File must be .json or .csv');
    process.exit(1);
  }

  displayTable(stats, fileName);
}

main();
