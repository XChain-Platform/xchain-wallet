#!/usr/bin/env node
// tools/regtest/deployNativeFee.mjs - leg 1.
//
// Drives a WALLET-COMPOSED contract DEPLOY that pays the protocol fee with a
// native-coin output, on a chain that has no XCHAIN lane (LTC / DOGE regtest),
// and reports the status the indexer gave it.
//
// WHY THIS EXISTS RATHER THAN AN SDK DRILL
//
// The SDK e2e lane attaches its native-fee output from a test helper
// (`test/sdk/sdkHelper.js`). The wallet does not: `submitWithSigner` runs
// `applyNativeFeePreflight`, which quotes the indexer and sizes a
// FEE_DESTINATION output itself. That wallet-side sizing is the code
// is actually asking about, so this driver calls `submitWithSigner` directly -
// the same function every wallet form reaches on Approve - with a throwaway
// WIF-backed signer standing in for the vault.
//
// WHAT IT FOUND
//
// The wallet folds the FEE_DESTINATION output into the phase-1 createTx call,
// and passes NO customOutputs to spendP2sh - but a chunked action puts the
// ACTION in the phase-2 REVEAL, which is the transaction the indexer validates
// the fee against. So the fee is paid on a transaction carrying no action, and
// the action is rejected for not paying it. Wrapping the encoder shows it in
// two lines:
//
//   createTx customOutputs:  [{"address":"mfees5...","value":2084}]
//   spendP2sh customOutputs: null
//
// On LTC/DOGE the native fee is the only lane, so every chunk-lane action is
// affected. Keep this driver: it is the reproduction.
//
// VENUE
//
// Run it on the regtest host, where the encoder/miner ports are local and ~/Sites is
// the same NFS path as the Mac:
//
//   ssh localhost 'cd ~/Sites/XChain-Platform/xchain-wallet && \
//     node tools/regtest/deployNativeFee.mjs litecoin-regtest'
//
// From the Mac it needs tunnels for the chain's encoder + miner ports.
//
// LTC/DOGE regtest indexers run with HUB_DB_NAME unset, so they read their own
// never-refreshed price_snapshots. A hand-seeded row is only usable
// inside ORACLE_MAX_PRICE_AGE_SECONDS (1800s) of the block time, so a venue that
// worked an hour ago answers "no current oracle price for LTC/USD (missing or
// stale beyond 1800s)" at the pre-flight. That is the guardrail refusing before
// signing, not a wallet defect and not a broken run: re-seed the pair (the
// xchain-e2e-test _ctlseed preamble) and drive again.
//
// The WIF is generated here, used once on regtest, and never printed.

import { createRequire } from 'node:module';
import { registry as registryLib } from '../../packages/core/src/index.js';
import { SDKRegistry } from '../../packages/core/src/sdk/SDKRegistry.js';
import { adaptXChainSDK } from '../../packages/core/src/sdk/defaultFactory.js';
import { submitWithSigner } from '../../packages/core/src/sdk/submitWithSigner.js';
import { composeActionForConfirm } from '../../packages/core/src/flows/composeActionForConfirm.js';

const require = createRequire(import.meta.url);
// Resolved by PATH, not by package name: xchain-sdk is a dependency of the
// shells rather than of the workspace root, so a bare specifier does not
// resolve from here. Same convention as tools/regtest/roundtrip.cjs.
const { XChainSDK } = require(process.env.XCHAIN_SDK_PATH || '../../../xchain-sdk');

// addressType per chain: Dogecoin has no SegWit, so its funding address (and
// therefore the derivation path this signs under) is legacy p2pkh.
const CHAINS = {
    'litecoin-regtest': { coin: 'RLTC', minerPort: 3225, encoderPort: 3223, addressType: 'p2wpkh', path: "m/84'/2'/0'/0/0" },
    'dogecoin-regtest': { coin: 'RDOGE', minerPort: 3125, encoderPort: 3123, addressType: 'p2pkh', path: "m/44'/3'/0'/0/0" },
    'bitcoin-regtest': { coin: 'RBTC', minerPort: 3025, encoderPort: 3023, addressType: 'p2wpkh', path: "m/84'/0'/0'/0/0" },
};

const EXPLORER = process.env.XCHAIN_EXPLORER_URL || 'http://localhost:18080';
const chainId = process.argv[2] || 'litecoin-regtest';
// --confirm drives the CONFIRM path (compose -> preview -> approve a prebuilt
// PSBT), which is the one every wallet form actually takes; without it the
// driver takes the direct-submit path. had to be fixed on BOTH, and
// only one can be exercised per run, so both are drivable here.
const viaConfirm = process.argv.includes('--confirm');
const cfg = CHAINS[chainId];
if (!cfg) {
    console.error(`unknown chain "${chainId}"; expected one of ${Object.keys(CHAINS).join(', ')}`);
    process.exit(2);
}

// The counter contract the e2e contract drills use. CommonJS, not ESM: the
// VM runs the code in an isolate that rejects `export` outright
// ("syntax error: Unexpected token 'export'"), which is how the first run
// of this driver failed - a driver bug that looked like a deploy failure.
const CONTRACT_CODE = `
    module.exports = {
        initialize: function() {
            xchain.state.set('count', '0');
        },
        increment: function() {
            let count = parseInt(xchain.state.get('count') || '0');
            xchain.state.set('count', String(count + 1));
            return String(count + 1);
        },
        getCount: function() {
            return xchain.state.get('count') || '0';
        }
    };
`;

async function rpc(port, method, params) {
    const res = await fetch(`http://localhost:${port}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = await res.json();
    if (body.error) throw new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
    return body.result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function utxoCount(address) {
    const r = await rpc(cfg.encoderPort, 'get_utxos', { address });
    return Array.isArray(r?.utxos) ? r.utxos.length : 0;
}

async function fund(address, amount) {
    const before = await utxoCount(address);
    await rpc(cfg.minerPort, 'send_funds', { address, amount });
    await rpc(cfg.minerPort, 'generate_blocks', { count: 1 });
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        if ((await utxoCount(address)) > before) return;
        await sleep(1000);
    }
    throw new Error('funding never appeared in the utxo-tracker view');
}

async function actionStatus(txid) {
    // Two calls, because the LIST route does not carry `status` (measured
    // 2026-07-28: its rows are action/action_index/block_index/source/timestamp
    // /tx_hash/tx_index only). Reading the verdict off the list row therefore
    // answered `undefined` for a perfectly valid action and this driver exited
    // 1 on its own success - the absent-vs-invalid trap. The list resolves the
    // txid to an index; the DETAIL route is where the verdict lives.
    const res = await fetch(`${EXPLORER}/${cfg.coin}/api/actions?limit=50`);
    const body = await res.json();
    const row = (body.data || []).find((r) => r.tx_hash === txid || r.txid === txid);
    if (!row) return null;
    const detailRes = await fetch(`${EXPLORER}/${cfg.coin}/api/action/${row.action_index}`);
    const detail = await detailRes.json();
    return { ...row, ...detail };
}

async function main() {
    const chainRegistry = registryLib.defaultRegistry();
    const descriptor = chainRegistry.get(chainId);
    if (!descriptor) throw new Error(`no descriptor for ${chainId}`);
    console.log(`chain: ${chainId} (${descriptor.displayName})`);

    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: adaptXChainSDK(XChainSDK),
    });
    const sdk = sdkRegistry.get(chainId);
    await sdk.ready?.();

    // Observe what the WALLET asks the encoder to build. The question this
    // driver exists for is whether the native-fee output makes it into the
    // transaction, and reading it here answers that without needing node RPC
    // credentials (the first attempt to check on-chain read a failed RPC call
    // as "no fee output", which is the absent-vs-empty trap again).
    const realCreateTx = sdk.encoder.createTx.bind(sdk.encoder);
    sdk.encoder.createTx = async (params) => {
        console.log("  createTx customOutputs:", JSON.stringify(params.customOutputs || null));
        return realCreateTx(params);
    };
    const realSpend = sdk.encoder.spendP2sh?.bind(sdk.encoder);
    if (realSpend) {
        sdk.encoder.spendP2sh = async (params) => {
            console.log("  spendP2sh customOutputs:", JSON.stringify(params.customOutputs || null));
            return realSpend(params);
        };
    }

    // Throwaway regtest key. Never printed.
    const kp = sdk.wallet.generateKeyPair();
    const wif = kp.wif;
    const publicKey = kp.publicKeyHex;
    const address = sdk.wallet.deriveAddress(kp.publicKey, { type: cfg.addressType });

    // The wallet's Signer interface, backed by a raw WIF instead of the vault.
    const signer = {
        // Mirrors SoftwareSigner.signPsbt, including the branch: a
        // chunked DEPLOY's phase-2 reveal spends data-carrier outputs whose
        // redeem script the default single-sig finalizer cannot finalize
        // ("Can not finalize input #0"), so it needs the SDK's reveal
        // finalizer. Ignoring `reveal` here is a driver bug, not a wallet one.
        async signPsbt({ psbtHex, reveal }) {
            const signed = reveal
                ? sdk.wallet.signRevealPsbt(psbtHex, wif)
                : sdk.wallet.signPsbt(psbtHex, wif);
            return { txHex: signed.txHex, txid: signed.txid };
        },
    };

    const actionData = {
        action: 'DEPLOY',
        // Exactly the shape DeployContractForm builds (VERSION 0, raw CODE,
        // stringified GAS_LIMIT, optional NAME). Composing a different shape
        // here would test the driver, not the wallet.
        params: {
            VERSION: '0',
            CODE: CONTRACT_CODE,
            GAS_LIMIT: '100000',
            NAME: 'xc775' + Date.now().toString(36),
        },
    };

    // Fund AFTER quoting, and fund for the quote. A flat 5 coins was enough on
    // whatever prices the regtest indexers happened to hold in July 2026, and
    // stopped being enough the moment they moved: dogecoin-regtest quoted 20.84
    // DOGE and the run died in the encoder ("insufficient funds ... protocol fee
    // requires 20.84 in native coin"), which reads exactly like a wallet defect
    // and is not one. The quote is free and side-effect-free, so take it first.
    let fundAmount = 5;
    try {
        const quote = await sdk.quoteNativeFee(actionData, { source: address });
        const feeCoins = Number(quote?.requiredFeeNative)
            || Number(quote?.requiredFeeSats) / 1e8;
        if (Number.isFinite(feeCoins) && feeCoins > 0) fundAmount = Math.ceil(feeCoins) + 5;
        console.log(`pre-quote: ${quote?.requiredFeeNative ?? quote?.requiredFeeSats} -> funding ${fundAmount}`);
    } catch (err) {
        console.log(`pre-quote unavailable (${err?.message || err}); funding ${fundAmount}`);
    }
    console.log(`funding ${address} ...`);
    await fund(address, fundAmount);
    console.log(`funded: ${await utxoCount(address)} utxo(s)`);

    // The CONFIRM path: compose + tamper-check host-side, then approve the
    // PREBUILT psbt. That is the exact pair of steps a form takes, and it is a
    // different branch of submitWithSigner from the direct path, so had
    // to be fixed in both. The vault is stubbed to default settings because the
    // only thing compose reads from it is the ADS donation snapshot.
    let prebuiltPsbt;
    if (viaConfirm) {
        console.log('composing for confirm (the form path) ...');
        const composed = await composeActionForConfirm({
            vault: { settings: { get: async () => ({}) } },
            chainRegistry,
            sdkRegistry,
            chainId,
            actionData,
            encoderOpts: { pubkey: publicKey, sourceAddress: address, change: address, payFeeInNativeCoin: true },
            source: address,
            ownAddresses: [address],
        });
        console.log('  composed encoding:', composed.encoding,
            '| deferredFeeOutput:', JSON.stringify(composed.deferredFeeOutput));
        prebuiltPsbt = {
            psbtHex: composed.psbt,
            encoding: composed.encoding,
            actionString: composed.actionString,
            version: composed.version,
            deferredFeeOutput: composed.deferredFeeOutput || null,
        };
    }

    console.log('composing + submitting DEPLOY with payFeeInNativeCoin ...');
    const result = await submitWithSigner({
        ...(prebuiltPsbt ? { prebuiltPsbt } : {}),
        sdkRegistry,
        chainRegistry,
        chainId,
        actionData,
        // sourceAddress + change mirror what the wallet's composeForConfirm
        // passes (flows/composeForConfirm.js): without sourceAddress the
        // encoder resolves the funding set from the pubkey, and the
        // utxo-tracker keys strictly on an address it can run through
        // toOutputScript, so it answers "has no matching Script". The form
        // path never hits this because it submits a prebuiltPsbt.
        encoderOpts: {
            pubkey: publicKey,
            sourceAddress: address,
            change: address,
            payFeeInNativeCoin: true,
        },
        signer,
        signingPaths: [{ inputIndex: 0, path: cfg.path }],
        onProgress: (phase, info) => console.log(`  [${phase}]`, phase === 'native_fee_quoted' ? JSON.stringify(info) : (info?.txid || '')),
    });

    const txid = result?.txid || result?.broadcast?.txid;
    console.log(`broadcast txid: ${txid}`);

    console.log('mining + waiting for the indexer ...');
    await rpc(cfg.minerPort, 'generate_blocks', { count: 1 });

    const deadline = Date.now() + 120_000;
    let row = null;
    while (Date.now() < deadline) {
        row = await actionStatus(txid);
        if (row) break;
        await sleep(2000);
    }

    if (!row) {
        console.log('RESULT: the action never appeared in the explorer within 120s');
        process.exit(1);
    }
    console.log(`RESULT: action ${row.action} index ${row.action_index} status: ${row.status}`);
    process.exit(String(row.status).startsWith('valid') ? 0 : 1);
}

main().catch((err) => {
    console.error('FAILED:', err?.message || err);
    process.exit(1);
});
