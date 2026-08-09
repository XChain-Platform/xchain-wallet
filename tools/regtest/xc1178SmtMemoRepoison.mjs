#!/usr/bin/env node
// tools/regtest/xc1178SmtMemoRepoison.mjs - 's venue proof.
//
// WHAT THIS ANSWERS THAT A UNIT TEST CANNOT
//
// 's fix (`xchain-indexer` 297c7cb) clears `_smtTickNameCache` /
// `_smtAddressNameCache` in the `finally` of every transaction ABORT, and
// `test/unit/actions.dryRunSmtMemoInvalidation.test.js` pins the coupling
// against a real Database. 's verify clause is a different question: it
// asks whether the LTC REGTEST VENUE, the deployed process, still wedges. Only
// the venue can answer that, so this driver asks it.
//
// WHY A RESTART PROVES NOTHING
//
// The poisoned entry lives in process memory, so restarting the container
// clears it. Any ISSUE broadcast after a restart therefore indexes cleanly on
// PRE-FIX code too, and reads as a pass. The proof has to RE-POISON on purpose:
//
//   1. quote an ISSUE for a tick that is never broadcast. Its dry run interns
//      that tick at MAX(id)+1, fills the memo with id -> the quoted name, and
//      rolls back, which hands the id straight back;
//   2. compose the real ISSUE, which quotes the fee again. That second quote
//      takes the same freed id, but `_smtTickName` answers from the memo when
//      it already holds the id, so the poisoned entry survives untouched;
//   3. broadcast the real ISSUE, which MINTS its supply. It takes the freed id,
//      moves a brand-new [address, TICK] balance key, and the choke point
//      records that key under whichever name the memo holds.
//
// THE ORDER IS THE EXPERIMENT. `_smtTickName` is first-writer-wins (it returns
// a cached id without re-reading the row), so quoting the REAL tick before the
// abandoned one seeds the memo with the CORRECT name and the run passes on
// pre-fix code, proving nothing. Measured that way round first, 2026-08-08.
//
// On pre-fix code the memo still says the quoted name, the balances touched-set
// guard refuses the block ("the ledger moved 1 key(s) the commitment did not
// apply"), and the indexer retries the same block forever: a HALTED VENUE, which
// `waitForAction` below reports as such. On fixed code step 2's rollback drops
// the memo, the block applies, and the ISSUE indexes valid.
//
// The mint is not decoration. An ISSUE with no supply moves no balance and
// records no touched key, which is exactly why the shipped workaround in
// `watcherLaneNativeFee.mjs` dodges this defect rather than proving it.
//
// VENUE
//
// Run it on devhost, where the encoder / miner / explorer ports are local and
// ~/Sites is the same NFS path as the Mac:
//
//   ssh devhost 'cd ~/Sites/XChain-Platform/xchain-wallet && \
//     node tools/regtest/xc1178SmtMemoRepoison.mjs litecoin-regtest'
//
// RECOVERY. A pre-fix run leaves the indexer wedged on the block it refused.
// `docker restart xchain-node-litecoin-regtest-xchain-indexer` clears it and the
// chain drains to tip; that is the whole recovery, and no state is lost.
//
// The WIF is generated here, used once on regtest, and never printed.

import { createRequire } from 'node:module';
import { registry as registryLib } from '../../packages/core/src/index.js';
import { SDKRegistry } from '../../packages/core/src/sdk/SDKRegistry.js';
import { adaptXChainSDK } from '../../packages/core/src/sdk/defaultFactory.js';
import { buildActionPsbt } from '../../packages/core/src/flows/buildActionPsbt.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require(process.env.XCHAIN_SDK_PATH || 'xchain-sdk');

const CHAINS = {
    'litecoin-regtest': { regtestCoin: 'RLTC', addressType: 'p2wpkh', coinTicker: 'LTC', path: "m/84'/2'/0'/0/0" },
    'dogecoin-regtest': { regtestCoin: 'RDOGE', addressType: 'p2pkh', coinTicker: 'DOGE', path: "m/44'/3'/0'/0/0" },
};

const chainId = process.argv[2] || 'litecoin-regtest';
const cfg = CHAINS[chainId];
if (!cfg) {
    console.error(`unknown chain "${chainId}"; expected one of ${Object.keys(CHAINS).join(', ')}`);
    process.exit(2);
}

// The e2e venue helpers read their chain from the environment at import time.
process.env.XC_REGTEST_COIN = cfg.regtestCoin;
const venue = await import('../../test/e2e/fixtures/regtest.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
function check(ok, what, detail) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? ` (${detail})` : ''}`);
    if (!ok) failures.push(what);
    return ok;
}

/** Chain tip, indexed tip and the gap between them, as the explorer reports it. */
async function venueHealth() {
    const res = await fetch(`${venue.EXPLORER_URL}/${cfg.regtestCoin}/api/status`,
        { signal: AbortSignal.timeout(15_000) });
    const s = await res.json();
    return {
        indexed: Number(s?.last_block?.[cfg.regtestCoin]),
        decoded: Number(s?.decoder_tip?.[cfg.regtestCoin]),
        // decoder_lag_blocks is the decoder tip MINUS the indexer's last block,
        // so despite the name it is the INDEXER's lag.
        lag: Number(s?.decoder_lag_blocks?.[cfg.regtestCoin]),
    };
}

/** Names the wedge in one line, with its recovery, so nobody reads it as a compose defect. */
function wedgeMessage(health) {
    return `WEDGED: the indexer is at block ${health.indexed} while the decoder is at `
        + `${health.decoded} (lag ${health.lag}) and is not advancing. On a PRE-FIX venue that is `
        + ' reproducing: check `docker logs --tail 40 xchain-node-'
        + `${cfg.regtestCoin === 'RLTC' ? 'litecoin' : 'dogecoin'}-regtest-xchain-indexer` + '` '
        + 'for a repeating balances touched-set guard, and restart that one container to recover.';
}

/** The explorer's verdict on the action carried by `txid`, or null while none is indexed. */
async function actionFor(txid) {
    const res = await fetch(`${venue.EXPLORER_URL}/${cfg.regtestCoin}/api/actions?limit=100`,
        { signal: AbortSignal.timeout(20_000) });
    const body = await res.json();
    const row = (body?.data || []).find((r) => r.tx_hash === txid || r.txid === txid);
    if (!row) return null;
    const detailRes = await fetch(`${venue.EXPLORER_URL}/${cfg.regtestCoin}/api/action/${row.action_index}`,
        { signal: AbortSignal.timeout(20_000) });
    return { ...row, ...(await detailRes.json()) };
}

/**
 * Waits for the indexer to record an action for `txid`, nudging the chain along.
 *
 * Nudges rather than mining every pass: a loop that mines unconditionally
 * outruns the indexer and then responds to the missing state by mining harder.
 */
async function waitForAction(txid, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let lastIndexed = null;
    let stalledPasses = 0;
    while (Date.now() < deadline) {
        const found = await actionFor(txid).catch(() => null);
        if (found) return found;

        const health = await venueHealth().catch(() => null);
        if (health && Number.isFinite(health.indexed)) {
            if (health.indexed === lastIndexed && health.lag > 0) stalledPasses += 1;
            else stalledPasses = 0;
            lastIndexed = health.indexed;
            if (stalledPasses >= 12) throw new Error(wedgeMessage(health));
        }

        await venue.nudgeChain();
        await sleep(3_000);
    }
    throw new Error(`the indexer never recorded an action for ${txid} within ${timeoutMs}ms`);
}

async function main() {
    console.log(`chain: ${chainId} (${cfg.regtestCoin}), explorer ${venue.EXPLORER_URL}`);

    // A venue already behind cannot answer anything asked below, and every leg
    // would fail on a symptom that has nothing to do with this driver.
    const health = await venueHealth();
    if (!(health.lag <= 3)) throw new Error(wedgeMessage(health));
    console.log(`venue: indexed block ${health.indexed}, lag ${health.lag}`);

    // A fee-bearing action needs a current oracle price, now and in several
    // minutes' time, or the legs below fail on the oracle .
    const priced = await venue.seedPrices();
    console.log(`price: ${priced.reason || (priced.seeded ? 'reseeded' : 'ok')}`);

    const chainRegistry = registryLib.defaultRegistry();
    if (!chainRegistry.get(chainId)) throw new Error(`no chain descriptor for ${chainId}`);
    const sdkRegistry = new SDKRegistry({ chainRegistry, sdkFactory: adaptXChainSDK(XChainSDK) });
    const sdk = sdkRegistry.get(chainId);
    await sdk.ready?.();

    // Throwaway regtest key. Never printed.
    const kp = sdk.wallet.generateKeyPair();
    const wif = kp.wif;
    const publicKey = kp.publicKeyHex;
    const address = sdk.wallet.deriveAddress(kp.publicKey, { type: cfg.addressType });
    console.log(`source: ${address}`);

    // Ticks are claimed once on chain, so both names are minted per run: a fixed
    // pair would make the second run fail on "tick exists" for a reason that has
    // nothing to do with the memo.
    const stamp = Date.now().toString().slice(-7);
    const realTick = `XCREAL${stamp}`;
    const poisonTick = `XCPOIS${stamp}`;

    // MINT_SUPPLY is the whole point: it moves a brand-new [address, TICK]
    // balance key, which is the touched key the guard checks against the memo.
    const realIssue = {
        action: 'ISSUE',
        params: { VERSION: '0', TICK: realTick, DECIMALS: '0', MAX_SUPPLY: '1000', MINT_SUPPLY: '1000' },
    };
    // Composed identically so its dry run interns a tick the same way, and never
    // broadcast, so the id it takes is handed straight back on rollback.
    const poisonIssue = {
        action: 'ISSUE',
        params: { VERSION: '0', TICK: poisonTick, DECIMALS: '0', MAX_SUPPLY: '1000', MINT_SUPPLY: '1000' },
    };

    // -------------------------------------------------------------- POISON
    // The FIRST dry run of the run, deliberately. It has to be the one that
    // interns the freed id, or the memo already holds the right name (see THE
    // ORDER IS THE EXPERIMENT in the header). It doubles as the funding quote:
    // the fee schedule prices an ISSUE by its action, not by its tick, so
    // quoting the abandoned one funds the real one exactly.
    console.log(`\npoison: quote ISSUE ${poisonTick}, never broadcast`);
    const quote = await sdk.quoteNativeFee(poisonIssue, { source: address }).catch((err) => {
        // A quote that never reached the dry run poisons nothing, so everything
        // below would pass for the wrong reason. Fail here instead.
        throw new Error(`the poison quote did not run: ${err?.message || err}`);
    });
    const feeCoins = Number(quote?.requiredFeeNative) || Number(quote?.requiredFeeSats) / 1e8;
    if (!quote?.feeDestination || !Number.isFinite(feeCoins) || feeCoins <= 0) {
        throw new Error('the venue cannot price a fresh ISSUE right now, so nothing below could be '
            + `attributed to the indexer: ${JSON.stringify(quote)}`);
    }
    check(true, 'the poison ISSUE priced, so its dry run reached the real handler and interned the tick',
        `${feeCoins} ${cfg.coinTicker}`);

    const funding = Math.max(5, Math.ceil(feeCoins * 4) + 5);
    console.log(`fee destination: ${quote.feeDestination}, ISSUE quoted ${feeCoins} ${cfg.coinTicker}`);
    console.log(`funding ${funding} ${cfg.coinTicker} ...`);
    await venue.fundAddress(address, funding);

    // ------------------------------------------------------------- COMPOSE
    console.log(`\ncompose ISSUE ${realTick} minting 1000 of its 1000 cap`);
    const build = await buildActionPsbt({
        sdkRegistry,
        chainRegistry,
        chainId,
        from: { address, publicKey, derivationPath: cfg.path },
        actionData: realIssue,
        encoderOpts: { payFeeInNativeCoin: true },
    });
    check(Boolean(build?.psbtHex), 'the encoder returned a PSBT for the minting ISSUE');
    if (failures.length) return;

    // ----------------------------------------------------------- BROADCAST
    console.log('\nbroadcast the minting ISSUE into the id the poison quote just freed');
    const signed = sdk.wallet.signPsbt(build.psbtHex, wif);
    await sdk.encoder.broadcastTx(signed.txHex);
    console.log(`  txid ${signed.txid}`);

    const indexed = await waitForAction(signed.txid);
    check(String(indexed.status) === 'valid',
        `the re-poisoned minting ISSUE of ${realTick} indexed valid`,
        `status "${indexed.status}"`);

    // The venue has to be AT TIP afterwards, not merely to have recorded a row:
    // the wedge is a block that rolls back and retries, and a retried block can
    // still show its action once before the guard refuses the commitment.
    await sleep(4_000);
    const after = await venueHealth();
    check(after.lag <= 3, 'and the indexer stayed at tip rather than rolling the block back',
        `indexed ${after.indexed}, decoded ${after.decoded}, lag ${after.lag}`);

    // The balance is the touched key the guard argues about, so read it back.
    const balRes = await fetch(`${venue.EXPLORER_URL}/${cfg.regtestCoin}/api/balances/${address}`,
        { signal: AbortSignal.timeout(20_000) });
    const balances = await balRes.json().catch(() => null);
    const rows = Array.isArray(balances?.data) ? balances.data : (balances?.balances || []);
    const minted = rows.find((b) => String(b.tick).toUpperCase() === realTick);
    check(Boolean(minted), `and the minted [address, ${realTick}] balance is committed`,
        minted ? `amount ${minted.amount ?? minted.balance}` : 'no balance row');
}

main()
    .then(() => {
        if (failures.length) {
            console.log(`\nRESULT: ${failures.length} assertion(s) failed`);
            process.exit(1);
        }
        console.log('\nRESULT: a deliberately re-poisoned resolver cache no longer wedges the venue');
        process.exit(0);
    })
    .catch((err) => {
        console.error('FAILED:', err?.stack || err?.message || err);
        process.exit(1);
    });
