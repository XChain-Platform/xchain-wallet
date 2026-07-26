#!/usr/bin/env node
/*
 * tools/regtest/multiSendRoundtrip.cjs - PC-52 live round-trip: one SEND
 * paying SEVERAL recipients, composed from the WALLET's own shaping layer.
 *
 * Why this exists as its own drill rather than another leg in roundtrip.cjs:
 * the defect it guards against  is invisible to a status check. A
 * multi-leg SEND built from a flat field map serialized as a WELL-FORMED
 * action that paid the first recipient twice, so "indexed valid" proves
 * nothing here. The assertions are per-recipient CREDITS, with deliberately
 * UNEQUAL amounts: equal amounts could not tell "both legs landed" apart from
 * "leg 1 was emitted twice".
 *
 * It composes params through flows/sendLegs.js (buildSendParams), which is
 * what the wallet's three SEND paths call, so this exercises the wallet's
 * bytes and not a hand-written stand-in.
 *
 * Prereqs (same as roundtrip.cjs):
 *   - The upstream regtest stack reachable at the descriptor ports; from the
 *     Mac, bring up the SSH tunnel in tools/regtest/README.md first and
 *     confirm with `bash tools/regtest/bootstrap.sh`.
 *   - SSH access to the box running the regtest node, for funding.
 *
 * A 2-leg SEND is ~110 bytes, past the 80-byte OP_RETURN lane, so this also
 * covers the P2SH chunk lane from a bech32 signer with a raw-pubkey identity
 * (the  path).
 *
 * Config (env): XCHAIN_REGTEST_SSH / _NODE / _EXPLORER_PORT / _ENCODER_PORT /
 * _HUB_PORT / XCHAIN_SDK_PATH, as in roundtrip.cjs.
 *
 * WIFs generated here are throwaway regtest keys; still never printed.
 */
'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const SDK_PATH = process.env.XCHAIN_SDK_PATH || path.resolve(__dirname, '../../../xchain-sdk');
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

// bitcoin-cli reads rpc credentials from -conf server-side; nothing sensitive crosses the wire.
function nodeRpc(args) {
    return execFileSync('ssh', [SSH, [...CLI, ...args].join(' ')], { encoding: 'utf8' }).trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submit(sdk, label, action, params, signer, opts = {}) {
    const utxos = await sdk.getUTXOs(signer.address);
    const res = await sdk.submitAction(
        { action, params },
        { pubkey: signer.pubkeyHex, change: signer.address, utxos },
        { wif: signer.wif, waitForIndexer: true, requireValid: false, timeout: 120000, pollInterval: 2000, ...opts },
    );
    const status = res.indexed && (res.indexed.status || res.indexed.state);
    console.log(`  [${label}] txid=${res.txid} encoding=${res.encoding} indexed=${status}`);
    return { ...res, status };
}

async function main() {
    const sdk = new XChainSDK(SDK_OPTS);
    const { normalizeSendLegs, buildSendParams, summarizeSendLegs } = await import(
        path.resolve(__dirname, '../../packages/core/src/flows/sendLegs.js')
    );

    const newAddr = () => {
        const kp = sdk.wallet.generateKeyPair();
        return {
            wif: kp.wif,
            pubkeyHex: kp.publicKeyHex,
            address: sdk.wallet.deriveAddress(kp.publicKeyHex, { type: 'p2wpkh' }),
        };
    };

    const sender = newAddr();
    const alice = newAddr();
    const bob = newAddr();
    const carol = newAddr();
    console.log('sender:', sender.address);
    console.log('recipients:', alice.address, bob.address, carol.address);

    nodeRpc(['sendtoaddress', sender.address, '10']);
    nodeRpc(['-generate', '3']);
    await sleep(6000);

    // XCHAIN is freely MINTable on regtest by any address (no ISSUE fee), so
    // this gives the sender a real, movable token balance.
    console.log('\n=== MINT XCHAIN (funds the balance the legs move) ===');
    await submit(sdk, 'MINT', 'MINT', { VERSION: '0', TICK: 'XCHAIN', AMOUNT: '100' }, sender);
    await sleep(3000);

    const balOf = async (addr, tick = 'XCHAIN') => {
        const resp = await sdk.getBalances(addr).catch(() => null);
        const rows = resp && Array.isArray(resp.data) ? resp.data : [];
        const row = rows.find((r) => r.tick === tick);
        return row ? String(row.quantity ?? row.amount ?? '0') : '0';
    };
    /*
     * `indexed: valid` does not mean the balance VIEW has caught up: the
     * source-side debit in particular lands a beat after the action is
     * recorded, so a fixed sleep reports a false mismatch (measured: the
     * recipients read correctly while the sender still showed its pre-send
     * total). Poll to the expected value and let the timeout be the failure.
     */
    const waitForBalance = async (addr, want, { tick = 'XCHAIN', timeoutMs = 45000 } = {}) => {
        const deadline = Date.now() + timeoutMs;
        let seen = await balOf(addr, tick);
        while (seen !== String(want) && Date.now() < deadline) {
            await sleep(2000);
            seen = await balOf(addr, tick);
        }
        return seen;
    };
    const minted = await balOf(sender.address);
    console.log(`  sender XCHAIN=${minted} (want 100)`);

    // --- The drill: one SEND, three recipients, three DIFFERENT amounts ---
    console.log('\n=== SEND v1: 3 recipients in one action (PC-52) ===');
    const { legs } = normalizeSendLegs({
        tick: 'XCHAIN',
        legs: [
            { to: alice.address, amount: '7' },
            { to: bob.address, amount: '3' },
            { to: carol.address, amount: '1' },
        ],
    }, 'multiSendRoundtrip');
    const params = buildSendParams(legs);
    console.log('  wallet summary:', summarizeSendLegs(legs));
    console.log('  params:', JSON.stringify(params));

    const sendRes = await submit(sdk, 'SEND multi', 'SEND', params, sender);
    console.log('  action string:', sendRes.actionString || sendRes.action || '(not reported)');

    const balA = await waitForBalance(alice.address, 7);
    const balB = await waitForBalance(bob.address, 3);
    const balC = await waitForBalance(carol.address, 1);
    const balSender = await waitForBalance(sender.address, 89);
    console.log(`  read-back: alice=${balA} (want 7), bob=${balB} (want 3), carol=${balC} (want 1), sender=${balSender} (want 89)`);

    // Each leg credited EXACTLY once: the direct  regression guard. An
    // overpaid leg 1 (alice=11 or alice=7 with bob/carol at 0) fails here even
    // though the action would have indexed valid.
    const legsOk = sendRes.status === 'valid'
        && Number(balA) === 7 && Number(balB) === 3 && Number(balC) === 1
        && Number(balSender) === 89;

    // --- Control: a single-recipient send still composes v0 -----------------
    console.log('\n=== Control: single-recipient SEND still emits v0 ===');
    const single = buildSendParams(normalizeSendLegs({
        to: alice.address, tick: 'XCHAIN', amount: '2',
    }, 'multiSendRoundtrip').legs);
    console.log('  params:', JSON.stringify(single));
    const singleRes = await submit(sdk, 'SEND single', 'SEND', single, sender);
    const balA2 = await waitForBalance(alice.address, 9);
    const singleOk = singleRes.status === 'valid' && Number(balA2) === 9;
    console.log(`  read-back: alice=${balA2} (want 9 = 7 + 2)`);

    console.log('\n==== PC-52 live round-trip ====');
    console.log(`  multi-leg SEND, each leg credited exactly once: ${legsOk ? 'PASS' : 'FAIL'}`);
    console.log(`  single-recipient control unchanged:             ${singleOk ? 'PASS' : 'FAIL'}`);
    if (!legsOk || !singleOk) process.exitCode = 1;
}

main().catch((err) => {
    console.error('multiSendRoundtrip failed:', err && err.message ? err.message : err);
    process.exitCode = 1;
});
