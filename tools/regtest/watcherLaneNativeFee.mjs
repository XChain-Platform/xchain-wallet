#!/usr/bin/env node
// tools/regtest/watcherLaneNativeFee.mjs - 's on-chain residual.
//
// WHAT IS STILL OWED AFTER THE UNIT LANE
//
//  threaded the native-coin protocol fee onto `SellOwnershipForm`'s
// SUBMIT path and not onto its WATCHER path, so a watcher-mode name sale off
// Bitcoin composed a PSBT with no FEE_DESTINATION output, the user signed it,
// and the indexer then rejected the action "insufficient fee (native coin
// output required)" while the form reported the sale as open.  fixed the
// lane and pinned it with `test/unit/flows/buildActionPsbtNativeFeeOutput.test.js`,
// which drives the real `buildActionPsbt` against a FAKE sdk and inspects the
// arguments `encoder.createTx` receives.
//
// That unit lane cannot answer two questions, and they are the ones that
// actually decide whether a user's sale works:
//
//   1. does the ENCODER put the composed customOutput into the PSBT it returns,
//      or does it drop it somewhere between `createTx` and the bytes handed to
//      the signer;
//   2. does the INDEXER accept the resulting action.
//
// Only a chain can answer those, so this driver asks one. It is the same shape
// as `deployNativeFee.mjs` : production wallet code, a real venue, a
// throwaway WIF standing in for the vault, and a verdict read back off the
// explorer rather than off the wallet's own report.
//
// WHY A DRIVER RATHER THAN A PLAYWRIGHT SPEC
//
// `test/e2e/tests/fees/native-fee-submit-lanes.regtest.spec.js` LANE 2 already
// drives a watcher build through the UI, on Bitcoin, as a DIFFERENTIAL (build
// twice, flag off then on, assert the bytes differ). That differential only
// works where the flag is a genuine opt-in, which is Bitcoin alone: off Bitcoin
// the fee is MANDATORY  and the form forces the toggle on, so there is
// no "off" build to compare against and no way, through the UI, to compose the
// shape the broken forms produced. This driver reaches the lane one level below
// the form, where the broken shape is still expressible, and asserts on the
// composed OUTPUT SET instead of on a byte-length delta.
//
// WHAT IT PROVES, in order, each leg failing loudly on its own terms:
//
//   ISSUE     a watcher-composed, natively-priced ISSUE carries the fee output
//             and indexes valid. This is setup (the sale needs a name to sell)
//             and evidence at the same time.
//   NEGATIVE  the same ORDER composed WITHOUT the flag - the exact shape every
//             form whose  fix stopped at the submit path produced -
//             carries NO fee output, broadcasts happily, and is REJECTED by the
//             indexer for the fee. This is the regression itself, reproduced on
//             chain, and it is what makes the positive leg attributable.
//   POSITIVE  the same ORDER composed WITH the flag carries exactly one
//             FEE_DESTINATION output for the quoted amount, and the indexer
//             accepts it AND records the fee as paid in coin (payment_mode 1).
//
// The negative runs FIRST on purpose: a valid ownership sale escrows the name,
// after which a second sale of it is refused as "ownership already escrowed" -
// a rejection that has nothing to do with fees and would read exactly like the
// one this driver is trying to attribute.
//
// VENUE
//
// Litecoin regtest by default, because the fee is mandatory there and the flag
// is therefore not merely decorative. Dogecoin regtest works the same way; both
// need this stack reachable on localhost (encoder + miner for the chain, plus
// the shared explorer on 18080), which the campaign's SSH tunnel command
// already provides:
//
//   ssh -N -L 18080:localhost:18080 -L 3223:localhost:3223 \
//          -L 3225:localhost:3225 -L 3123:localhost:3123 \
//          -L 3125:localhost:3125 jdog@devhost
//
//   node tools/regtest/watcherLaneNativeFee.mjs [litecoin-regtest|dogecoin-regtest]
//
// PRICES. Nothing on a regtest stack publishes `price_snapshots`, and a seeded
// row is usable for 1800 chain-seconds, so a venue that priced an hour ago
// answers "no current oracle price" now. This driver reuses the e2e suite's own
// `seedPrices()` , which checks first and only writes when the margin is
// thin, rather than growing a second seeding recipe that could drift from it.
//
// The WIF is generated here, used once on regtest, and never printed.

import { createRequire } from 'node:module';
import { registry as registryLib } from '../../packages/core/src/index.js';
import { SDKRegistry } from '../../packages/core/src/sdk/SDKRegistry.js';
import { adaptXChainSDK } from '../../packages/core/src/sdk/defaultFactory.js';
import { buildActionPsbt } from '../../packages/core/src/flows/buildActionPsbt.js';

const require = createRequire(import.meta.url);
// The SDK the shells build against (xchain-wallet/node_modules/xchain-sdk),
// overridable for a run that has to try a sibling checkout instead.
const { XChainSDK } = require(process.env.XCHAIN_SDK_PATH || 'xchain-sdk');

const CHAINS = {
    // addressType per chain: Dogecoin has no SegWit, so its funding address is
    // legacy p2pkh. `regtestCoin` is the explorer's code for the chain and the
    // key the e2e venue table is indexed by.
    // `path` is the HD path the wallet's own address record would carry for that
    // address type. Nothing here derives from it (the key comes from a throwaway
    // WIF), but `normalizeSource` refuses a source with neither a derivation
    // path nor an addressId, so the form's shape has to be complete.
    'litecoin-regtest': { regtestCoin: 'RLTC', addressType: 'p2wpkh', coinTicker: 'LTC', path: "m/84'/2'/0'/0/0" },
    'dogecoin-regtest': { regtestCoin: 'RDOGE', addressType: 'p2pkh', coinTicker: 'DOGE', path: "m/44'/3'/0'/0/0" },
};

const chainId = process.argv[2] || 'litecoin-regtest';
const cfg = CHAINS[chainId];
if (!cfg) {
    console.error(`unknown chain "${chainId}"; expected one of ${Object.keys(CHAINS).join(', ')}. `
        + 'Bitcoin is deliberately absent: the fee is optional there, which is what the existing '
        + 'LANE 2 differential covers.');
    process.exit(2);
}

// The e2e venue helpers read their chain from the environment at import time, so
// this has to be set before the dynamic import below rather than after it.
process.env.XC_REGTEST_COIN = cfg.regtestCoin;
const venue = await import('../../test/e2e/fixtures/regtest.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Assertion tally: every leg reports, and the process exits on the total. */
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
        // decoder_lag_blocks is decoder tip MINUS the indexer's last processed
        // block, so despite the name it is the INDEXER's lag.
        lag: Number(s?.decoder_lag_blocks?.[cfg.regtestCoin]),
    };
}

/**
 * The sentence to print when the indexer stops advancing, because the shape of
 * that failure is a trap this driver walked into on its first real run.
 *
 * A wallet-composed ISSUE that MINTS its supply wedged the LTC regtest indexer:
 * the action itself parsed `valid`, and then the  balances touched-set
 * guard refused the block ("the ledger moved 1 key(s) the commitment did not
 * apply", the key being the brand-new [address, TICK] balance), rolled back, and
 * retried the same block forever. Every read after that is stale, so the driver
 * looks like it broadcast into a void.
 *
 * It is the LTC face of the stale-resolver-cache defect  has the fix for
 * and the venue does not, and the recovery is a container restart: the same
 * block applies cleanly against a fresh cache (measured 2026-08-04, block 5205
 * drained on the first restart). This driver now issues WITHOUT an initial mint
 * so it does not step on it, but a neighbouring session's mint can still wedge
 * the venue under a run in progress.
 */
function wedgeMessage(health) {
    return `the indexer has stopped advancing: it is at block ${health.indexed} while the decoder `
        + `is at ${health.decoded} (lag ${health.lag}). That is a HALTED VENUE, not a verdict on `
        + 'anything this driver composed. Check '
        + `\`docker logs --tail 40 xchain-node-${cfg.regtestCoin === 'RLTC' ? 'litecoin' : 'dogecoin'}`
        + '-regtest-xchain-indexer\` on devhost: a repeating "balances touched-set guard FAILED" '
        + 'is  firing on a stale resolver cache (, fix undeployed), and restarting that '
        + 'one container clears it.';
}

/**
 * The explorer's verdict on the action carried by `txid`, or null while it has
 * not indexed one yet.
 *
 * Two calls, for the reason `deployNativeFee.mjs` records: the LIST route does
 * not carry `status`, so reading the verdict off the list row answers
 * `undefined` for a perfectly valid action. The list resolves the txid to an
 * index; the DETAIL route is where the verdict and the fee record live.
 */
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
 * `venue.nudgeChain()` rather than a block per pass, and that is load-bearing:
 * a loop that mines unconditionally OUTRUNS the indexer, and then responds to
 * the state never appearing by mining harder. The first run of this driver put
 * the LTC indexer 100 blocks behind exactly that way. Blocks only ever advance
 * state; they never make an already-mined action visible sooner.
 */
async function waitForAction(txid, timeoutMs = 420_000) {
    const deadline = Date.now() + timeoutMs;
    let lastIndexed = null;
    let stalledPasses = 0;
    while (Date.now() < deadline) {
        const found = await actionFor(txid).catch(() => null);
        if (found) return found;

        const health = await venueHealth().catch(() => null);
        if (health && Number.isFinite(health.indexed)) {
            // Behind AND not moving is a wedge; behind and moving is just slow.
            if (health.indexed === lastIndexed && health.lag > 0) stalledPasses += 1;
            else stalledPasses = 0;
            lastIndexed = health.indexed;
            if (stalledPasses >= 15) throw new Error(wedgeMessage(health));
        }

        await venue.nudgeChain();
        await sleep(3_000);
    }
    throw new Error(`the indexer never recorded an action for ${txid} within ${timeoutMs}ms. `
        + 'That is a venue state, not a verdict: check '
        + `${venue.EXPLORER_URL}/${cfg.regtestCoin}/api/status before reading anything into it.`);
}

async function main() {
    console.log(`chain: ${chainId} (${cfg.regtestCoin}), explorer ${venue.EXPLORER_URL}`);

    // Step 0: the venue has to be able to price a fee-bearing action, now and
    // still in several minutes' time, or every leg below fails on the oracle
    // and reads as a wallet defect .
    // A venue that is already behind cannot answer anything this driver asks,
    // and every leg would fail on a symptom that reads as a wallet defect. Say
    // so first, in one line, with the recovery.
    const health = await venueHealth();
    if (!(health.lag <= 3)) throw new Error(wedgeMessage(health));
    console.log(`venue: indexed block ${health.indexed}, lag ${health.lag}`);

    const priced = await venue.seedPrices();
    console.log(`price: ${priced.reason || (priced.seeded ? 'reseeded' : 'ok')}`
        + ` (${cfg.coinTicker}/USD ${priced.coinUsdPrice}, XCHAIN/USD ${priced.xchainUsdPrice})`);

    const chainRegistry = registryLib.defaultRegistry();
    if (!chainRegistry.get(chainId)) throw new Error(`no chain descriptor for ${chainId}`);
    const sdkRegistry = new SDKRegistry({
        chainRegistry,
        sdkFactory: adaptXChainSDK(XChainSDK),
    });
    const sdk = sdkRegistry.get(chainId);
    await sdk.ready?.();

    // Throwaway regtest key: the vault's stand-in. Never printed.
    const kp = sdk.wallet.generateKeyPair();
    const wif = kp.wif;
    const publicKey = kp.publicKeyHex;
    const address = sdk.wallet.deriveAddress(kp.publicKey, { type: cfg.addressType });
    console.log(`source: ${address}`);

    /**
     * The watcher lane itself, called exactly the way the form calls it.
     *
     * `SellOwnershipForm` (and every other form's watcher branch) sends
     * `{ chainId, from, actionData, encoderOpts }` over messaging to the
     * `action.psbt` host route, which forwards it verbatim to `buildActionPsbt`.
     * So this IS the production lane, minus the messaging hop, and the two
     * `encoderOpts` shapes below are the fixed form and the broken one.
     */
    const compose = (actionData, { nativeFee }) => buildActionPsbt({
        sdkRegistry,
        chainRegistry,
        chainId,
        from: { address, publicKey, derivationPath: cfg.path },
        actionData,
        encoderOpts: nativeFee ? { payFeeInNativeCoin: true } : {},
    });

    /** Outputs of a composed PSBT that pay the venue's fee destination. */
    function feeOutputs(psbtHex, feeDestination) {
        const decomposed = sdk.wallet.decomposePsbt(psbtHex);
        return (decomposed.outputs || []).filter((o) => o.address === feeDestination);
    }

    async function signAndBroadcast(psbtHex) {
        const signed = sdk.wallet.signPsbt(psbtHex, wif);
        await sdk.encoder.broadcastTx(signed.txHex);
        return signed.txid;
    }

    // A name nobody has claimed. Ticks are claimed once on chain, so a fixed one
    // would make the second run of this driver fail on the ISSUE for a reason
    // that has nothing to do with fees.
    const tick = `SELL${Date.now().toString().slice(-6)}`;
    // The fair-mint shape `IssueTokenForm` composes when "Initial mint" is 0:
    // the cap is declared and nothing is minted yet. Deliberate, not incidental.
    // Minting at issuance moves a brand-new [address, TICK] balance key, and on
    // this venue that trips the  touched-set guard (see `wedgeMessage`) and
    // halts the indexer on the block. Ownership is what a name sale escrows, and
    // ownership exists from the ISSUE regardless of supply, so this driver needs
    // no balance and should not create one.
    const issueData = {
        action: 'ISSUE',
        params: { VERSION: '0', TICK: tick, DECIMALS: '0', MAX_SUPPLY: '1000' },
    };
    // Exactly the params `SellOwnershipForm` builds for an open order priced in
    // native coin (getMode 'coin', so no GET_TICK; no MEMO, which would push the
    // action over the 80-byte OP_RETURN limit and onto the chunk lane the
    // watcher path refuses outright).
    const saleData = {
        action: 'ORDER',
        params: {
            VERSION: '0',
            GIVE_COIN: cfg.coinTicker,
            GIVE_TICK: tick,
            GIVE_OWNERSHIP: '1',
            GET_COIN: cfg.coinTicker,
            GET_AMOUNT: '10',
        },
    };

    // Fund for the quote rather than a flat amount: the fee scales with the
    // venue's oracle price, and a run that dies in the encoder on "insufficient
    // funds" reads exactly like a wallet defect and is not one.
    //
    // Quoted off the ISSUE, not off the sale, and that is not interchangeable:
    // `computeFeeQuote` runs the REAL handler, and the sale's handler refuses a
    // tick that does not exist yet ("GIVE_TICK (unknown)"), which stages a zero
    // fee and returns with NO price fields at all - indistinguishable from a
    // venue with no oracle price, and the first run of this driver funded `NaN`
    // because of it. The ISSUE prices cleanly against a fresh tick, and
    // FEE_DESTINATION is a property of the venue rather than of the action.
    const issueQuote = await sdk.quoteNativeFee(issueData, { source: address });
    const feeDestination = issueQuote?.feeDestination;
    const issueFeeCoins = Number(issueQuote?.requiredFeeNative)
        || Number(issueQuote?.requiredFeeSats) / 1e8;
    if (!feeDestination || !Number.isFinite(issueFeeCoins) || issueFeeCoins <= 0) {
        throw new Error('the venue cannot price a fresh ISSUE right now, so nothing below could '
            + `be attributed to the wallet: ${JSON.stringify(issueQuote)}`);
    }
    const feeCoins = issueFeeCoins;
    // Six actions' worth of headroom over three legs, because the sale is priced
    // on a different schedule entry (OWNERSHIP_ESCROW) than the ISSUE.
    const funding = Math.max(5, Math.ceil(feeCoins * 6) + 5);
    console.log(`fee destination: ${feeDestination}, ISSUE quoted ${feeCoins} ${cfg.coinTicker}`);
    console.log(`funding ${funding} ${cfg.coinTicker} ...`);
    await venue.fundAddress(address, funding);

    // ---------------------------------------------------------------- ISSUE
    console.log(`\nISSUE ${tick} through the watcher lane, fee flag ON`);
    const issueBuild = await compose(issueData, { nativeFee: true });
    const issueFeeOuts = feeOutputs(issueBuild.psbtHex, feeDestination);
    check(issueFeeOuts.length === 1,
        'the ISSUE the encoder returned carries exactly one FEE_DESTINATION output',
        `found ${issueFeeOuts.length}`);
    const issueTxid = await signAndBroadcast(issueBuild.psbtHex);
    const issued = await waitForAction(issueTxid);
    check(String(issued.status) === 'valid',
        `the ISSUE of ${tick} indexed valid`, `status "${issued.status}"`);
    if (failures.length) return;   // no name to sell; the rest would be noise

    // ------------------------------------------------------------- NEGATIVE
    // The broken form's shape: everything the fixed lane does except the flag.
    console.log('\nORDER (sell the name) through the watcher lane, fee flag OFF - the regression');
    const brokenBuild = await compose(saleData, { nativeFee: false });
    check(feeOutputs(brokenBuild.psbtHex, feeDestination).length === 0,
        'a flagless watcher build composes NO fee output',
        'the control for the assertion below');
    check(brokenBuild.nativeFeeQuote == null,
        'a flagless watcher build never even quotes the fee');
    const brokenTxid = await signAndBroadcast(brokenBuild.psbtHex);
    const rejected = await waitForAction(brokenTxid);
    check(String(rejected.status).startsWith('invalid'),
        'the chain accepted that transaction and the INDEXER rejected the action',
        `status "${rejected.status}"`);
    check(/fee/i.test(String(rejected.status)),
        'and rejected it for the FEE, not for something else',
        `status "${rejected.status}"`);

    // ------------------------------------------------------------- POSITIVE
    console.log('\nORDER (sell the name) through the watcher lane, fee flag ON - the fix');
    const saleBuild = await compose(saleData, { nativeFee: true });
    const saleFeeOuts = feeOutputs(saleBuild.psbtHex, feeDestination);
    check(saleFeeOuts.length === 1,
        'the PSBT the encoder returned carries exactly one FEE_DESTINATION output',
        `found ${saleFeeOuts.length}`);
    const quotedSats = Number(saleBuild.nativeFeeQuote?.requiredFeeSats);
    check(saleFeeOuts.length === 1 && Number(saleFeeOuts[0].value) === quotedSats,
        'and it pays exactly the quoted amount',
        `output ${saleFeeOuts[0]?.value} vs quote ${quotedSats}`);
    const saleTxid = await signAndBroadcast(saleBuild.psbtHex);
    const accepted = await waitForAction(saleTxid);
    check(String(accepted.status) === 'valid',
        'the indexer ACCEPTED the watcher-composed ownership sale',
        `status "${accepted.status}"`);
    check(Number(accepted.fee?.payment_mode) === 1,
        'and recorded the protocol fee as paid in coin',
        `payment_mode ${accepted.fee?.payment_mode}`);
    check(Math.round(Number(accepted.fee?.native_coin_amount) * 1e8) === quotedSats,
        'for the amount the wallet composed',
        `chain ${accepted.fee?.native_coin_amount} vs quote ${quotedSats} sats`);
    console.log(`\naction ${accepted.action_index}: ${accepted.action} ${accepted.status}`
        + ` | fee ${accepted.fee?.native_coin_amount} ${accepted.fee?.native_coin}`);
}

main()
    .then(() => {
        if (failures.length) {
            console.log(`\nRESULT: ${failures.length} assertion(s) failed`);
            process.exit(1);
        }
        console.log('\nRESULT: the watcher lane pays the native protocol fee on chain, and the '
            + 'indexer takes it');
        process.exit(0);
    })
    .catch((err) => {
        console.error('FAILED:', err?.stack || err?.message || err);
        process.exit(1);
    });
