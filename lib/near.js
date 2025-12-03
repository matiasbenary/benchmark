const { connect, keyStores, KeyPair, utils } = require('near-api-js');
const { sleep, retry } = require('../utils/common');

/**
 * Initialize NEAR connection
 */
async function initNear(config) {
  const { networkId, nodeUrl, accountId, privateKey } = config;

  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(privateKey);
  await keyStore.setKey(networkId, accountId, keyPair);

  // Connect to NEAR
  const nearConfig = {
    networkId,
    keyStore,
    nodeUrl,
    walletUrl: `https://wallet.${networkId}.near.org`,
    helperUrl: `https://helper.${networkId}.near.org`
  };

  const near = await connect(nearConfig);
  const account = await near.account(accountId);

  return { near, account };
}

/**
 * Send a single NEAR transaction and measure finality time
 *
 * @param {Object} account - NEAR account object
 * @param {Object} near - NEAR connection object
 * @param {string} receiverId - Recipient account ID
 * @param {string} amount - Amount in NEAR (will be converted to yoctoNEAR)
 * @returns {Object} Transaction result with timing data
 */
async function sendTransaction(account, near, receiverId, amount) {
  const sendTime = Date.now();

  try {
    // Convert NEAR to yoctoNEAR (10^24)
    const amountYocto = utils.format.parseNearAmount(amount);

    // Send transaction (this waits for tx to be in a block, but not FINAL)
    const result = await account.sendMoney(
      receiverId,
      amountYocto
    );

    const txHash = result.transaction.hash;
    const accountId = account.accountId;

    // IMPORTANT: Now wait for FINAL status explicitly
    // This is the actual finality we want to measure
    await near.connection.provider.txStatus(txHash, accountId, 'FINAL');

    const finalTime = Date.now();
    const latency = finalTime - sendTime;

    return {
      txId: txHash,
      sendTime,
      finalTime,
      latency,
      status: 'success',
      blockHash: result.transaction_outcome.block_hash
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
 * Run NEAR finality benchmark
 *
 * @param {Object} config - Configuration object
 * @param {string} config.networkId - NEAR network ID (e.g., 'testnet', 'mainnet')
 * @param {string} config.nodeUrl - NEAR RPC URL
 * @param {string} config.accountId - Sender account ID
 * @param {string} config.privateKey - Private key for the account
 * @param {string} config.receiverId - Recipient account ID
 * @param {number} config.numTxs - Number of transactions to send
 * @param {number} config.rate - Transactions per second
 * @param {string} config.amount - Amount per transaction in NEAR
 * @returns {Array} Array of transaction results
 */
async function runBenchmark(config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`NEAR Protocol Finality Benchmark`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Network: ${config.networkId}`);
  console.log(`RPC URL: ${config.nodeUrl}`);
  console.log(`Account: ${config.accountId}`);
  console.log(`Receiver: ${config.receiverId}`);
  console.log(`Transactions: ${config.numTxs}`);
  console.log(`Rate: ${config.rate} tx/s`);
  console.log(`Amount per tx: ${config.amount} NEAR`);
  console.log(`${'='.repeat(60)}\n`);

  // Initialize NEAR connection
  console.log('Initializing NEAR connection...');
  const { near, account } = await retry(() => initNear(config));
  console.log('✓ Connected to NEAR\n');

  // Check account balance
  const balance = await account.getAccountBalance();
  const balanceNear = utils.format.formatNearAmount(balance.available);
  console.log(`Account balance: ${balanceNear} NEAR`);

  // Calculate total cost estimate
  const totalAmount = parseFloat(config.amount) * config.numTxs;
  const estimatedGas = 0.0003 * config.numTxs;
  const totalCost = totalAmount + estimatedGas;
  console.log(`Estimated total cost: ~${totalCost.toFixed(4)} NEAR\n`);

  if (parseFloat(balanceNear) < totalCost) {
    throw new Error(`Insufficient balance. Need ~${totalCost.toFixed(4)} NEAR, have ${balanceNear} NEAR`);
  }

  // Rate limiting setup
  const delayMs = config.rate > 0 ? 1000 / config.rate : 0;

  // Send transactions
  const results = [];
  for (let i = 0; i < config.numTxs; i++) {
    console.log(`Sending transaction ${i + 1}/${config.numTxs}...`);

    try {
      const result = await retry(
        () => sendTransaction(account, near, config.receiverId, config.amount),
        3,
        2000
      );

      results.push(result);

      if (result.status === 'success') {
        console.log(`  ✓ Finalized in ${result.latency}ms (tx: ${result.txId})`);
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

  console.log(`\n✓ NEAR benchmark completed\n`);
  return results;
}

module.exports = {
  runBenchmark
};
