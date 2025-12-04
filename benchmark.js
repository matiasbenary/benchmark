#!/usr/bin/env node

/**
 * Multi-chain Finality Benchmarking Tool
 *
 * Benchmarks transaction finality times across multiple blockchains.
 * Supports configurable transaction counts, rate limiting, and statistical analysis.
 *
 * Usage:
 *   node benchmark.js --network near --txs 50 --rate 1
 *   node benchmark.js --network all --txs 10
 */

require('dotenv').config();
const { Command } = require('commander');
const { calculateStats, formatStatsTable } = require('./utils/stats');
const { saveResults, printSummaryTable } = require('./utils/output');

// Import network modules
const nearModule = require('./lib/near');
const solanaModule = require('./lib/solana');
const aptosModule = require('./lib/aptos');
const suiModule = require('./lib/sui');
const evmModule = require('./lib/evm');

// Network registry with configurations
const NETWORKS = {
  near: {
    type: 'custom',
    module: nearModule,
    envPrefix: 'NEAR',
    requiredEnvVars: ['ACCOUNT_ID', 'PRIVATE_KEY'],
    optionalEnvVars: { receiverId: 'RECEIVER_ID', amount: '0.01' },
    customConfig: (env) => ({
      networkId: env.NEAR_NETWORK_ID || 'testnet',
      nodeUrl: env.NEAR_RPC_URL || 'https://near-testnet.api.pagoda.co/rpc/v1/',
      accountId: env.NEAR_ACCOUNT_ID,
      privateKey: env.NEAR_PRIVATE_KEY,
      receiverId: env.NEAR_RECEIVER_ID || env.NEAR_ACCOUNT_ID,
      amount: env.NEAR_AMOUNT || '0.01'
    })
  },
  ethereum: {
    type: 'evm',
    module: evmModule,
    displayName: 'Ethereum',
    blockTime: 12,
    defaultConfirmations: 12,
    defaultRpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    defaultAmount: '0.0001'
  },
  arbitrum: {
    type: 'evm',
    module: evmModule,
    displayName: 'Arbitrum',
    blockTime: 0.25,
    defaultConfirmations: 2,
    defaultRpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    defaultAmount: '0.0001'
  },
  base: {
    type: 'evm',
    module: evmModule,
    displayName: 'Base',
    blockTime: 2,
    defaultConfirmations: 2,
    defaultRpcUrl: 'https://sepolia.base.org',
    defaultAmount: '0.0001'
  },
  optimism: {
    type: 'evm',
    module: evmModule,
    displayName: 'Optimism',
    blockTime: 2,
    defaultConfirmations: 2,
    defaultRpcUrl: 'https://sepolia.optimism.io',
    defaultAmount: '0.0001'
  },
  polygon: {
    type: 'evm',
    module: evmModule,
    displayName: 'Polygon',
    blockTime: 2,
    defaultConfirmations: 64,
    defaultRpcUrl: 'https://rpc-amoy.polygon.technology',
    defaultAmount: '0.01'
  },
  avalanche: {
    type: 'evm',
    module: evmModule,
    displayName: 'Avalanche',
    blockTime: 2,
    defaultConfirmations: 1,
    defaultRpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    defaultAmount: '0.01'
  },
  bsc: {
    type: 'evm',
    module: evmModule,
    displayName: 'BSC',
    blockTime: 3,
    defaultConfirmations: 15,
    defaultRpcUrl: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    defaultAmount: '0.001'
  },
  zksync: {
    type: 'evm',
    module: evmModule,
    displayName: 'zkSync',
    blockTime: 1,
    defaultConfirmations: 1,
    defaultRpcUrl: 'https://sepolia.era.zksync.dev',
    defaultAmount: '0.0001'
  },
  'polygon-zkevm': {
    type: 'evm',
    module: evmModule,
    displayName: 'Polygon zkEVM',
    blockTime: 1,
    defaultConfirmations: 1,
    defaultRpcUrl: 'https://rpc.cardona.zkevm-rpc.com',
    defaultAmount: '0.0001'
  },
  solana: {
    type: 'custom',
    module: solanaModule,
    envPrefix: 'SOL',
    requiredEnvVars: ['PRIVATE_KEY', 'TO_ADDRESS'],
    customConfig: (env) => ({
      rpcUrl: env.SOL_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=public',
      privateKey: env.SOL_PRIVATE_KEY,
      toAddress: env.SOL_TO_ADDRESS,
      amount: env.SOL_AMOUNT || '0.001'
    })
  },
  aptos: {
    type: 'custom',
    module: aptosModule,
    envPrefix: 'APTOS',
    requiredEnvVars: ['PRIVATE_KEY', 'TO_ADDRESS'],
    customConfig: (env) => ({
      rpcUrl: env.APTOS_RPC_URL,
      network: env.APTOS_NETWORK || 'devnet',
      privateKey: env.APTOS_PRIVATE_KEY,
      toAddress: env.APTOS_TO_ADDRESS,
      amount: env.APTOS_AMOUNT || '0.01'
    })
  },
  sui: {
    type: 'custom',
    module: suiModule,
    envPrefix: 'SUI',
    requiredEnvVars: ['PRIVATE_KEY', 'TO_ADDRESS'],
    customConfig: (env) => ({
      rpcUrl: env.SUI_RPC_URL,
      network: env.SUI_NETWORK || 'devnet',
      privateKey: env.SUI_PRIVATE_KEY,
      toAddress: env.SUI_TO_ADDRESS,
      amount: env.SUI_AMOUNT || '0.01'
    })
  }
};

// Configure CLI
const program = new Command();

program
  .name('benchmark')
  .description('Multi-chain finality benchmarking tool')
  .version('2.0.0')
  .option('-n, --network <network>', `Network to benchmark (${Object.keys(NETWORKS).join('|')}|all)`, 'all')
  .option('-t, --txs <number>', 'Number of transactions to send', '10')
  .option('-r, --rate <number>', 'Transactions per second (0 = no limit)', '1')
  .option('-c, --confirmations <number>', 'Confirmations for EVM chains (default: varies by network)')
  .option('-p, --parallel', 'Send transactions in parallel mode (measure finality under load)')
  .option('-o, --out <path>', 'Output file path (without extension, will create .json and .csv)', './results/benchmark')
  .option('--no-confirm', 'Skip confirmation prompt (dangerous for mainnet!)')
  .parse(process.argv);

const options = program.opts();

/**
 * Load configuration from environment variables
 */
function loadConfig() {
  const config = {};

  // EVM defaults
  const evmDefaults = {
    privateKey: process.env.ETH_PRIVATE_KEY,
    toAddress: process.env.ETH_TO_ADDRESS
  };

  for (const [networkName, networkInfo] of Object.entries(NETWORKS)) {
    if (networkInfo.type === 'evm') {
      const envPrefix = networkName.toUpperCase().replace(/-/g, '_');
      config[networkName] = {
        rpcUrl: process.env[`${envPrefix}_RPC_URL`] || networkInfo.defaultRpcUrl,
        privateKey: process.env[`${envPrefix}_PRIVATE_KEY`] || evmDefaults.privateKey,
        toAddress: process.env[`${envPrefix}_TO_ADDRESS`] || evmDefaults.toAddress,
        amount: process.env[`${envPrefix}_AMOUNT`] || networkInfo.defaultAmount,
        confirmations: options.confirmations ? parseInt(options.confirmations) : networkInfo.defaultConfirmations
      };
    } else if (networkInfo.customConfig) {
      config[networkName] = networkInfo.customConfig(process.env);
    }
  }

  return config;
}

/**
 * Validate configuration for a specific network
 */
function validateConfig(network, config) {
  const networkInfo = NETWORKS[network];
  if (!networkInfo) return ['Unknown network'];

  const missing = [];

  if (networkInfo.type === 'evm') {
    if (!config.privateKey) {
      const envPrefix = network.toUpperCase().replace(/-/g, '_');
      missing.push(`${envPrefix}_PRIVATE_KEY (or ETH_PRIVATE_KEY)`);
    }
    if (!config.toAddress) {
      const envPrefix = network.toUpperCase().replace(/-/g, '_');
      missing.push(`${envPrefix}_TO_ADDRESS (or ETH_TO_ADDRESS)`);
    }
  } else if (networkInfo.requiredEnvVars) {
    for (const envVar of networkInfo.requiredEnvVars) {
      const fullEnvVar = `${networkInfo.envPrefix}_${envVar}`;
      if (!process.env[fullEnvVar]) {
        missing.push(fullEnvVar);
      }
    }
  }

  return missing;
}

/**
 * Show safety warning and get user confirmation
 */
async function showWarningAndConfirm(networks, numTxs) {
  console.log('\n' + '='.repeat(80));
  console.log('⚠️  WARNING: REAL TRANSACTIONS WITH REAL FEES');
  console.log('='.repeat(80));
  console.log(`You are about to send ${numTxs} transaction(s) per network.`);
  console.log(`Networks: ${networks.join(', ')}`);
  console.log('\nThis will incur REAL costs (gas fees + transfer amounts).');
  console.log('Make sure you are using TESTNET accounts with small amounts.');
  console.log('\nNEVER use mainnet private keys unless you understand the costs!');
  console.log('='.repeat(80) + '\n');

  if (!options.confirm) {
    console.log('Skipping confirmation (--no-confirm flag set)\n');
    return;
  }

  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question('Type "yes" to proceed: ', (answer) => {
      readline.close();
      if (answer.toLowerCase() !== 'yes') {
        console.log('Aborted.');
        process.exit(0);
      }
      console.log('');
      resolve();
    });
  });
}

/**
 * Run benchmark for a single network
 */
async function runNetworkBenchmark(network, config, numTxs, rate, parallel = false) {
  const networkInfo = NETWORKS[network];
  if (!networkInfo) {
    throw new Error(`Unknown network: ${network}`);
  }

  const networkConfig = {
    ...config,
    numTxs,
    rate,
    parallel
  };

  let results;
  if (networkInfo.type === 'evm') {
    results = await networkInfo.module.runBenchmark(
      networkConfig,
      networkInfo.displayName,
      networkInfo.blockTime
    );
  } else {
    results = await networkInfo.module.runBenchmark(networkConfig);
  }

  // Calculate statistics
  const latencies = results
    .filter(r => r.status === 'success')
    .map(r => r.latency);

  const failures = results.filter(r => r.status === 'failed').length;
  const stats = calculateStats(latencies, failures);

  return {
    config: networkConfig,
    results,
    stats
  };
}

/**
 * Main function
 */
async function main() {
  const numTxs = parseInt(options.txs);
  const rate = parseFloat(options.rate);
  const network = options.network.toLowerCase();

  // Determine which networks to run
  const allNetworks = Object.keys(NETWORKS);
  const networksToRun = network === 'all' ? allNetworks : [network];

  // Validate network selection
  for (const net of networksToRun) {
    if (!allNetworks.includes(net)) {
      console.error(`Error: Unknown network "${net}". Valid options: ${allNetworks.join(', ')}, all`);
      process.exit(1);
    }
  }

  // Load configuration
  const config = loadConfig();

  // Validate configuration for selected networks
  const configErrors = {};
  for (const net of networksToRun) {
    const missing = validateConfig(net, config[net]);
    if (missing.length > 0) {
      configErrors[net] = missing;
    }
  }

  if (Object.keys(configErrors).length > 0) {
    console.error('\n❌ Configuration Error: Missing required environment variables\n');
    for (const [net, missing] of Object.entries(configErrors)) {
      console.error(`${net.toUpperCase()}:`);
      missing.forEach(m => console.error(`  - ${m}`));
      console.error('');
    }
    console.error('Please set these variables in your .env file or environment.\n');
    process.exit(1);
  }

  // Show warning and get confirmation
  await showWarningAndConfirm(networksToRun, numTxs);

  console.log('Starting benchmark...\n');
  console.log(`Configuration:`);
  console.log(`  Networks: ${networksToRun.join(', ')}`);
  console.log(`  Transactions per network: ${numTxs}`);
  console.log(`  Mode: ${options.parallel ? 'PARALLEL' : 'sequential'}`);
  console.log(`  Rate limit: ${rate > 0 ? rate + ' tx/s' : 'unlimited'}`);
  console.log(`  Output: ${options.out || 'none'}\n`);

  // Run benchmarks
  const networkResults = {};
  const summaryData = [];

  for (const net of networksToRun) {
    try {
      const result = await runNetworkBenchmark(net, config[net], numTxs, rate, options.parallel);
      networkResults[net] = result;

      // Add to summary
      summaryData.push(formatStatsTable(net.toUpperCase(), result.stats));
    } catch (error) {
      console.error(`\n❌ Error running ${net} benchmark: ${error.message}\n`);
      if (error.stack) {
        console.error(error.stack);
      }
    }
  }

  // Print summary table
  if (summaryData.length > 0) {
    printSummaryTable(summaryData);
  }

  // Save results to files
  if (options.out) {
    try {
      await saveResults(networkResults, options.out);
    } catch (error) {
      console.error(`\n❌ Error saving results: ${error.message}\n`);
    }
  }

  console.log('✓ All benchmarks completed!\n');
}

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('\n❌ Fatal error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}

module.exports = { main };
