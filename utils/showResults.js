#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Función para calcular estadísticas desde un array de latencias
function calculateStats(latencies) {
  if (latencies.length === 0) return null;

  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / sorted.length;

  // Mediana
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];

  // Desviación estándar
  const variance = sorted.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / sorted.length;
  const stdDev = Math.sqrt(variance);

  // Percentiles
  const percentile = (p) => {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[index];
  };

  const txPerSecond = avg > 0 ? 1000 / avg : 0;

  return {
    count: sorted.length,
    average: Math.round(avg),
    txPerSecond: Math.round(txPerSecond * 100) / 100,
    median: Math.round(median),
    stdDev: Math.round(stdDev),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99)
  };
}

// Función para leer CSV
function readCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  const headers = lines[0].split(',');

  const results = {};

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

  // Calcular estadísticas para cada red
  const stats = {};
  for (const [network, data] of Object.entries(results)) {
    stats[network] = {
      ...calculateStats(data.latencies),
      failures: data.failures
    };
  }

  return stats;
}

// Función para leer JSON
function readJSON(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  const stats = {};

  for (const [network, networkData] of Object.entries(data.networks)) {
    stats[network] = networkData.stats;
  }

  return stats;
}

// Función para mostrar tabla
function displayTable(stats, fileName) {
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

// Función para listar archivos disponibles
function listAvailableFiles() {
  const resultsDir = path.join(__dirname, 'results');

  if (!fs.existsSync(resultsDir)) {
    console.log('No se encontró el directorio "results"');
    return [];
  }

  const files = fs.readdirSync(resultsDir)
    .filter(f => f.endsWith('.json') || f.endsWith('.csv'))
    .sort()
    .reverse(); // Más recientes primero

  return files;
}

// Main
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('\nUso: node showResults.js [archivo]');
    console.log('\nArchivos disponibles en ./results:');

    const files = listAvailableFiles();

    if (files.length === 0) {
      console.log('  (ningún archivo encontrado)');
      process.exit(1);
    }

    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const csvFiles = files.filter(f => f.endsWith('.csv'));

    if (jsonFiles.length > 0) {
      console.log('\n  Archivos JSON:');
      jsonFiles.forEach((f, i) => {
        console.log(`    ${i + 1}. ${f}`);
      });
    }

    if (csvFiles.length > 0) {
      console.log('\n  Archivos CSV:');
      csvFiles.forEach((f, i) => {
        console.log(`    ${i + 1}. ${f}`);
      });
    }

    console.log('\nEjemplos:');
    console.log(`  node showResults.js results/${files[0]}`);
    console.log('  node showResults.js results/benchmark-2025-12-03T16-46-51-035Z.json');
    console.log('\nPara mostrar el más reciente:');
    console.log(`  node showResults.js results/${files[0]}`);
    console.log('');
    process.exit(1);
  }

  const filePath = args[0];

  if (!fs.existsSync(filePath)) {
    console.error(`Error: El archivo "${filePath}" no existe`);
    process.exit(1);
  }

  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath);

  let stats;

  if (ext === '.json') {
    stats = readJSON(filePath);
  } else if (ext === '.csv') {
    stats = readCSV(filePath);
  } else {
    console.error('Error: El archivo debe ser .json o .csv');
    process.exit(1);
  }

  displayTable(stats, fileName);
}

main();
