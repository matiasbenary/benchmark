const { SuiClient, getFullnodeUrl } = require('@mysten/sui.js/client');
const { Ed25519Keypair } = require('@mysten/sui.js/keypairs/ed25519');
const { TransactionBlock } = require('@mysten/sui.js/transactions');
const { sleep, retry } = require('../utils/common');

/**
 * Send a single Sui transaction and measure finality time
 *
 * @param {SuiClient} client - Sui client instance
 * @param {Ed25519Keypair} keypair - Sender keypair
 * @param {string} toAddress - Recipient address
 * @param {string} amount - Amount in SUI
 * @returns {Object} Transaction result with timing data
 */
async function sendTransaction(client, keypair, toAddress, amount) {
  const sendTime = Date.now();

  try {
    // Convert amount to MIST (1 SUI = 1,000,000,000 MIST)
    const amountInMist = Math.floor(parseFloat(amount) * 1_000_000_000);

    // Create transaction
    const tx = new TransactionBlock();
    const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
    tx.transferObjects([coin], toAddress);

    // Sign and execute transaction
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      options: {
        showEffects: true
      }
    });

    // Wait for finality (transaction confirmed)
    await client.waitForTransactionBlock({
      digest: result.digest,
      options: {
        showEffects: true
      }
    });

    const finalTime = Date.now();
    const latency = finalTime - sendTime;

    return {
      txId: result.digest,
      sendTime,
      finalTime,
      latency,
      checkpoint: result.checkpoint,
      status: 'success'
    };
  } catch (error) {
    const finalTime = Date.now();
    return {
      txId: null,
      sendTime,
      finalTime,
      latency: finalTime - sendTime,
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Run Sui finality benchmark
 *
 * @param {Object} config - Configuration object
 * @param {string} config.rpcUrl - Sui RPC URL (optional, defaults to network)
 * @param {string} config.network - Network: devnet, testnet, or mainnet
 * @param {string} config.privateKey - Private key (base64 or hex string)
 * @param {string} config.toAddress - Recipient address
 * @param {number} config.numTxs - Number of transactions to send
 * @param {number} config.rate - Transactions per second
 * @param {string} config.amount - Amount per transaction in SUI
 * @returns {Array} Array of transaction results
 */
async function runBenchmark(config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Sui Finality Benchmark`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Network: ${config.network || 'devnet'}`);
  if (config.rpcUrl) {
    console.log(`RPC URL: ${config.rpcUrl}`);
  }
  console.log(`To Address: ${config.toAddress}`);
  console.log(`Transactions: ${config.numTxs}`);
  console.log(`Rate: ${config.rate} tx/s`);
  console.log(`Amount per tx: ${config.amount} SUI`);
  console.log(`${'='.repeat(60)}\n`);

  // Initialize Sui client
  console.log('Connecting to Sui...');

  const rpcUrl = config.rpcUrl || getFullnodeUrl(config.network || 'devnet');
  const client = new SuiClient({ url: rpcUrl });

  // Create keypair from private key
  // Support multiple formats: bech32, base64, hex
  let keypair;
  try {
    // Try using Ed25519Keypair.fromSecretKey which handles bech32 format (suiprivkey1...)
    const privateKey = config.privateKey.trim();

    // Method 1: Try as bech32 encoded key (most common from Sui CLI)
    // This handles formats like "suiprivkey1..." or just the bech32 string
    if (!privateKey.startsWith('0x') && !privateKey.includes(':')) {
      try {
        // The SDK's fromSecretKey expects just the secret bytes, not bech32
        // We need to decode bech32 manually or use a different method
        // Try treating it as a Sui bech32 private key by using decodeSuiPrivateKey
        const { decodeSuiPrivateKey } = require('@mysten/sui.js/cryptography');

        // Add prefix if missing (some tools output just the bech32 part without prefix)
        const fullKey = privateKey.startsWith('suiprivkey')
          ? privateKey
          : 'suiprivkey' + privateKey;

        const { schema, secretKey } = decodeSuiPrivateKey(fullKey);
        if (schema === 'ED25519') {
          keypair = Ed25519Keypair.fromSecretKey(secretKey);
        } else {
          throw new Error(`Unsupported key schema: ${schema}`);
        }
      } catch (bech32Error) {
        // If bech32 decoding fails, try as base64
        const buffer = Buffer.from(privateKey, 'base64');
        keypair = Ed25519Keypair.fromSecretKey(buffer);
      }
    }
    // Method 2: Handle "suiprivkey:..." or "ed25519:..." format
    else if (privateKey.includes(':')) {
      const keyPart = privateKey.split(':')[1];
      const buffer = Buffer.from(keyPart, 'base64');
      keypair = Ed25519Keypair.fromSecretKey(buffer);
    }
    // Method 3: Handle hex format (0x...)
    else if (privateKey.startsWith('0x')) {
      const buffer = Buffer.from(privateKey.slice(2), 'hex');
      keypair = Ed25519Keypair.fromSecretKey(buffer);
    }

    if (!keypair) {
      throw new Error('Could not parse private key with any supported format');
    }
  } catch (error) {
    throw new Error(`Invalid private key format: ${error.message}`);
  }

  const address = keypair.getPublicKey().toSuiAddress();
  console.log(`Account address: ${address}`);

  // Check balance
  try {
    const balance = await client.getBalance({
      owner: address
    });

    const balanceSui = Number(balance.totalBalance) / 1_000_000_000;
    console.log(`Account balance: ${balanceSui} SUI`);

    // Calculate cost estimate
    const totalAmount = parseFloat(config.amount) * config.numTxs;
    const estimatedGas = 0.001 * config.numTxs; // Rough estimate
    const totalCost = totalAmount + estimatedGas;

    console.log(`Estimated total cost: ~${totalCost.toFixed(6)} SUI`);
    console.log(`  (${totalAmount} SUI transfers + ~${estimatedGas.toFixed(6)} SUI gas)\n`);

    if (balanceSui < totalCost) {
      throw new Error(`Insufficient balance. Need ~${totalCost} SUI, have ${balanceSui} SUI`);
    }
  } catch (error) {
    console.warn(`Warning: Could not fetch balance: ${error.message}`);
  }

  console.log(`⚠️  NOTE: Sui has sub-second finality (~0.4-0.6s).\n`);

  // Rate limiting setup
  const delayMs = config.rate > 0 ? 1000 / config.rate : 0;

  // Send transactions
  const results = [];
  for (let i = 0; i < config.numTxs; i++) {
    console.log(`Sending transaction ${i + 1}/${config.numTxs}...`);

    try {
      const result = await retry(
        () => sendTransaction(client, keypair, config.toAddress, config.amount),
        3,
        2000
      );

      results.push(result);

      if (result.status === 'success') {
        console.log(`  ✓ Finalized in ${(result.latency / 1000).toFixed(2)}s`);
        console.log(`    Checkpoint: ${result.checkpoint || 'N/A'}`);
        console.log(`    TX: ${result.txId}`);
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
      }
    } catch (error) {
      console.log(`  ✗ Failed after retries: ${error.message}`);
      results.push({
        txId: null,
        sendTime: Date.now(),
        finalTime: Date.now(),
        latency: null,
        status: 'failed',
        error: error.message
      });
    }

    // Rate limiting
    if (i < config.numTxs - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log(`\n✓ Sui benchmark completed\n`);
  return results;
}

module.exports = {
  runBenchmark
};
