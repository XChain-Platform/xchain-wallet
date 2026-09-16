// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The TESTNET venue: a public Bitcoin testnet chain behind the platform's own
// public explorer and encoder, driven by the wallet's production build.
//
// This is NEW CODE next to `regtest.js`, not a flag on it, and the reason is
// structural (testnet-validator-network.md, D12). Everything the regtest
// fixture leans on to make a spec deterministic does not exist here: there is
// no miner RPC to fund an address or advance a block, no `setmocktime` to
// cross a deadline, no ssh-plus-docker path into an indexer database to seed
// a price. The chain moves on its own clock, the federation prices it, and a
// spec WAITS for state instead of manufacturing it. So every helper here
// polls and none of them mines; the unit suite proves that by handing the
// harness a venue whose miner, clock, ssh, docker and DB methods all throw.
//
// FUNDING IS THE ONE WRITE THAT NEEDS A KEY, and the boundary is stdin. A
// treasury wallet JSON object (`{ wif, address }`) is read from stdin, once,
// only after the destination is known, and the WIF lives in memory for the
// length of one signing call: never printed, never written, never in argv or
// an environment variable. The key buffer the SDK exposes is zeroed as soon
// as the address has been derived from it. Before anything is signed the
// derived address must match the declared one and every selected input must
// pay it, so a wrong key or a wrong UTXO set refuses rather than probes a
// live chain by trial and error.
//
// Service URLs come from the bundled chain descriptor through the same
// `joinEndpoint` the wallet itself uses, so this file names no host: the
// descriptor is the single place a public endpoint lives.
//
// Bitcoin only, deliberately: staking is BTC-only at launch and the testnet
// treasury holds tBTC. The wallet's screen labels for Bitcoin testnet are the
// same "Bitcoin" the regtest fixture keys its page walks on, which is why the
// UI helpers below are shared with it rather than copied.

import { expect } from '@playwright/test';
import bitcoin from 'bitcoinjs-lib';
import xchainSdk from 'xchain-sdk';
import { coinPrefix } from 'xchain-sdk/src/endpoints.js';
import { getNetwork } from 'xchain-sdk/src/networks.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { joinEndpoint } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { gotoSection, openSettings } from './wallet.js';
import { REGTEST_COIN, expectConfirmModal, mintXchain, unlockAfterReload } from './regtest.js';
import { priceVerdict } from './priceSeed.js';

const { XChainSDK, WalletUtils } = xchainSdk;

export { expectConfirmModal, mintXchain, unlockAfterReload };

/** The wallet's chain id for the venue, and the explorer coin code it answers under. */
export const TESTNET_CHAIN_ID = 'bitcoin-testnet';
export const TESTNET_COIN = coinPrefix(TESTNET_CHAIN_ID);
export const TESTNET_CHAIN_LABEL = 'Bitcoin';
export const TESTNET_TICKER = 'BTC';
export const GAS_TICK = 'XCHAIN';

/** Bech32 HRP plus the legacy version bytes Bitcoin testnet addresses carry. */
export const TESTNET_ADDRESS_RE = /^(tb1|[mn2])/;

/** bitcoinjs-compatible params for the venue, from the SDK's own registry. */
export const TESTNET_NETWORK = getNetwork(TESTNET_CHAIN_ID);

/** Below this a p2wpkh change output is non-standard; the SDK registry carries it. */
export const TESTNET_DUST_SATS = TESTNET_NETWORK.dustThreshold;

/** sat/vB the funding transaction pays unless a caller says otherwise. */
export const DEFAULT_FEE_RATE = 2;

/**
 * How old the newest indexed block may be before the venue is refused as
 * stale. Testnet difficulty resets let blocks arrive twenty minutes apart on
 * a quiet day, so this is hours, not minutes; the explorer's own `stale` flag
 * is honoured first and this is the ceiling behind it.
 */
export const MAX_TIP_AGE_SECONDS = 3 * 60 * 60;

/** A public chain is polled, never mined, so the cadence is a block's order of magnitude. */
export const POLL_INTERVAL_MS = 30_000;

// The regtest fixture keys its page walks on the chain label its venue table
// names, and every helper this file borrows from it is only correct while that
// label is "Bitcoin". A run launched with XC_REGTEST_COIN pointed elsewhere
// would drive Litecoin pickers against a Bitcoin testnet wallet.
if (REGTEST_COIN !== 'RBTC') {
    throw new Error(
        `the testnet harness drives Bitcoin only; unset XC_REGTEST_COIN (it is ${REGTEST_COIN})`,
    );
}

/**
 * The venue's service URLs, from the shipped descriptor.
 *
 * @param {{ get: (id: string) => any }} [registry]
 * @returns {{ explorerUrl: string, encoderUrl: string, hubUrl: string }}
 */
export function testnetEndpoints(registry = defaultRegistry()) {
    const descriptor = registry.get(TESTNET_CHAIN_ID);
    if (!descriptor) {
        throw new Error(`the bundled chain registry carries no ${TESTNET_CHAIN_ID} descriptor`);
    }
    return {
        explorerUrl: joinEndpoint(descriptor.explorer),
        encoderUrl: joinEndpoint(descriptor.encoder),
        hubUrl: joinEndpoint(descriptor.hub),
    };
}

/**
 * The seven reads and one write this harness makes, over the real SDK.
 *
 * Narrowed to exactly these on purpose: a spec or a helper cannot reach a
 * miner or a clock through this object because the object has no such
 * method, and the unit suite drives the same shape with test doubles.
 *
 * @param {{ explorerUrl: string, encoderUrl: string, hubUrl: string }} [endpoints]
 */
export function liveVenue(endpoints = testnetEndpoints()) {
    const client = new XChainSDK({ network: TESTNET_CHAIN_ID, ...endpoints, timeout: 30_000 });
    return {
        status: () => client.explorer.getStatus(),
        feeQuote: (query) => client.explorer.getFeeQuote(query),
        balances: (address) => client.explorer.getBalances(address),
        actions: (opts) => client.explorer.getActions(opts),
        action: (index) => client.explorer.getAction(index),
        utxos: (address) => client.encoder.getUTXOs(address),
        broadcast: (txHex) => client.encoder.broadcastTx(txHex),
    };
}

/**
 * Is the public venue fit to start a spec on? Null when it is, else the
 * sentence to put in front of the operator.
 *
 * The height checks are the regtest verdict's (an indexed height that
 * disagrees with the tip while lag reads zero is a wedge, a lag is a wait);
 * the two in front of them are what a PUBLIC replica adds. The explorer
 * publishes `stale` and `replica_halted` per coin from its own clock, and a
 * halted replica keeps reporting a small lag until its source mints past it,
 * so the flags are read before the heights.
 *
 * @param {any} status the explorer's `/api/status` body
 * @param {string} [coin]
 * @param {{ now?: () => number, maxTipAgeSeconds?: number }} [opts]
 */
export function testnetVerdict(status, coin = TESTNET_COIN, opts = {}) {
    const health = status?.decoder_health?.[coin];
    if (health && health !== 'healthy') {
        return `Testnet ${coin} decoder reports "${health}"; this is a venue outage, not a wallet defect.`;
    }
    if (status?.replica_halted?.[coin] === true) {
        return `Testnet ${coin} explorer replica is HALTED; its rows stop at the halt, so nothing a spec waits for will index.`;
    }
    if (status?.stale?.[coin] === true) {
        return `Testnet ${coin} explorer marks its own tip STALE (${status?.tip_age_seconds?.[coin]}s old); do not start a spec on it.`;
    }

    const lag = status?.chain_lag_blocks?.[coin];
    if (typeof lag !== 'number') {
        return `Explorer answered but reports no ${coin} chain.`;
    }
    const tip = status?.chain_tip?.[coin];
    const indexed = status?.last_block?.[coin];
    if (typeof tip === 'number' && typeof indexed === 'number' && tip - indexed > 2) {
        return `Testnet ${coin} is WEDGED: the chain tip is ${tip} but only ${indexed} is indexed `
            + `(${tip - indexed} blocks behind), while chain_lag_blocks reports ${lag}.`;
    }
    if (lag > 2) {
        return `Testnet ${coin} indexer is ${lag} blocks behind; wait for it to catch up.`;
    }

    const maxAge = opts.maxTipAgeSeconds ?? MAX_TIP_AGE_SECONDS;
    const tipTime = Number(status?.last_block_time?.[coin]);
    const now = Math.floor((opts.now ?? Date.now)() / 1000);
    if (Number.isFinite(tipTime) && tipTime > 0 && now - tipTime > maxAge) {
        return `Testnet ${coin} newest indexed block is ${now - tipTime}s old (ceiling ${maxAge}s); `
            + 'the explorer is not following the chain.';
    }
    return null;
}

/**
 * Read-only venue check: reachable, fit, and able to price a MINT of the gas
 * tick. Throws naming the cause; returns what the run is starting against.
 *
 * The price probe quotes from a key generated for the call and thrown away,
 * because the quote needs SOME source address and this file names none. It
 * is a read: nothing is signed or sent.
 *
 * @param {ReturnType<typeof liveVenue>} venue
 * @param {{ now?: () => number, maxTipAgeSeconds?: number, wallet?: any }} [opts]
 */
export async function checkTestnetVenue(venue, opts = {}) {
    let status;
    try {
        status = await venue.status();
    } catch (err) {
        throw new Error(`Testnet venue unreachable: the explorer did not answer /api/status: ${err?.message || err}`);
    }
    const unfit = testnetVerdict(status, TESTNET_COIN, opts);
    if (unfit) throw new Error(unfit);

    const wallet = opts.wallet ?? new WalletUtils(TESTNET_CHAIN_ID);
    const probe = wallet.generateKeyPair();
    const source = wallet.deriveAddress(probe.publicKey, { type: 'p2wpkh' });
    if (Buffer.isBuffer(probe.privateKey)) probe.privateKey.fill(0);

    let body;
    try {
        body = await venue.feeQuote({ action: 'MINT', params: `0|${GAS_TICK}|1`, source });
    } catch (err) {
        throw new Error(`Testnet venue cannot be priced: /feequote did not answer: ${err?.message || err}`);
    }
    const price = priceVerdict(body);
    if (!price.usable) {
        throw new Error(`Testnet venue cannot price a ${GAS_TICK} MINT: ${price.reason}`);
    }
    return {
        tip: status?.chain_tip?.[TESTNET_COIN] ?? null,
        indexed: status?.last_block?.[TESTNET_COIN] ?? null,
        tipAgeSeconds: status?.tip_age_seconds?.[TESTNET_COIN] ?? null,
        price,
    };
}

/**
 * Reads the whole of `stdin` and returns the treasury object it carries.
 *
 * The JSON text and the parsed object are the only two places the WIF ever
 * exists in this process, and both are locals here or the caller's. `address`
 * is the declared p2wpkh address the key must derive to; `segwitAddress` is
 * accepted as its alias because the existing treasury file spells it so.
 *
 * @param {NodeJS.ReadableStream} [stdin]
 * @returns {Promise<{ wif: string, address: string }>}
 */
export async function readTreasuryFromStdin(stdin = process.stdin) {
    const raw = await new Promise((resolve, reject) => {
        let text = '';
        stdin.setEncoding('utf8');
        stdin.on('data', (chunk) => { text += chunk; });
        stdin.on('end', () => resolve(text));
        stdin.on('error', reject);
    });
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('treasury stdin is not a JSON object');
    }
    const address = parsed?.address ?? parsed?.segwitAddress;
    if (typeof parsed?.wif !== 'string' || typeof address !== 'string') {
        throw new Error('treasury stdin must carry string fields wif and address');
    }
    if (!TESTNET_ADDRESS_RE.test(address)) {
        throw new Error('treasury address is not a Bitcoin testnet address');
    }
    return { wif: parsed.wif, address };
}

/** The scriptPubKey hex an address pays, for comparing against a UTXO row. */
export function outputScriptHex(address) {
    return Buffer.from(bitcoin.address.toOutputScript(address, TESTNET_NETWORK)).toString('hex');
}

/** Estimated virtual size of a p2wpkh spend, so the fee can be sized before signing. */
export function estimateVbytes(inputs, outputs) {
    return 11 + 68 * inputs + 31 * outputs;
}

/**
 * Chooses confirmed treasury inputs for a spend and sizes its fee and change.
 * Pure, so the unit suite can falsify every refusal against a fixed UTXO set.
 *
 * Unconfirmed rows are EXCLUDED, not refused: a mempool row is a normal thing
 * for the treasury to carry between two runs, and spending it would chain
 * this transaction on an unconfirmed parent. A confirmed row whose script
 * does not pay the treasury is REFUSED, not skipped: the tracker was asked
 * for one address's outputs, so a foreign script is a wrong answer and the
 * only safe move is to stop.
 *
 * @param {{ utxos: any[], treasuryScript: string, sendSats: number, feeRate?: number, dustSats?: number }} args
 * @returns {{ inputs: any[], fee: number, change: number, total: number }}
 */
export function selectTreasuryInputs({ utxos, treasuryScript, sendSats, feeRate = DEFAULT_FEE_RATE, dustSats = TESTNET_DUST_SATS }) {
    if (!Number.isInteger(sendSats) || sendSats <= 0) {
        throw new Error(`sendSats must be a positive integer, got ${sendSats}`);
    }
    const confirmed = (utxos || []).filter((u) => Number(u?.confirmations) >= 1);
    for (const u of confirmed) {
        if (String(u.scriptPubKey || '').toLowerCase() !== treasuryScript.toLowerCase()) {
            throw new Error(`INPUT SCRIPT MISMATCH: ${u.txid}:${u.vout} does not pay the treasury address; refusing to sign`);
        }
    }
    const candidates = confirmed.slice().sort((a, b) => Number(b.value) - Number(a.value));

    const inputs = [];
    let total = 0;
    for (const u of candidates) {
        inputs.push(u);
        total += Number(u.value);
        const fee = Math.ceil(estimateVbytes(inputs.length, 2) * feeRate);
        if (total >= sendSats + fee) {
            const change = total - sendSats - fee;
            // A change output under the dust floor makes the whole transaction
            // non-standard, so it folds into the fee instead of being sent.
            return change > dustSats
                ? { inputs, fee, change, total }
                : { inputs, fee: total - sendSats, change: 0, total };
        }
    }
    throw new Error(
        `INSUFFICIENT VALUE: the treasury holds ${total} confirmed sats over ${inputs.length} input(s) `
        + `and the spend needs ${sendSats} plus fee; nothing was broadcast`,
    );
}

/**
 * Refuses a treasury whose WIF does not derive its declared p2wpkh address.
 *
 * The key buffer the SDK hands back is zeroed as soon as the public key has
 * been read off it; the WIF string itself stays with the caller for the one
 * signing call. Signing with a key that does not own the inputs produces a
 * transaction the network rejects, and doing that silently on a live chain
 * is how a treasury gets probed by trial and error, so this runs BEFORE the
 * tracker is even asked for the address's coins.
 */
export function assertTreasuryKey(treasury, wallet = new WalletUtils(TESTNET_CHAIN_ID)) {
    const keys = wallet.importWIF(treasury.wif);
    const derived = wallet.deriveAddress(keys.publicKey, { type: 'p2wpkh' });
    if (Buffer.isBuffer(keys.privateKey)) keys.privateKey.fill(0);
    if (derived !== treasury.address) {
        throw new Error('KEY/ADDRESS MISMATCH: the treasury WIF does not derive the declared address; refusing to sign');
    }
}

/**
 * Builds and signs the funding transaction, or refuses before signing.
 *
 * ORDER IS THE POINT. The key is proven to own the declared address before
 * any UTXO is looked at; input selection then proves every input pays that
 * address and that the value covers the spend. Only then is a PSBT built and
 * signed, through the SDK's own signer.
 *
 * @param {{ treasury: { wif: string, address: string }, utxos: any[], destination: string,
 *           sendSats: number, feeRate?: number, wallet?: any }} args
 * @returns {{ txHex: string, txid: string, fee: number, change: number, inputs: number }}
 */
export function buildTreasuryFunding({ treasury, utxos, destination, sendSats, feeRate = DEFAULT_FEE_RATE, wallet }) {
    const signer = wallet ?? new WalletUtils(TESTNET_CHAIN_ID);
    assertTreasuryKey(treasury, signer);

    const treasuryScript = outputScriptHex(treasury.address);
    const picked = selectTreasuryInputs({ utxos, treasuryScript, sendSats, feeRate });

    const psbt = new bitcoin.Psbt({ network: TESTNET_NETWORK });
    for (const u of picked.inputs) {
        psbt.addInput({
            hash: u.txid,
            index: Number(u.vout),
            witnessUtxo: { script: Buffer.from(treasuryScript, 'hex'), value: Number(u.value) },
        });
    }
    psbt.addOutput({ address: destination, value: sendSats });
    if (picked.change > 0) psbt.addOutput({ address: treasury.address, value: picked.change });

    const signed = signer.signPsbt(psbt.toHex(), treasury.wif);
    if (!signed?.txHex) throw new Error('the SDK signer did not finalize the funding transaction');
    return { txHex: signed.txHex, txid: signed.txid, fee: picked.fee, change: picked.change, inputs: picked.inputs.length };
}

/**
 * Tops up `destination` from the treasury: the one write in this harness.
 *
 * Stdin is read only once the destination is known and well-formed, so a
 * spec that fails before it has an address never consumes the key. The
 * result carries the txid and the accounting, never the key or the address
 * it came from.
 *
 * @param {{ destination: string, sendSats: number, venue: ReturnType<typeof liveVenue>,
 *           stdin?: NodeJS.ReadableStream, feeRate?: number, wallet?: any, log?: (line: string) => void }} args
 */
export async function fundFromTreasury({ destination, sendSats, venue, stdin, feeRate, wallet, log = console.log }) {
    if (typeof destination !== 'string' || !TESTNET_ADDRESS_RE.test(destination)) {
        throw new Error(`no testnet destination to fund (got ${JSON.stringify(destination)}); the treasury was not read`);
    }
    const treasury = await readTreasuryFromStdin(stdin);
    const signer = wallet ?? new WalletUtils(TESTNET_CHAIN_ID);
    assertTreasuryKey(treasury, signer);
    const view = await venue.utxos(treasury.address);
    const utxos = Array.isArray(view?.utxos) ? view.utxos : [];
    const tx = buildTreasuryFunding({ treasury, utxos, destination, sendSats, feeRate, wallet: signer });
    const result = await venue.broadcast(tx.txHex);
    const txid = result?.txid || tx.txid;
    log(`[testnet ${TESTNET_COIN}] funded ${destination} with ${sendSats} sats over ${tx.inputs} input(s), `
        + `fee ${tx.fee}, change ${tx.change}: ${txid}`);
    return { txid, fee: tx.fee, change: tx.change };
}

/** One poll loop: `read` until `accept`, sleeping between passes, never mining. */
async function pollUntil({ read, accept, what, timeoutMs, sleep = defaultSleep, now = Date.now }) {
    const deadline = now() + timeoutMs;
    let last = null;
    while (now() < deadline) {
        try {
            last = await read();
            if (accept(last)) return last;
        } catch { /* a blip on a public explorer is a retry, not a verdict */ }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`${what} never observed within ${Math.round(timeoutMs / 1000)}s; last=${JSON.stringify(last)?.slice(0, 300)}`);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for `txid` to sit confirmed on `address` in the tracker's view.
 * Testnet blocks are ten minutes apart on a good day, hence the budget.
 */
export function waitForFundingConfirmed(venue, address, txid, { timeoutMs = 3_600_000, sleep, now } = {}) {
    return pollUntil({
        read: () => venue.utxos(address),
        accept: (view) => (view?.utxos || []).some((u) => u.txid === txid && Number(u.confirmations) >= 1),
        what: `funding ${txid} confirmed to ${address}`,
        timeoutMs, sleep, now,
    });
}

/** Polls the explorer until `address` holds at least `min` of `tick`; returns the row. */
export async function waitForTokenBalance(venue, address, tick, min, { timeoutMs = 3_600_000, sleep, now } = {}) {
    const body = await pollUntil({
        read: () => venue.balances(address),
        accept: (b) => (b?.data || []).some((row) => row.tick === tick && Number(row.amount) >= min),
        what: `${tick} balance of at least ${min} for ${address}`,
        timeoutMs, sleep, now,
    });
    return body.data.find((row) => row.tick === tick);
}

/**
 * Waits for the action behind `txid` to index, then asserts the chain judged
 * it VALID (an `invalid: insufficient funds` row is also "an action was
 * recorded", so presence alone proves nothing). Returns the detail.
 */
export async function waitForValidAction(venue, txid, { timeoutMs = 3_600_000, sleep, now } = {}) {
    const row = await pollUntil({
        read: async () => (await venue.actions({ limit: 100 }))?.data?.find((r) => r.tx_hash === txid) ?? null,
        accept: (found) => found !== null,
        what: `an XChain action for ${txid}`,
        timeoutMs, sleep, now,
    });
    const detail = await venue.action(row.action_index);
    const statuses = [];
    if (typeof detail?.status === 'string') statuses.push(detail.status);
    for (const leg of detail?.sends || []) if (typeof leg?.status === 'string') statuses.push(leg.status);
    if (statuses.length === 0) throw new Error(`action ${row.action_index} for ${txid} exposes no status to judge`);
    for (const status of statuses) {
        if (status !== 'valid') throw new Error(`chain rejected the action for ${txid}: ${status}`);
    }
    return detail;
}

/**
 * Waits for the INDEXED height to reach `height`. The indexed height, not the
 * node tip: UNSTAKE gates on `activation_block <= blockIndex` inside the
 * indexer, and a tip the indexer has not processed yet is a block the wallet's
 * reads cannot see. Returns the status body that satisfied it.
 */
export function waitForActivationHeight(venue, height, { timeoutMs = 3_600_000 * 2, sleep, now } = {}) {
    return pollUntil({
        read: () => venue.status(),
        accept: (s) => Number(s?.last_block?.[TESTNET_COIN]) >= Number(height),
        what: `indexed ${TESTNET_COIN} height ${height}`,
        timeoutMs, sleep, now,
    });
}

/**
 * Flips the wallet onto testnet and waits for it to come back up. Testnet is
 * listed without Developer Mode (only regtest is hidden), so this is one
 * select on the Settings index; the switch reloads and re-locks the vault.
 */
export async function switchToTestnet(page, password) {
    await openSettings(page);
    await page.getByLabel('Active network').selectOption('testnet');
    await unlockAfterReload(page, password);
}

/**
 * Reads the wallet's own testnet receive address off the Receive screen.
 * Addresses derive from a random seed at creation, so a spec cannot know it
 * in advance; the shape assertion is what keeps a mainnet or regtest address
 * from being funded by mistake.
 */
export async function readTestnetReceiveAddress(page) {
    await gotoSection(page, 'Receive');
    const field = page.getByLabel('Address', { exact: true });
    await expect(field).toBeVisible({ timeout: 30_000 });
    await expect(field, 'Receive never showed a Bitcoin testnet address')
        .toHaveValue(TESTNET_ADDRESS_RE, { timeout: 30_000 });
    return field.inputValue();
}
