const {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL
} = require('@solana/web3.js');
const { sleep, retry } = require('../utils/common');

/**
 * Parse Solana private key from various formats
 */
function parsePrivateKey(privateKey) {
  try {
    // Try parsing as JSON array
    const secretKey = JSON.parse(privateKey);
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch {
    // Try parsing as base58 string
    try {
      const bs58 = require('bs58');
      const decoded = bs58.decode(privateKey);
      return Keypair.fromSecretKey(decoded);
    } catch {
      throw new Error('Invalid private key format. Expected JSON array [1,2,3...] or base58 string');
    }
  }
}

/**
 * Send a single Solana transaction and measure finality time
 *
 * @param {Connection} connection - Solana connection
 * @param {Keypair} payer - Payer keypair
 * @param {PublicKey} toPublicKey - Recipient public key
 * @param {number} lamports - Amount in lamports
 * @returns {Object} Transaction result with timing data
 */
async function sendTransaction(connection, payer, toPublicKey, lamports) {
  const sendTime = Date.now();

  try {
    // Create transfer instruction
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: toPublicKey,
        lamports: lamports
      })
    );

    // Send and confirm with finalized commitment
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [payer],
      {
        commitment: 'finalized',
        preflightCommitment: 'finalized'
      }
    );

    const finalTime = Date.now();
    const latency = finalTime - sendTime;

    // Get transaction details
    const txDetails = await connection.getTransaction(signature, {
      commitment: 'finalized'
    });

    return {
      txId: signature,
      sendTime,
      finalTime,
      latency,
      blockTime: txDetails?.blockTime,
      slot: txDetails?.slot,
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
 * Send transactions in parallel and wait for finality
 */
async function sendTransactionsParallel(connection, payer, toPublicKey, lamports, numTxs, rate) {
  const delayMs = rate > 0 ? 1000 / rate : 0;

  console.log('\nSending transactions...');

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  // Send all transactions without waiting for finality
  const txPromises = [];
  for (let i = 0; i < numTxs; i++) {
    const sendTime = Date.now();

    const txPromise = (async () => {
      try {
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: toPublicKey,
            lamports: lamports
          })
        );

        transaction.recentBlockhash = blockhash;
        transaction.lastValidBlockHeight = lastValidBlockHeight;
        transaction.feePayer = payer.publicKey;

        // Sign and send (but don't wait for confirmation yet)
        transaction.sign(payer);
        const signature = await connection.sendRawTransaction(transaction.serialize());

        return {
          signature,
          sendTime,
          index: i,
          status: 'sent'
        };
      } catch (error) {
        return {
          signature: null,
          sendTime,
          index: i,
          status: 'failed',
          error: error.message
        };
      }
    })();

    txPromises.push(txPromise);
    console.log(`  [${i + 1}/${numTxs}] Sent`);

    // Rate limiting for sending phase
    if (i < numTxs - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log('\nWaiting for all transactions to be sent...');
  const sentTxs = await Promise.all(txPromises);

  console.log('\nWaiting for finality...');

  // Now wait for each transaction to reach finalized commitment
  const results = await Promise.all(
    sentTxs.map(async ({ signature, sendTime, index, status, error }) => {
      if (status === 'failed') {
        return {
          txId: null,
          sendTime,
          finalTime: Date.now(),
          latency: null,
          status: 'failed',
          error
        };
      }

      try {
        await connection.confirmTransaction(signature, 'finalized');
        const finalTime = Date.now();
        const latency = finalTime - sendTime;

        // Get transaction details
        const txDetails = await connection.getTransaction(signature, {
          commitment: 'finalized'
        });

        console.log(`  [${index + 1}/${numTxs}] ✓ Finalized in ${(latency / 1000).toFixed(2)}s`);

        return {
          txId: signature,
          sendTime,
          finalTime,
          latency,
          blockTime: txDetails?.blockTime,
          slot: txDetails?.slot,
          status: 'success'
        };
      } catch (error) {
        const finalTime = Date.now();
        console.log(`  [${index + 1}/${numTxs}] ✗ Failed: ${error.message}`);
        return {
          txId: signature,
          sendTime,
          finalTime,
          latency: finalTime - sendTime,
          status: 'failed',
          error: error.message
        };
      }
    })
  );

  return results;
}

/**
 * Run Solana finality benchmark
 *
 * @param {Object} config - Configuration object
 * @param {string} config.rpcUrl - Solana RPC URL
 * @param {string} config.privateKey - Private key (JSON array or base58)
 * @param {string} config.toAddress - Recipient address (base58 public key)
 * @param {number} config.numTxs - Number of transactions to send
 * @param {number} config.rate - Transactions per second
 * @param {string} config.amount - Amount per transaction in SOL
 * @param {boolean} config.parallel - Whether to send transactions in parallel
 * @returns {Array} Array of transaction results
 */
async function runBenchmark(config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Solana Finality Benchmark`);
  console.log(`${'='.repeat(60)}`);
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`To Address: ${config.toAddress}`);
  console.log(`Transactions: ${config.numTxs}`);
  console.log(`Mode: ${config.parallel ? 'PARALLEL' : 'sequential'}`);
  console.log(`Rate: ${config.rate} tx/s`);
  console.log(`Amount per tx: ${config.amount} SOL`);
  console.log(`Commitment: finalized`);
  console.log(`${'='.repeat(60)}\n`);

  // Initialize connection
  console.log('Connecting to Solana...');
  const connection = new Connection(config.rpcUrl, 'finalized');

  // Parse keypair
  let payer;
  try {
    payer = parsePrivateKey(config.privateKey);
  } catch (error) {
    throw new Error(`Failed to parse private key: ${error.message}`);
  }

  console.log(`Wallet address: ${payer.publicKey.toBase58()}`);

  // Parse recipient public key
  const { PublicKey } = require('@solana/web3.js');
  const toPublicKey = new PublicKey(config.toAddress);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  const balanceSol = balance / LAMPORTS_PER_SOL;
  console.log(`Wallet balance: ${balanceSol} SOL`);

  // Calculate cost estimate
  const amountLamports = Math.floor(parseFloat(config.amount) * LAMPORTS_PER_SOL);
  const totalAmount = parseFloat(config.amount) * config.numTxs;
  const estimatedFees = 0.000005 * config.numTxs; // ~5000 lamports per tx
  const totalCost = totalAmount + estimatedFees;

  console.log(`Estimated total cost: ~${totalCost.toFixed(6)} SOL`);
  console.log(`  (${totalAmount} SOL transfers + ~${estimatedFees} SOL fees)\n`);

  if (balanceSol < totalCost) {
    throw new Error(`Insufficient balance. Need ~${totalCost.toFixed(6)} SOL, have ${balanceSol} SOL`);
  }

  console.log(`⚠️  NOTE: Solana finalized commitment waits for 2/3 supermajority.`);
  console.log(`   Expected finality: ~13-15 seconds.\n`);

  // Execute in parallel or sequential mode
  let results;

  if (config.parallel) {
    // Parallel mode: send all transactions, then wait for finality
    results = await sendTransactionsParallel(
      connection,
      payer,
      toPublicKey,
      amountLamports,
      config.numTxs,
      config.rate
    );
  } else {
    // Sequential mode: send one, wait for finality, repeat
    const delayMs = config.rate > 0 ? 1000 / config.rate : 0;

    results = [];
    for (let i = 0; i < config.numTxs; i++) {
      console.log(`Sending transaction ${i + 1}/${config.numTxs}...`);

      try {
        const result = await retry(
          () => sendTransaction(connection, payer, toPublicKey, amountLamports),
          3,
          2000
        );

        results.push(result);

        if (result.status === 'success') {
          console.log(`  ✓ Finalized in ${(result.latency / 1000).toFixed(2)}s`);
          console.log(`    Slot: ${result.slot}, TX: ${result.txId}`);
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
  }

  console.log(`\n✓ Solana benchmark completed\n`);
  return results;
}

module.exports = {
  runBenchmark
};
