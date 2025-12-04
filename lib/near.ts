import { Account, JsonRpcProvider, KeyPairString, actionCreators } from 'near-api-js';
import { NEAR } from 'near-api-js/tokens';
import { sleep } from '../utils/common.js';
import { TransactionResult } from '../utils/output.js';

const NEAR_RPC_URL = 'https://rpc.mainnet.fastnear.com'
const NEAR_ACCOUNT_ID = ''
const NEAR_PRIVATE_KEY = ''
const NEAR_RECEIVER_ID = ''
const NEAR_AMOUNT = '0.01'

async function sendTransaction(
    account: Account,
    receiverId: string,
    amount: string
): Promise<TransactionResult> {

    const signedTx = await account.createSignedTransaction({
        receiverId,
        actions: [
            actionCreators.transfer(BigInt(NEAR.toUnits(amount)))
        ]
    });

    const provider = account.provider as JsonRpcProvider;

    const sendTime = Date.now();

    // Send transaction and wait for FINAL status
    const result = await provider.sendTransactionUntil(
        signedTx,
        'FINAL'
    );

    const finalTime = Date.now();
    const latency = finalTime - sendTime;

    return {
        txId: result.transaction.hash,
        sendTime,
        finalTime,
        latency,
        status: 'success',
    };
}

/**
 * Run NEAR finality benchmark
 */
export async function runBenchmark(config: { numTxs: number, delayMs: number }): Promise<{ results: TransactionResult[], errors: number }> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`NEAR Protocol Finality Benchmark`);
    console.log(`${'='.repeat(60)}`);
    console.log(`RPC URL: ${NEAR_RPC_URL}`);
    console.log(`Account: ${NEAR_ACCOUNT_ID}`);
    console.log(`Receiver: ${NEAR_RECEIVER_ID}`);
    console.log(`Amount per tx: ${NEAR_AMOUNT} NEAR`);
    console.log(`${'='.repeat(60)}\n`);

    // Initialize NEAR connection
    console.log('Initializing NEAR connection...');
    const provider = new JsonRpcProvider({ url: NEAR_RPC_URL });
    const account = new Account(NEAR_ACCOUNT_ID, provider, NEAR_PRIVATE_KEY);

    // Check account balance
    const balance = await account.getBalance();
    const balanceNear = NEAR.toDecimal(balance);
    console.log(`Account balance: ${balanceNear} NEAR`);

    // Calculate total cost estimate
    const totalAmount = parseFloat(NEAR_AMOUNT) * config.numTxs;
    const estimatedGas = 0.0003 * config.numTxs;
    const totalCost = totalAmount + estimatedGas;
    console.log(`Estimated total cost: ~${totalCost.toFixed(4)} NEAR\n`);

    if (parseFloat(balanceNear) < totalCost) {
        throw new Error(`Insufficient balance. Need ~${totalCost.toFixed(4)} NEAR, have ${balanceNear} NEAR`);
    }

    // Execute in sequential mode
    const results: TransactionResult[] = [];
    let errors = 0;

    for (let i = 0; i < config.numTxs; i++) {
        console.log(`Sending transaction ${i + 1}/${config.numTxs}...`);

        try {
            const result = await sendTransaction(account, NEAR_RECEIVER_ID, NEAR_AMOUNT);
            results.push(result);
            console.log(`  ✓ Finalized in ${result.latency}ms (tx: ${result.txId})`);
        } catch (error) {
            errors++;
        }

        // Rate limiting
        await sleep(config.delayMs);
    }

    console.log(`\n✓ NEAR benchmark completed\n`);
    return { results, errors };
}
