#!/usr/bin/env node
/*
 * tools/regtest/roundtrip.cjs - reusable funded-signer regtest round-trip
 * driver ( / spec §14). Drives the live upstream BTC regtest stack:
 * funds a fresh key from the node wallet, then runs each action through the
 * full create -> encode -> sign -> broadcast -> confirm -> read-back cycle
 * via the SDK's submitAction, so a flow's honest end-to-end path can be
 * exercised against a real indexer (not a mock).
 *
 * Prereqs:
 *   - The upstream regtest stack reachable at the descriptor ports
 *     (explorer 18080, encoder BTC 3023, hub 10000). On the Mac, bring up
 *     the SSH tunnel from tools/regtest/README.md first, and confirm with
 *     `bash tools/regtest/bootstrap.sh`.
 *   - SSH access to the host running the bitcoind regtest node, for funding.
 *
 * Config (env):
 *   XCHAIN_REGTEST_SSH        ssh host alias for the node box (default: devhost)
 *   XCHAIN_REGTEST_NODE       node container name (default: xchain-node-bitcoin-regtest-node)
 *   XCHAIN_REGTEST_EXPLORER_PORT / _ENCODER_PORT / _HUB_PORT  (defaults 18080/3023/10000)
 *   XCHAIN_SDK_PATH           path to the xchain-sdk package (default: sibling ../xchain-sdk)
 *
 * WIFs generated here are throwaway regtest keys; still never printed.
 *
 * KNOWN LIMITATION: issuing a named token requires the XCHAIN protocol fee,
 * which a freshly funded BTC-only key does not hold, so the ISSUE below
 * indexes invalid and the follow-on token SEND has nothing to move. Both
 * still exercise the compose/fund/broadcast path (that is what this driver
 * proves). To premine a real test token for token-transfer verification,
 * extend submitToken() to run the native-fee preflight (sdk.nativeFeePreflight
 * -> fold FEE_DESTINATION into customOutputs), the same path the wallet's
 * composeForConfirm uses. Marked TODO below.
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const SDK_PATH = process.env.XCHAIN_SDK_PATH
    || path.resolve(__dirname, '../../../xchain-sdk');
const { XChainSDK } = require(SDK_PATH);

const SSH = process.env.XCHAIN_REGTEST_SSH || 'devhost';
const NODE = process.env.XCHAIN_REGTEST_NODE || 'xchain-node-bitcoin-regtest-node';
const SDK_OPTS = {
    network: 'bitcoin-regtest',
    explorerUrl: 'localhost', explorerPort: Number(process.env.XCHAIN_REGTEST_EXPLORER_PORT || 18080),
    encoderUrl: 'localhost', encoderPort: Number(process.env.XCHAIN_REGTEST_ENCODER_PORT || 3023),
    hubUrl: 'localhost', hubPort: Number(process.env.XCHAIN_REGTEST_HUB_PORT || 10000),
};
const CLI = ['docker', 'exec', NODE, 'bitcoin-cli', '-conf=/etc/bitcoin/bitcoin.conf', '-rpcport=18444'];

// bitcoin-cli reads rpc credentials from -conf server-side; nothing sensitive crosses the wire here.
function nodeRpc(args) {
    return execFileSync('ssh', [SSH, [...CLI, ...args].join(' ')], { encoding: 'utf8' }).trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function randTick(prefix) {
    const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let s = prefix;
    for (let i = 0; i < 6; i++) s += L[Math.floor(Math.random() * L.length)];
    return s;
}

async function submit(sdk, label, action, params, signer) {
    // Explicit funding set: the tracker cannot resolve a raw pubkey to a
    // script, and since xchain-sdk 5b57555 the SDK no longer falls back
    // to `change` for address-based selection. sdk.submitAction forwards
    // `utxos` (but not `sourceAddress`) to create_tx, so fetch the
    // spender's set by address here, per leg (each prior leg's change is
    // confirmed by its waitForIndexer before the next fetch).
    const utxos = await sdk.getUTXOs(signer.address);
    const res = await sdk.submitAction(
        { action, params },
        { pubkey: signer.pubkeyHex, change: signer.address, utxos },
        { wif: signer.wif, waitForIndexer: true, requireValid: false, timeout: 120000, pollInterval: 2000 },
    );
    console.log(`  [${label}] txid=${res.txid} broadcast+confirmed`);
    return res;
}

async function main() {
    const sdk = new XChainSDK(SDK_OPTS);

    const A = sdk.wallet.generateKeyPair();
    const addrA = sdk.wallet.deriveAddress(A.publicKeyHex, { type: 'p2wpkh' });
    const B = sdk.wallet.generateKeyPair();
    const addrB = sdk.wallet.deriveAddress(B.publicKeyHex, { type: 'p2wpkh' });
    const signerA = { wif: A.wif, pubkeyHex: A.publicKeyHex, address: addrA };
    console.log('signer A:', addrA);
    console.log('target B:', addrB);

    const fundTx = nodeRpc(['sendtoaddress', addrA, '10']);
    console.log('funded A:', fundTx);
    nodeRpc(['-generate', '3']);
    await sleep(6000);

    // 1) LIST v0 create - a complete round-trip proving the compose/fund path.
    console.log('\n=== LIST v0 create ===');
    await submit(sdk, 'LIST', 'LIST', { VERSION: '0', TYPE: '2', ITEM: [addrB] }, signerA);
    await sleep(3000);
    const lists = await sdk.getLists(addrA, 'address').catch((e) => ({ error: e.message }));
    const listOk = lists && lists.data && lists.data.some((r) => r.status === 'valid');
    console.log('  read-back getLists(A) valid row:', listOk ? 'YES' : JSON.stringify(lists).slice(0, 200));

    // 2) FILE at the PC-28 computed ceiling - proves the encoding-aware
    // size math end-to-end: the encoder must ACCEPT a payload at exactly
    // maxPublicFileBytes (old flat cap was 7000), the decoder must not
    // drop the near-8192 compiled push, and the indexer must record the
    // action. The +1 control must be rejected AT ENCODE TIME (RangeError,
    // no funds spent) - that encode-side refusal is the failure mode the
    // wallet's picker/review checks exist to pre-empt.
    //
    // ENCODER CONSTRAINT (discovered live 2026-07-25, PC-28): the
    // P2SH/P2WSH chunk lane resolves the caller identity with
    // bitcoin.address.fromBase58Check(pubKey), so any payload past the
    // OP_RETURN lane composes ONLY when `pubkey` is a base58 LEGACY
    // address; the raw compressed pubkey the SDK/wallet flows pass (and
    // any bech32 source) crashes create_tx with "Non-base58 character"
    // -> "Internal encoder error". Until the encoder learns
    // bech32/raw-pubkey identities, this leg runs from a dedicated
    // legacy signer with the ADDRESS as the identity param.
    console.log('\n=== FILE at computed max (PC-28) ===');
    const { maxPublicFileBytes } = await import(
        path.resolve(__dirname, '../../packages/core/src/flows/fileSizeLimits.js')
    );
    const F = sdk.wallet.generateKeyPair();
    const addrF = sdk.wallet.deriveAddress(F.publicKeyHex, { type: 'p2pkh' });
    console.log('  legacy FILE signer:', addrF);
    nodeRpc(['sendtoaddress', addrF, '10']);
    nodeRpc(['-generate', '3']);
    await sleep(6000);
    const fileMeta = { name: 'pc28.bin', type: 'application/octet-stream' };
    const fileCap = maxPublicFileBytes(fileMeta);
    console.log(`  computed max for ${fileMeta.name}: ${fileCap} bytes`);
    const fileParams = { VERSION: '0', NAME: fileMeta.name, TYPE: fileMeta.type };
    const fileRes = await sdk.submitAction(
        { action: 'FILE', params: fileParams },
        { pubkey: addrF, change: addrF, utxos: await sdk.getUTXOs(addrF), rawData: 'A'.repeat(fileCap) },
        { wif: F.wif, waitForIndexer: true, requireValid: false, timeout: 120000, pollInterval: 2000 },
    );
    const fileStatus = fileRes.indexed && (fileRes.indexed.status || fileRes.indexed.state);
    console.log(`  [FILE] txid=${fileRes.txid} encoding=${fileRes.encoding} indexed status=${fileStatus}`);
    let fileRejectOk = false;
    try {
        await sdk.submitAction(
            { action: 'FILE', params: fileParams },
            { pubkey: addrF, change: addrF, utxos: await sdk.getUTXOs(addrF), rawData: 'A'.repeat(fileCap + 1) },
            { wif: F.wif, waitForIndexer: false },
        );
        console.log('  [FILE+1] UNEXPECTED: encoder accepted an over-ceiling payload');
    } catch (e) {
        fileRejectOk = /too large|exceeds maximum/i.test(e && e.message || '');
        console.log(`  [FILE+1] rejected at encode time: ${fileRejectOk ? 'YES' : `UNEXPECTED (${e.message})`}`);
    }

    // 3) ISSUE - composes/broadcasts; indexes invalid without the XCHAIN fee (see LIMITATION).
    console.log('\n=== ISSUE (compose/broadcast path) ===');
    const tick = randTick('RT');
    await submit(sdk, 'ISSUE', 'ISSUE',
        { VERSION: '0', TICK: tick, MAX_SUPPLY: '1000000', MINT_SUPPLY: '1000000', DECIMALS: '0', DESCRIPTION: 'roundtrip token' },
        signerA);
    // TODO(native-fee): premine to A via nativeFeePreflight to make this valid and enable a real token SEND.

    // 4) SEND - composes/broadcasts through the shared buildSendPsbt/encoder path.
    console.log('\n=== SEND (compose/broadcast path) ===');
    await submit(sdk, 'SEND', 'SEND', { VERSION: '0', TICK: tick, AMOUNT: '100', DESTINATION: addrB }, signerA);

    console.log('\nDONE. LIST round-trip + max-size FILE are the indexed proofs; ISSUE/SEND prove compose+broadcast.');
    const fileOk = fileStatus === 'valid' && fileRejectOk;
    console.log(listOk && fileOk ? 'RESULT: PASS (LIST valid + max-size FILE valid + over-ceiling rejected)' : `RESULT: CHECK (listOk=${listOk} fileStatus=${fileStatus} fileRejectOk=${fileRejectOk})`);
}

main().catch((e) => { console.error('HARNESS ERROR:', e && e.stack ? e.stack : e); process.exit(1); });
