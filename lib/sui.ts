import { SuiClient, getFullnodeUrl } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import { decodeSuiPrivateKey } from '@mysten/sui.js/cryptography';
import { sleep, retry } from '../utils/common.js';
import { TransactionResult } from '../utils/output.js';

export interface SuiConfig {
  rpcUrl?: string;
  network: string;
  privateKey: string;
  toAddress: string;
  numTxs: number;
  rate: number;
  amount: string;
  parallel: boolean;
}

/**
 * Send a single Sui transaction and measure finality time
 *
 * @param client - Sui client instance
 * @param keypair - Sender keypair
 * @param toAddress - Recipient address
 * @param amount - Amount in SUI
 * @returns Transaction result with timing data
 */
async function sendTransaction(
  client: SuiClient,
  keypair: Ed25519Keypair,
  toAddress: string,
  amount: string
): Promise<TransactionResult> {
  const sendTime = Date.now();

  try {
    // Convert amount to MIST (1 SUI = 1,000,000,000 MIST)
    const amountInMist = Math.floor(parseFloat(amount) * 1_000_000_000);

    // Create transaction
    const tx = new TransactionBlock();
    const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
    tx.transferObjects([coin], toAddress);

    // Sign and execute transaction with WaitForLocalExecution
    const result = await client.signAndExecuteTransactionBlock({
      signer: keypair,
      transactionBlock: tx,
      requestType: 'WaitForLocalExecution',
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
      checkpoint: result.checkpoint || undefined,
      status: 'success'
    };
  } catch (error) {
    const finalTime = Date.now();
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      txId: null,
      sendTime,
      finalTime,
      latency: finalTime - sendTime,
      status: 'failed',
      error: errorMessage
    };
  }
}

/**
 * Send transactions in parallel and wait for finality
 */
async function sendTransactionsParallel(
  client: SuiClient,
  keypair: Ed25519Keypair,
  toAddress: string,
  amount: string,
  numTxs: number,
  rate: number
): Promise<TransactionResult[]> {
  const delayMs = rate > 0 ? 1000 / rate : 0;
  const amountInMist = Math.floor(parseFloat(amount) * 1_000_000_000);

  console.log('\nSending transactions with WaitForLocalExecution...');

  // Send all transactions with WaitForLocalExecution for finality
  const txPromises: Promise<{
    digest: string | null;
    checkpoint: string | undefined;
    sendTime: number;
    index: number;
    status: 'sent' | 'failed';
    error?: string;
  }>[] = [];
  
  for (let i = 0; i < numTxs; i++) {
    const sendTime = Date.now();

    const txPromise = (async () => {
      try {
        const tx = new TransactionBlock();
        const [coin] = tx.splitCoins(tx.gas, [amountInMist]);
        tx.transferObjects([coin], toAddress);

        const result = await client.signAndExecuteTransactionBlock({
          signer: keypair,
          transactionBlock: tx,
          requestType: 'WaitForLocalExecution',
          options: {
            showEffects: true
          }
        });

        return {
          digest: result.digest,
          checkpoint: result.checkpoint || undefined,
          sendTime,
          index: i,
          status: 'sent' as const
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          digest: null,
          checkpoint: undefined,
          sendTime,
          index: i,
          status: 'failed' as const,
          error: errorMessage
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

  // Now wait for each transaction to be confirmed
  const results = await Promise.all(
    sentTxs.map(async ({ digest, checkpoint, sendTime, index, status, error }) => {
      if (status === 'failed') {
        return {
          txId: null,
          sendTime,
          finalTime: Date.now(),
          latency: null,
          status: 'failed' as const,
          error
        };
      }

      try {
        await client.waitForTransactionBlock({
          digest: digest!,
          options: {
            showEffects: true
          }
        });

        const finalTime = Date.now();
        const latency = finalTime - sendTime;

        console.log(`  [${index + 1}/${numTxs}] ✓ Finalized in ${(latency / 1000).toFixed(2)}s`);

        return {
          txId: digest!,
          sendTime,
          finalTime,
          latency,
          checkpoint,
          status: 'success' as const
        };
      } catch (error) {
        const finalTime = Date.now();
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`  [${index + 1}/${numTxs}] ✗ Failed: ${errorMessage}`);
        return {
          txId: digest!,
          sendTime,
          finalTime,
          latency: finalTime - sendTime,
          status: 'failed' as const,
          error: errorMessage
        };
      }
    })
  );

  return results;
}

/**
 * Run Sui finality benchmark
 *
 * @param config - Configuration object
 * @returns Array of transaction results
 */
export async function runBenchmark(config: SuiConfig): Promise<TransactionResult[]> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Sui Finality Benchmark`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Network: ${config.network || 'devnet'}`);
  if (config.rpcUrl) {
    console.log(`RPC URL: ${config.rpcUrl}`);
  }
  console.log(`To Address: ${config.toAddress}`);
  console.log(`Transactions: ${config.numTxs}`);
  console.log(`Mode: ${config.parallel ? 'PARALLEL' : 'sequential'}`);
  console.log(`Rate: ${config.rate} tx/s`);
  console.log(`Amount per tx: ${config.amount} SUI`);
  console.log(`${'='.repeat(60)}\n`);

  // Initialize Sui client
  console.log('Connecting to Sui...');

  const networkParam = config.network || 'devnet';
  const validNetworks = ['devnet', 'mainnet', 'testnet', 'localnet'] as const;
  const network = validNetworks.includes(networkParam as any) 
    ? (networkParam as 'devnet' | 'mainnet' | 'testnet' | 'localnet')
    : 'devnet';
    
  const rpcUrl = config.rpcUrl || getFullnodeUrl(network);
  const client = new SuiClient({ url: rpcUrl });

  // Create keypair from private key
  let keypair: Ed25519Keypair;
  try {
    const privateKey = config.privateKey.trim();

    // Method 1: Try as bech32 encoded key (most common from Sui CLI)
    if (!privateKey.startsWith('0x') && !privateKey.includes(':')) {
      try {
        // Add prefix if missing
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
    } else {
      throw new Error('Could not parse private key with any supported format');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid private key format: ${errorMessage}`);
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(`Warning: Could not fetch balance: ${errorMessage}`);
  }

  console.log(`⚠️  NOTE: Sui has sub-second finality (~0.4-0.6s).\n`);

  // Execute in parallel or sequential mode
  let results: TransactionResult[];

  if (config.parallel) {
    // Parallel mode: send all transactions, then wait for finality
    results = await sendTransactionsParallel(
      client,
      keypair,
      config.toAddress,
      config.amount,
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
          () => sendTransaction(client, keypair, config.toAddress, config.amount),
          3,
          2000
        );

        results.push(result);

        if (result.status === 'success') {
          console.log(`  ✓ Finalized in ${(result.latency! / 1000).toFixed(2)}s`);
          console.log(`    Checkpoint: ${result.checkpoint || 'N/A'}`);
          console.log(`    TX: ${result.txId}`);
        } else {
          console.log(`  ✗ Failed: ${result.error}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.log(`  ✗ Failed after retries: ${errorMessage}`);
        results.push({
          txId: null,
          sendTime: Date.now(),
          finalTime: Date.now(),
          latency: null,
          status: 'failed',
          error: errorMessage
        });
      }

      // Rate limiting
      if (i < config.numTxs - 1 && delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  console.log(`\n✓ Sui benchmark completed\n`);
  return results;
}
