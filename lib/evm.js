const { ethers } = require('ethers');
const { sleep, retry } = require('../utils/common');

/**
 * Send a single EVM transaction and measure finality time
 *
 * @param {ethers.Wallet} wallet - Ethers wallet instance
 * @param {string} toAddress - Recipient address
 * @param {string} amount - Amount in native currency
 * @param {number} confirmations - Number of confirmations to wait for
 * @returns {Object} Transaction result with timing data
 */
async function sendTransaction(wallet, toAddress, amount, confirmations) {
  const sendTime = Date.now();

  try {
    // Create and send transaction
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: ethers.parseEther(amount)
    });

    // Wait for transaction to be mined (1 confirmation)
    const minedReceipt = await tx.wait(1);
    const minedTime = Date.now();

    // Wait for additional confirmations
    const finalReceipt = await tx.wait(confirmations);
    const finalTime = Date.now();

    const latency = finalTime - sendTime;
    const miningLatency = minedTime - sendTime;

    return {
      txId: tx.hash,
      sendTime,
      finalTime,
      latency,
      miningLatency,
      confirmations,
      blockNumber: finalReceipt.blockNumber,
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
 *
 * @param {ethers.Wallet} wallet - Ethers wallet instance
 * @param {string} toAddress - Recipient address
 * @param {string} amount - Amount in native currency
 * @param {number} confirmations - Number of confirmations to wait for
 * @param {number} numTxs - Number of transactions to send
 * @param {number} rate - Transactions per second (for sending phase)
 * @returns {Array} Transaction results with timing data
 */
async function sendTransactionsParallel(wallet, toAddress, amount, confirmations, numTxs, rate) {
  const delayMs = rate > 0 ? 1000 / rate : 0;

  // Get current nonce
  const startNonce = await wallet.getNonce();
  console.log(`Starting nonce: ${startNonce}\n`);

  // Prepare all transactions with sequential nonces
  const txPromises = [];
  const sendTimes = [];

  console.log('Sending transactions...');
  for (let i = 0; i < numTxs; i++) {
    const nonce = startNonce + i;
    const sendTime = Date.now();
    sendTimes.push(sendTime);

    // Create and send transaction (don't wait for confirmation yet)
    const txPromise = wallet.sendTransaction({
      to: toAddress,
      value: ethers.parseEther(amount),
      nonce: nonce
    }).then(tx => ({ tx, sendTime, index: i }));

    txPromises.push(txPromise);
    console.log(`  [${i + 1}/${numTxs}] Sent (nonce: ${nonce})`);

    // Rate limiting for sending phase
    if (i < numTxs - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log('\nWaiting for all transactions to be sent...');
  const sentTxs = await Promise.all(txPromises);

  console.log('\nWaiting for finality...');

  // Now wait for each transaction to reach finality
  const results = await Promise.all(
    sentTxs.map(async ({ tx, sendTime, index }) => {
      try {
        // Wait for mining (1 confirmation)
        const minedReceipt = await tx.wait(1);
        const minedTime = Date.now();

        // Wait for additional confirmations
        const finalReceipt = await tx.wait(confirmations);
        const finalTime = Date.now();

        const latency = finalTime - sendTime;
        const miningLatency = minedTime - sendTime;

        console.log(`  [${index + 1}/${numTxs}] ✓ Finalized in ${(latency / 1000).toFixed(2)}s`);

        return {
          txId: tx.hash,
          sendTime,
          finalTime,
          latency,
          miningLatency,
          confirmations,
          blockNumber: finalReceipt.blockNumber,
          status: 'success'
        };
      } catch (error) {
        const finalTime = Date.now();
        console.log(`  [${index + 1}/${numTxs}] ✗ Failed: ${error.message}`);
        return {
          txId: tx.hash,
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
 * Run EVM finality benchmark
 *
 * @param {Object} config - Configuration object
 * @param {string} config.rpcUrl - EVM RPC URL
 * @param {string} config.privateKey - Private key for the wallet
 * @param {string} config.toAddress - Recipient address
 * @param {number} config.numTxs - Number of transactions to send
 * @param {number} config.rate - Transactions per second
 * @param {string} config.amount - Amount per transaction
 * @param {number} config.confirmations - Number of confirmations for finality
 * @param {boolean} config.parallel - Whether to send transactions in parallel
 * @param {string} networkName - Display name of the network
 * @param {number} blockTime - Average block time in seconds (for display only)
 * @returns {Array} Array of transaction results
 */
async function runBenchmark(config, networkName, blockTime = null) {
  const confirmations = config.confirmations;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${networkName} Finality Benchmark`);
  console.log(`${'='.repeat(60)}`);
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`To Address: ${config.toAddress}`);
  console.log(`Transactions: ${config.numTxs}`);
  console.log(`Mode: ${config.parallel ? 'PARALLEL' : 'sequential'}`);
  console.log(`Rate: ${config.rate} tx/s`);
  console.log(`Amount per tx: ${config.amount} ETH`);
  console.log(`Confirmations: ${confirmations}`);
  console.log(`${'='.repeat(60)}\n`);

  // Initialize provider and wallet
  console.log(`Connecting to ${networkName}...`);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const wallet = new ethers.Wallet(config.privateKey, provider);

  console.log(`Wallet address: ${wallet.address}`);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  const balanceEth = ethers.formatEther(balance);
  console.log(`Wallet balance: ${balanceEth} ETH`);

  // Get current gas price
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;
  console.log(`Current gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);

  // Calculate cost estimate
  const totalAmount = parseFloat(config.amount) * config.numTxs;
  const estimatedGas = 21000n * BigInt(config.numTxs); // Standard transfer gas
  const estimatedGasCost = estimatedGas * gasPrice;
  const totalCost = ethers.parseEther(totalAmount.toString()) + estimatedGasCost;
  const totalCostEth = ethers.formatEther(totalCost);

  console.log(`Estimated total cost: ~${totalCostEth} ETH`);
  console.log(`  (${totalAmount} ETH transfers + ~${ethers.formatEther(estimatedGasCost)} ETH gas)\n`);

  if (balance < totalCost) {
    throw new Error(`Insufficient balance. Need ~${totalCostEth} ETH, have ${balanceEth} ETH`);
  }

  if (blockTime) {
    if (blockTime < 1) {
      console.log(`⚠️  NOTE: ${networkName} block time is ~${blockTime * 1000}ms.\n`);
    } else {
      console.log(`⚠️  NOTE: ${networkName} block time is ~${blockTime}s.\n`);
    }
  }

  // Execute in parallel or sequential mode
  let results;

  if (config.parallel) {
    // Parallel mode: send all transactions, then wait for finality
    results = await sendTransactionsParallel(
      wallet,
      config.toAddress,
      config.amount,
      confirmations,
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
          () => sendTransaction(wallet, config.toAddress, config.amount, confirmations),
          3,
          2000
        );

        results.push(result);

        if (result.status === 'success') {
          console.log(`  ✓ Finalized in ${(result.latency / 1000).toFixed(2)}s`);
          console.log(`    Mined in ${(result.miningLatency / 1000).toFixed(2)}s, ${confirmations} confirmations in ${((result.latency - result.miningLatency) / 1000).toFixed(2)}s`);
          console.log(`    Block: ${result.blockNumber}, TX: ${result.txId}`);
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

  console.log(`\n✓ ${networkName} benchmark completed\n`);
  return results;
}

module.exports = {
  runBenchmark
};
