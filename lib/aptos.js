const { Aptos, AptosConfig, Network, Account, Ed25519PrivateKey } = require('@aptos-labs/ts-sdk');
const { sleep, retry } = require('../utils/common');

/**
 * Send a single Aptos transaction and measure finality time
 *
 * @param {Aptos} client - Aptos client instance
 * @param {Account} account - Sender account
 * @param {string} toAddress - Recipient address
 * @param {string} amount - Amount in APT
 * @returns {Object} Transaction result with timing data
 */
async function sendTransaction(client, account, toAddress, amount) {
  const sendTime = Date.now();

  try {
    // Convert amount to Octas (1 APT = 100,000,000 Octas)
    const amountInOctas = Math.floor(parseFloat(amount) * 100_000_000);

    // Build and submit transaction
    const transaction = await client.transaction.build.simple({
      sender: account.accountAddress,
      data: {
        function: "0x1::aptos_account::transfer",
        functionArguments: [toAddress, amountInOctas]
      }
    });

    // Sign and submit
    const committedTxn = await client.signAndSubmitTransaction({
      signer: account,
      transaction
    });

    // Wait for finality (transaction committed)
    const executedTxn = await client.waitForTransaction({
      transactionHash: committedTxn.hash
    });

    const finalTime = Date.now();
    const latency = finalTime - sendTime;

    return {
      txId: committedTxn.hash,
      sendTime,
      finalTime,
      latency,
      version: executedTxn.version,
      gasUsed: executedTxn.gas_used,
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
 * Run Aptos finality benchmark
 *
 * @param {Object} config - Configuration object
 * @param {string} config.rpcUrl - Aptos RPC URL (optional, defaults to network)
 * @param {string} config.network - Network: devnet, testnet, or mainnet
 * @param {string} config.privateKey - Private key (hex string)
 * @param {string} config.toAddress - Recipient address
 * @param {number} config.numTxs - Number of transactions to send
 * @param {number} config.rate - Transactions per second
 * @param {string} config.amount - Amount per transaction in APT
 * @returns {Array} Array of transaction results
 */
async function runBenchmark(config) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Aptos Finality Benchmark`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Network: ${config.network || 'devnet'}`);
  if (config.rpcUrl) {
    console.log(`RPC URL: ${config.rpcUrl}`);
  }
  console.log(`To Address: ${config.toAddress}`);
  console.log(`Transactions: ${config.numTxs}`);
  console.log(`Rate: ${config.rate} tx/s`);
  console.log(`Amount per tx: ${config.amount} APT`);
  console.log(`${'='.repeat(60)}\n`);

  // Initialize Aptos client
  console.log('Connecting to Aptos...');

  const networkMap = {
    'devnet': Network.DEVNET,
    'testnet': Network.TESTNET,
    'mainnet': Network.MAINNET
  };

  const aptosConfig = new AptosConfig({
    network: networkMap[config.network] || Network.DEVNET,
    ...(config.rpcUrl && { fullnode: config.rpcUrl })
  });

  const client = new Aptos(aptosConfig);

  // Create account from private key
  const privateKey = new Ed25519PrivateKey(config.privateKey);
  const account = Account.fromPrivateKey({ privateKey });

  console.log(`Account address: ${account.accountAddress.toString()}`);

  // Check balance
  try {
    const resources = await client.getAccountResources({
      accountAddress: account.accountAddress
    });

    const accountResource = resources.find(
      r => r.type === '0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>'
    );

    if (accountResource) {
      const balance = Number(accountResource.data.coin.value) / 100_000_000;
      console.log(`Account balance: ${balance} APT`);

      // Calculate cost estimate
      const totalAmount = parseFloat(config.amount) * config.numTxs;
      const estimatedGas = 0.001 * config.numTxs; // Rough estimate
      const totalCost = totalAmount + estimatedGas;

      console.log(`Estimated total cost: ~${totalCost.toFixed(6)} APT`);
      console.log(`  (${totalAmount} APT transfers + ~${estimatedGas.toFixed(6)} APT gas)\n`);

      if (balance < totalCost) {
        throw new Error(`Insufficient balance. Need ~${totalCost} APT, have ${balance} APT`);
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not fetch balance: ${error.message}`);
  }

  console.log(`⚠️  NOTE: Aptos has sub-second finality (~0.4-1s).\n`);

  // Rate limiting setup
  const delayMs = config.rate > 0 ? 1000 / config.rate : 0;

  // Send transactions
  const results = [];
  for (let i = 0; i < config.numTxs; i++) {
    console.log(`Sending transaction ${i + 1}/${config.numTxs}...`);

    try {
      const result = await retry(
        () => sendTransaction(client, account, config.toAddress, config.amount),
        3,
        2000
      );

      results.push(result);

      if (result.status === 'success') {
        console.log(`  ✓ Finalized in ${(result.latency / 1000).toFixed(2)}s`);
        console.log(`    Version: ${result.version}, Gas: ${result.gasUsed}`);
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

  console.log(`\n✓ Aptos benchmark completed\n`);
  return results;
}

module.exports = {
  runBenchmark
};
