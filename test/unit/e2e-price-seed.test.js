// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unit: test/e2e/fixtures/priceSeed.js - the venue price fixture .
//
// Test infrastructure testing test infrastructure, and it earns its keep the
// same way the timeout-budget suite does: everything here is invisible when it
// is wrong. A seed with the anchors transposed still writes two perfectly valid
// rows, and the venue then reports "no current oracle price" forever while the
// table looks full - which is exactly how three campaign sessions were lost.
// The arithmetic is pinned here, where it fails in milliseconds, instead of on
// a shared chain ninety seconds into a spec.

import { describe, it, expect } from 'vitest';
import {
    BASE_ROUNDS,
    MIN_SEED_MARGIN_SECONDS,
    ORACLE_MAX_PRICE_AGE_SECONDS,
    SYNTHETIC_ROUNDS,
    VENUE_PRICE,
    XCHAIN_PAIR,
    XCHAIN_USD_PRICE,
    planPairRows,
    planSeedRows,
    priceVerdict,
    readStateScript,
    seedMarginSeconds,
    selectedSnapshot,
    settlePrice,
    unusablePriceMessage,
    venueDisagreement,
    writeRowsScript,
} from '../e2e/fixtures/priceSeed.js';

const CHAIN = 1_785_300_000;
const WALL = CHAIN + 9_000;   // the idle regime: chain trails wall by 2.5h

describe('e2e price seed ', () => {
    describe('planPairRows anchoring', () => {
        it('gives the wall anchor to the HIGHEST round and the tip to the rest', () => {
            const rows = planPairRows({
                coinPair: 'LTC/USD', price: '30.00000000',
                baseRounds: BASE_ROUNDS.coin, chainTime: CHAIN, wallTime: WALL,
            });

            expect(rows.map((r) => r.roundNumber)).toEqual([888100002, 888100012]);
            // The pairing is the whole fixture. Selection is ORDER BY round
            // DESC and the staleness guard runs after it, so a wall-stamped row
            // at the LOW round would be hidden by a tip-stamped high round off
            // Bitcoin, and on Bitcoin the high round would be selected and then
            // rejected as stale - a pair that looks permanently dead with two
            // correct-looking rows in the table.
            expect(rows[0].blockTimestamp).toBe(CHAIN);
            expect(rows[1].blockTimestamp).toBe(WALL);
        });

        it('stamps every row at the tip when the chain clock is not behind', () => {
            const rows = planPairRows({
                coinPair: 'BTC/USD', price: '100000.00000000',
                baseRounds: BASE_ROUNDS.coin, chainTime: WALL, wallTime: CHAIN,
            });
            // A row stamped in the chain's future is invisible to the H-3
            // selection gate, not "fresh for longer", so wall clock is only ever
            // used when it is genuinely ahead.
            expect(rows.map((r) => r.blockTimestamp)).toEqual([WALL, WALL]);
        });

        it('adopts a leftover synthetic round so it cannot shadow the seed', () => {
            // The live BTC regtest condition: a previous run's nativeFeeLive
            // sentinels sit ABOVE this fixture's own rounds. Left alone they win
            // selection with whatever stale timestamp they carry.
            const rows = planPairRows({
                coinPair: 'BTC/USD', price: '100000.00000000',
                baseRounds: BASE_ROUNDS.coin, existingRounds: [999200012, 990001],
                chainTime: CHAIN, wallTime: WALL,
            });

            expect(rows.map((r) => r.roundNumber)).toEqual([990001, 888100002, 888100012, 999200012]);
            expect(rows.at(-1)).toMatchObject({ roundNumber: 999200012, blockTimestamp: WALL });
            expect(rows.slice(0, -1).every((r) => r.blockTimestamp === CHAIN)).toBe(true);
        });

        it('never touches a round the tree did not write synthetically', () => {
            // A hub-derived round is real data. Re-stamping it would replace a
            // venue's own oracle output with a fixture and every later run would
            // prove nothing.
            const rows = planPairRows({
                coinPair: 'LTC/USD', price: '30.00000000',
                baseRounds: BASE_ROUNDS.coin, existingRounds: [1948, 2001],
                chainTime: CHAIN, wallTime: WALL,
            });
            expect(rows.map((r) => r.roundNumber)).toEqual([...BASE_ROUNDS.coin]);
        });

        it('does not write the same round twice when the venue already has it', () => {
            const rows = planPairRows({
                coinPair: 'LTC/USD', price: '30.00000000',
                baseRounds: BASE_ROUNDS.coin, existingRounds: [888100002, 888100012],
                chainTime: CHAIN, wallTime: WALL,
            });
            expect(rows).toHaveLength(2);
        });

        it('refuses a missing or nonsense clock rather than seeding an epoch row', () => {
            // A zero chainTime is what a read against an empty `blocks` table
            // returns; seeding at 1970 writes rows no block can ever use, and
            // the failure would present as "the seed did not work".
            expect(() => planPairRows({
                coinPair: 'LTC/USD', price: '30.00000000',
                baseRounds: BASE_ROUNDS.coin, chainTime: 0, wallTime: WALL,
            })).toThrow(/chainTime/);
            expect(() => planPairRows({
                coinPair: 'LTC/USD', price: '30.00000000',
                baseRounds: BASE_ROUNDS.coin, chainTime: CHAIN, wallTime: NaN,
            })).toThrow(/wallTime/);
        });
    });

    describe('planSeedRows', () => {
        it('prices both pairs a fee-bearing action needs', () => {
            const rows = planSeedRows({ regtestCoin: 'RLTC', chainTime: CHAIN, wallTime: WALL });
            const pairs = [...new Set(rows.map((r) => r.coinPair))];
            expect(pairs).toEqual([XCHAIN_PAIR, 'LTC/USD']);
            // Both halves are required: the gas amount is XCHAIN-denominated and
            // the native fee converts it through the coin price, so a run with
            // only one of them fails on the other with the identical message.
            expect(rows.filter((r) => r.coinPair === XCHAIN_PAIR)).toHaveLength(2);
            expect(rows.filter((r) => r.coinPair === 'LTC/USD')).toHaveLength(2);
        });

        it('uses the gas-token price production actually publishes', () => {
            const rows = planSeedRows({ regtestCoin: 'RBTC', chainTime: CHAIN, wallTime: WALL });
            expect(rows.filter((r) => r.coinPair === XCHAIN_PAIR).every((r) => r.price === XCHAIN_USD_PRICE))
                .toBe(true);
            expect(XCHAIN_USD_PRICE).toBe('2.00000000');
        });

        it('keeps Litecoin under the measured dust ceiling', () => {
            // Not a preference. At $100 a place-bet's fee prices at 2000 sats
            // against LTC's 5460-sat dust floor and is refused outright, so
            // betting is unusable; break-even is ~$36.6.
            expect(Number(VENUE_PRICE.RLTC.price)).toBeLessThan(36.6);
        });

        it('refuses a chain it has no fixture price for', () => {
            expect(() => planSeedRows({ regtestCoin: 'RXMR', chainTime: CHAIN, wallTime: WALL }))
                .toThrow(/not a regtest chain/);
        });

        it('writes only rounds the platform-wide cleanup already knows', () => {
            // : a synthetic round outranks every derived round forever and
            // suppressing new seeds cannot retract old rows, so the e2e tree
            // keeps ONE list of every synthetic round for clearSeedSentinels to
            // undo. A wallet-private family would be invisible to that cleanup.
            const rounds = [...BASE_ROUNDS.xchain, ...BASE_ROUNDS.coin];
            expect(rounds.every((r) => SYNTHETIC_ROUNDS.includes(r))).toBe(true);
        });
    });

    describe('priceVerdict', () => {
        it('accepts a quote carrying both prices', () => {
            const v = priceVerdict({
                supported: true, valid: true,
                xchainUsdPrice: '2.00000000', coinUsdPrice: '30.00000000', oracleRound: 888100012,
            });
            expect(v).toMatchObject({ usable: true, coinUsdPrice: '30.00000000', oracleRound: 888100012 });
        });

        it('reads the venue refusal that three sessions mistook for a wallet bug', () => {
            const v = priceVerdict({
                supported: true, valid: false, xchainFee: null,
                error: 'invalid: no current oracle price for LTC/USD (missing or stale beyond 1800s)',
            });
            expect(v.usable).toBe(false);
            expect(v.retryable).toBe(true);
            expect(v.reason).toMatch(/no current oracle price/);
        });

        it('treats a busy quote engine as not-yet, not as a missing price', () => {
            const v = priceVerdict({ busy: true, retryable: true, error: 'fee quote busy (8 quotes already pending); retry shortly' });
            expect(v).toMatchObject({ usable: false, retryable: true });
        });

        it('treats a venue with native fees switched off as unfixable', () => {
            // Seeding and re-mining forever cannot change this answer, so the
            // caller must stop rather than burn its whole retry budget.
            const v = priceVerdict({
                supported: false, valid: false,
                error: 'native coin fee not enabled (no FEE_DESTINATION configured)',
            });
            expect(v).toMatchObject({ usable: false, retryable: false });
        });

        it('rejects a quote whose prices are absent or zero', () => {
            expect(priceVerdict({ supported: true, xchainUsdPrice: '2.00000000' }).usable).toBe(false);
            expect(priceVerdict({ supported: true, xchainUsdPrice: '0', coinUsdPrice: '30' }).usable).toBe(false);
            expect(priceVerdict(null).usable).toBe(false);
            expect(priceVerdict('not json').usable).toBe(false);
        });
    });

    describe('container scripts', () => {
        const rows = planSeedRows({ regtestCoin: 'RLTC', chainTime: CHAIN, wallTime: WALL });

        it('refuses to run anywhere but a regtest indexer', () => {
            // The only database write anywhere in the wallet's test tree. The
            // guard is checked against the CONTAINER's own network, not against
            // anything the caller passed in.
            for (const script of [readStateScript([XCHAIN_PAIR, 'LTC/USD']), writeRowsScript(rows)]) {
                expect(script).toContain("env.INDEXER_NETWORK !== 'regtest'");
                expect(script).toContain('process.exit(2)');
            }
        });

        it('reads its credentials from the container environment and never embeds one', () => {
            const script = writeRowsScript(rows);
            expect(script).toContain('env.INDEXER_DB_PASS');
            // Nothing may be assigned a literal password, and the error path
            // must print a message rather than the mariadb error object, which
            // carries the whole connection config.
            expect(script).not.toMatch(/password:\s*'/);
            expect(script).toContain('err.message');
        });

        it('follows the indexer to the hub DB when one is configured', () => {
            // Once HUB_DB_NAME is set every price lookup goes through that
            // connection, so a seed into the local database would land in a
            // table nothing reads.
            expect(writeRowsScript(rows)).toContain('env.HUB_DB_HOST && env.HUB_DB_NAME');
        });

        it('carries the planned rows and upserts rather than stacking new rounds', () => {
            const script = writeRowsScript(rows);
            expect(script).toContain(JSON.stringify(rows));
            expect(script).toContain('ON DUPLICATE KEY UPDATE');
        });

        it('expands the pair list into real placeholders', () => {
            // The mariadb driver does not expand an array into an IN list; it
            // binds it as a single value and matches nothing, which would report
            // an empty venue and lose the shadowing check.
            const script = readStateScript([XCHAIN_PAIR, 'LTC/USD']);
            expect(script).toContain("PAIRS.map(() => '?').join(',')");
            expect(script).toContain(JSON.stringify([XCHAIN_PAIR, 'LTC/USD']));
        });
    });

    describe('unusablePriceMessage', () => {
        it('names the venue as the cause, not the wallet', () => {
            const msg = unusablePriceMessage({
                regtestCoin: 'RLTC', seeded: false,
                reason: 'invalid: no current oracle price for LTC/USD (missing or stale beyond 1800s)',
            });
            expect(msg).toMatch(/VENUE state, not a wallet defect/);
            expect(msg).toMatch(/no current oracle price/);
        });

        it('says what was tried, so a seeded failure points at shadowing', () => {
            const msg = unusablePriceMessage({
                regtestCoin: 'RBTC', seeded: true, reason: 'still stale',
                state: { wrote: ['BTC/USD#888100012@123'] },
            });
            expect(msg).toMatch(/HIGHEST round number/);
            expect(msg).toContain('BTC/USD#888100012@123');
        });
    });

    // . The venue answered at setup and failed at approve, so every case
    // here is about the difference between "prices now" and "still prices later".
    describe('selectedSnapshot mirrors getLatestPrice', () => {
        const PAIR = 'LTC/USD';

        it('hides a row stamped in the chain future (the H-3 gate)', () => {
            const rows = [
                { coinPair: PAIR, round: 888100011, timestamp: CHAIN - 100 },
                { coinPair: PAIR, round: 888100012, timestamp: CHAIN + 5_000 },
            ];
            expect(selectedSnapshot(rows, PAIR, CHAIN).round).toBe(888100011);
        });

        it('picks the highest ROUND, not the newest timestamp', () => {
            // The trap this whole function exists for: the fresher row loses,
            // so a venue can hold a perfectly recent price and still go stale.
            const rows = [
                { coinPair: PAIR, round: 888100012, timestamp: CHAIN - 1_700 },
                { coinPair: PAIR, round: 888100011, timestamp: CHAIN - 10 },
            ];
            expect(selectedSnapshot(rows, PAIR, CHAIN).round).toBe(888100012);
        });

        it('ignores other pairs, and returns null when nothing is visible', () => {
            const rows = [{ coinPair: 'DOGE/USD', round: 1, timestamp: CHAIN - 10 }];
            expect(selectedSnapshot(rows, PAIR, CHAIN)).toBeNull();
            expect(selectedSnapshot([], PAIR, CHAIN)).toBeNull();
        });
    });

    describe('seedMarginSeconds', () => {
        const PAIRS = [XCHAIN_PAIR, 'LTC/USD'];
        const fresh = (pair) => ({ coinPair: pair, round: 888100012, timestamp: CHAIN - 60 });

        it('reports the life left on a fresh venue', () => {
            const rows = PAIRS.map(fresh);
            expect(seedMarginSeconds({ rows, chainTime: CHAIN, coinPairs: PAIRS }))
                .toBe(ORACLE_MAX_PRICE_AGE_SECONDS - 60);
        });

        it('answers with the WORST pair, since a fee needs both', () => {
            const rows = [
                fresh(XCHAIN_PAIR),
                { coinPair: 'LTC/USD', round: 888100012, timestamp: CHAIN - 1_500 },
            ];
            expect(seedMarginSeconds({ rows, chainTime: CHAIN, coinPairs: PAIRS }))
                .toBe(ORACLE_MAX_PRICE_AGE_SECONDS - 1_500);
        });

        it('goes negative once the selected row is already stale', () => {
            const rows = PAIRS.map((p) => ({ coinPair: p, round: 888100012, timestamp: CHAIN - 2_000 }));
            expect(seedMarginSeconds({ rows, chainTime: CHAIN, coinPairs: PAIRS })).toBeLessThan(0);
        });

        it('is null when a pair has no visible row, rather than 0', () => {
            // Unknowable is not the same as bad: the public quote has already
            // said the venue prices, and a fixture must not resolve that
            // disagreement by rewriting rows.
            const rows = [fresh(XCHAIN_PAIR)];
            expect(seedMarginSeconds({ rows, chainTime: CHAIN, coinPairs: PAIRS })).toBeNull();
        });

        it('REGRESSION: the near-expiry venue that  accepted is now refused', () => {
            // The exact shape of the red run: both pairs answer, so the old
            // usable-only check returned "venue already priced", and the bet
            // failed minutes later once chain time crossed the window.
            const rows = PAIRS.map((p) => ({ coinPair: p, round: 888100012, timestamp: CHAIN - 1_750 }));
            const margin = seedMarginSeconds({ rows, chainTime: CHAIN, coinPairs: PAIRS });
            expect(margin).toBe(50);
            expect(margin).toBeLessThan(MIN_SEED_MARGIN_SECONDS);
        });

        it('rejects a nonsense chain time instead of quietly pricing off it', () => {
            const rows = PAIRS.map(fresh);
            expect(() => seedMarginSeconds({ rows, chainTime: 0, coinPairs: PAIRS })).toThrow(/positive unix time/);
            expect(() => seedMarginSeconds({ rows, chainTime: CHAIN, coinPairs: [] })).toThrow(/non-empty/);
        });

        it('REGRESSION: an idle chain trailing wall clock is refused, not called fresh', () => {
            // Found live on Litecoin regtest, which mines ONLY ON DEMAND and
            // stamps wall clock: the tip sat 5.7 hours behind, the selected rows
            // were 60 chain-seconds old, and the health check reported 1743s of
            // life left. The run's own first block then landed at wall clock,
            // consumed 20,700 chain-seconds in one step, and every fee-bearing
            // action after it answered "no current oracle price for LTC/USD
            // (missing or stale beyond 1800s)". MIN_SEED_MARGIN_SECONDS cannot
            // absorb that - the jump is bounded by how long the chain has been
            // idle, not by how long the run takes - so the margin has to be
            // judged at the time the next block will carry.
            const trailing = CHAIN - 20_700;
            const rows = PAIRS.map((p) => ({ coinPair: p, round: 888100012, timestamp: trailing - 60 }));

            // Measured at the tip alone, this venue looks healthy. That answer is
            // the defect, and it is what the fixture used to return.
            expect(seedMarginSeconds({ rows, chainTime: trailing, coinPairs: PAIRS }))
                .toBeGreaterThan(MIN_SEED_MARGIN_SECONDS);

            // Measured at the next block's time, it is already dead.
            const margin = seedMarginSeconds({
                rows, chainTime: trailing, referenceTime: CHAIN, coinPairs: PAIRS,
            });
            expect(margin).toBeLessThan(0);
            expect(margin).toBeLessThan(MIN_SEED_MARGIN_SECONDS);
        });

        it('keeps the frozen-clock regime unchanged when no reference time is given', () => {
            // A setmocktime-pinned chain (Bitcoin regtest here) carries mocktime
            // into its next block too, so the tip IS the right clock there and
            // the default must not become pessimistic about it.
            const rows = PAIRS.map(fresh);
            expect(seedMarginSeconds({ rows, chainTime: CHAIN, coinPairs: PAIRS }))
                .toBe(seedMarginSeconds({ rows, chainTime: CHAIN, referenceTime: CHAIN, coinPairs: PAIRS }));
        });
    });

    //  second half: the shared venue, where another suite's idea of what a
    // coin is worth arrives as a perfectly fresh price.
    describe('venueDisagreement', () => {
        const EXPECTED = { [XCHAIN_PAIR]: XCHAIN_USD_PRICE, 'LTC/USD': '30.00000000' };
        const row = (coinPair, price, round = 888100012) => ({ coinPair, price, round, timestamp: CHAIN - 60 });

        it('says nothing when the venue carries this fixture\'s own numbers', () => {
            const rows = [row(XCHAIN_PAIR, XCHAIN_USD_PRICE), row('LTC/USD', '30.00000000')];
            expect(venueDisagreement({ rows, chainTime: CHAIN, expected: EXPECTED })).toBeNull();
        });

        it('REGRESSION: catches the 100000 LTC that xchain-e2e-test leaves behind', () => {
            // The live failure: fee became 0.00000002 LTC, refused as dust, and
            // it read as a wallet bug.
            const rows = [row(XCHAIN_PAIR, XCHAIN_USD_PRICE), row('LTC/USD', '100000.00000000')];
            const d = venueDisagreement({ rows, chainTime: CHAIN, expected: EXPECTED });
            expect(d).toMatchObject({ coinPair: 'LTC/USD', found: '100000.00000000', expected: '30.00000000' });
        });

        it('never touches a DERIVED round, which is the real-data rule', () => {
            // Same wrong-looking number, but the round is outside the synthetic
            // set, so it may be a genuine published price and is left alone.
            const rows = [row('LTC/USD', '100000.00000000', 4_242_424)];
            expect(venueDisagreement({ rows, chainTime: CHAIN, expected: EXPECTED })).toBeNull();
        });

        it('ignores a disagreeing row that the H-3 gate hides anyway', () => {
            const rows = [{ coinPair: 'LTC/USD', price: '100000.00000000', round: 888100012, timestamp: CHAIN + 500 }];
            expect(venueDisagreement({ rows, chainTime: CHAIN, expected: EXPECTED })).toBeNull();
        });

        it('compares numerically, so trailing-zero formatting is not a mismatch', () => {
            const rows = [row('LTC/USD', '30.000000000000')];
            expect(venueDisagreement({ rows, chainTime: CHAIN, expected: { 'LTC/USD': '30.00000000' } })).toBeNull();
        });
    });

    // The Bitcoin venue looked permanently dead for eight days over this loop,
    // and the reason it was never caught is that it cannot be reproduced on
    // demand: it needs a block that takes over a minute to parse, and two live
    // RBTC runs on the day of the fix both passed because the venue happened to
    // be quiet. So the ORDER of mine / wait / re-probe is pinned here, against
    // a fake venue that is busy exactly as long as the real one was.
    describe('settlePrice: a busy quote engine is a lock, not a missing price', () => {
        const BUSY = { usable: false, retryable: true, busy: true, reason: 'waited 2000ms for the lock' };
        const PRICED = { usable: true, retryable: false, coinUsdPrice: '100000.00000000' };

        /** A venue that answers `busy` for `busyFor` probes, then prices. */
        function fakeVenue(busyFor) {
            const trace = [];
            let probes = 0;
            return {
                trace,
                io: {
                    probe: async () => (++probes <= busyFor ? BUSY : PRICED),
                    mineOne: async () => trace.push('MINE'),
                    waitForTip: async () => trace.push('WAIT'),
                    sleep: async () => {},
                },
            };
        }

        it('re-asks a busy venue and mines exactly ONCE while it waits', async () => {
            // Six busy answers is the shape of the measured 1m 12.8s block
            // against a 5s re-probe. The mine count is the assertion that
            // matters: a loop that mines per attempt puts more blocks in front
            // of the one already holding the lock.
            const { io, trace } = fakeVenue(6);
            const { verdict } = await settlePrice({ ...io, attempts: 4, busyReprobes: 20, busyReprobeMs: 1 });

            expect(verdict.usable).toBe(true);
            expect(trace.filter((t) => t === 'MINE')).toHaveLength(1);
        });

        it('FALSIFICATION: the same venue defeats the old flat-wait loop', async () => {
            // `busyReprobes: 0` IS the loop this replaced - mine, wait, probe
            // once, give up and mine again. Against the identical fake it burns
            // every attempt inside the lock and reports an unpriceable venue,
            // which is the RBTC failure exactly.
            const { io, trace } = fakeVenue(6);
            const { verdict } = await settlePrice({ ...io, attempts: 4, busyReprobes: 0, busyReprobeMs: 1 });

            expect(verdict.usable).toBe(false);
            expect(verdict.busy).toBe(true);
            expect(trace.filter((t) => t === 'MINE')).toHaveLength(4);
        });

        it('waits for the indexer BEFORE probing, never after', async () => {
            const order = [];
            await settlePrice({
                probe: async () => { order.push('probe'); return PRICED; },
                mineOne: async () => order.push('mine'),
                waitForTip: async () => order.push('wait'),
                sleep: async () => {},
                attempts: 4, busyReprobes: 20, busyReprobeMs: 1,
            });
            expect(order).toEqual(['mine', 'wait', 'probe']);
        });

        it('stops at a NOT-EVER verdict instead of spending its attempts', async () => {
            // A venue with native fees switched off answers the same way no
            // matter how long anyone waits, so mining at it is pure delay.
            const order = [];
            const dead = { usable: false, retryable: false, reason: 'no FEE_DESTINATION configured' };
            const { verdict } = await settlePrice({
                probe: async () => dead,
                mineOne: async () => order.push('mine'),
                waitForTip: async () => {},
                sleep: async () => {},
                attempts: 4, busyReprobes: 20, busyReprobeMs: 1,
            });
            expect(verdict).toBe(dead);
            expect(order).toHaveLength(1);
        });
    });

    describe('priceVerdict carries busy through', () => {
        it('marks a busy quote busy, so the caller can tell it from a missing price', () => {
            const v = priceVerdict({ busy: true, error: 'fee quote busy (the indexer is processing a block)' });
            expect(v).toMatchObject({ usable: false, retryable: true, busy: true });
        });

        it('does not mark a priced quote busy', () => {
            const v = priceVerdict({ coinUsdPrice: '30.00000000', xchainUsdPrice: '2.00000000' });
            expect(v.usable).toBe(true);
            expect(v.busy).toBeUndefined();
        });
    });
});
