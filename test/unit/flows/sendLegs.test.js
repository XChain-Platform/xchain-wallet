// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// PC-52: the shaping layer for a multi-recipient / multi-tick SEND.
//
// The failure this guards against is specific and was measured on the wire
//: SEND v1/v2/v3 repeat their per-leg field group, and a serializer
// fed a FLAT field map re-emitted leg 1 for every repeat, producing a
// well-formed action that paid the same address twice. The SDK now expands a
// LEGS array positionally and refuses a flat map against a repeated format, so
// the wallet's remaining job is to hand it legs, hoist what every leg agrees
// on (which is what picks the shorter format version), and never regress the
// single-recipient bytes.
//
// The last describe block closes the loop against the real SDK serializer
// rather than trusting the param shape: it asserts the exact action string.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'node:module';

import { clearGatedGroupsCache } from '../../../packages/core/src/flows/gatedSendGuard.js';
import {
    MAX_SEND_LEGS,
    MultiSendUnsupportedError,
    normalizeSendLegs,
    buildSendParams,
    assertMultiSendSupported,
    assertNoGatedLegs,
    summarizeSendLegs,
    totalsByTick,
} from '../../../packages/core/src/flows/sendLegs.js';

const A = 'bcrt1qalice';
const B = 'bcrt1qbob';
const C = 'bcrt1qcarol';

describe('normalizeSendLegs', () => {
    it('treats the flat to/tick/amount shape as one leg (every existing caller)', () => {
        const { legs, isMulti } = normalizeSendLegs({ to: A, tick: 'PEPE', amount: '5' });
        expect(isMulti).toBe(false);
        expect(legs).toEqual([{ to: A, tick: 'PEPE', amount: '5' }]);
    });

    it('drops an empty memo instead of carrying it as a value', () => {
        const { legs } = normalizeSendLegs({ to: A, tick: 'PEPE', amount: '5', memo: '' });
        expect(legs[0].memo).toBeUndefined();
    });

    it('trims and stringifies, so a numeric amount reaches the wire as a string', () => {
        const { legs } = normalizeSendLegs({ to: `  ${A} `, tick: ' PEPE ', amount: 5 });
        expect(legs[0]).toEqual({ to: A, tick: 'PEPE', amount: '5' });
    });

    it('fills a leg tick and memo from the top-level values (the form carries one token)', () => {
        const { legs, isMulti } = normalizeSendLegs({
            tick: 'PEPE',
            memo: 'payout',
            legs: [{ to: A, amount: '5' }, { to: B, amount: '3' }],
        });
        expect(isMulti).toBe(true);
        expect(legs).toEqual([
            { to: A, tick: 'PEPE', amount: '5', memo: 'payout' },
            { to: B, tick: 'PEPE', amount: '3', memo: 'payout' },
        ]);
    });

    it("lets a leg's own tick and memo win over the defaults", () => {
        const { legs } = normalizeSendLegs({
            tick: 'PEPE',
            memo: 'shared',
            legs: [{ to: A, amount: '5', tick: 'DANK', memo: 'own' }, { to: B, amount: '3' }],
        });
        expect(legs[0]).toEqual({ to: A, tick: 'DANK', amount: '5', memo: 'own' });
        expect(legs[1].tick).toBe('PEPE');
    });

    it('reports the offending index when a leg is missing a field', () => {
        expect(() => normalizeSendLegs(
            { tick: 'PEPE', legs: [{ to: A, amount: '5' }, { to: B }] },
            'sendToken',
        )).toThrow(/legs\[1\]: amount is required/);
    });

    it('keeps the single-send error strings unchanged', () => {
        expect(() => normalizeSendLegs({ tick: 'PEPE', amount: '5' }, 'sendToken'))
            .toThrow('sendToken: to is required');
        expect(() => normalizeSendLegs({ to: A, amount: '5' }, 'sendToken'))
            .toThrow('sendToken: tick is required');
        expect(() => normalizeSendLegs({ to: A, tick: 'PEPE' }, 'sendToken'))
            .toThrow('sendToken: amount is required');
    });

    it('rejects an empty leg list rather than composing an action with no recipients', () => {
        expect(() => normalizeSendLegs({ legs: [] })).toThrow(MultiSendUnsupportedError);
    });

    it('caps the recipient count and names the airdrop path', () => {
        const legs = Array.from({ length: MAX_SEND_LEGS + 1 }, () => ({ to: A, tick: 'PEPE', amount: '1' }));
        expect(() => normalizeSendLegs({ legs })).toThrow(/at most 10 recipients/);
    });

    it('accepts exactly the cap', () => {
        const legs = Array.from({ length: MAX_SEND_LEGS }, () => ({ to: A, tick: 'PEPE', amount: '1' }));
        expect(normalizeSendLegs({ legs }).legs).toHaveLength(MAX_SEND_LEGS);
    });
});

describe('buildSendParams', () => {
    it('[REGRESSION] one leg emits the flat params the wallet has always sent (no LEGS key)', () => {
        const params = buildSendParams([{ to: A, tick: 'PEPE', amount: '5', memo: 'hi' }]);
        expect(params).toEqual({ TICK: 'PEPE', AMOUNT: '5', DESTINATION: A, MEMO: 'hi' });
        expect(params.LEGS).toBeUndefined();
    });

    it('hoists a tick every leg agrees on, so the shorter v1 format can win', () => {
        const params = buildSendParams([
            { to: A, tick: 'PEPE', amount: '7' },
            { to: B, tick: 'PEPE', amount: '3' },
        ]);
        expect(params.TICK).toBe('PEPE');
        expect(params.LEGS).toEqual([
            { AMOUNT: '7', DESTINATION: A },
            { AMOUNT: '3', DESTINATION: B },
        ]);
    });

    it('keeps the tick per leg when they differ (the multi-tick v2 case)', () => {
        const params = buildSendParams([
            { to: A, tick: 'PEPE', amount: '7' },
            { to: B, tick: 'DANK', amount: '3' },
        ]);
        expect(params.TICK).toBeUndefined();
        expect(params.LEGS).toEqual([
            { TICK: 'PEPE', AMOUNT: '7', DESTINATION: A },
            { TICK: 'DANK', AMOUNT: '3', DESTINATION: B },
        ]);
    });

    it('hoists one shared memo (the indexer applies a v1/v2 trailing memo to every leg)', () => {
        const params = buildSendParams([
            { to: A, tick: 'PEPE', amount: '7', memo: 'payout' },
            { to: B, tick: 'PEPE', amount: '3', memo: 'payout' },
        ]);
        expect(params.MEMO).toBe('payout');
        expect(params.LEGS.every((l) => l.MEMO === undefined)).toBe(true);
    });

    it('keeps memos per leg when they differ (the v3 case), including the empty one', () => {
        const params = buildSendParams([
            { to: A, tick: 'PEPE', amount: '7', memo: 'rent' },
            { to: B, tick: 'PEPE', amount: '3' },
        ]);
        expect(params.MEMO).toBeUndefined();
        expect(params.LEGS).toEqual([
            { AMOUNT: '7', DESTINATION: A, MEMO: 'rent' },
            { AMOUNT: '3', DESTINATION: B, MEMO: '' },
        ]);
    });

    it('does not emit a MEMO slot when no leg has one', () => {
        const params = buildSendParams([
            { to: A, tick: 'PEPE', amount: '7' },
            { to: B, tick: 'PEPE', amount: '3' },
        ]);
        expect(params.MEMO).toBeUndefined();
        expect(params.LEGS.every((l) => l.MEMO === undefined)).toBe(true);
    });

    it('keeps duplicate destinations distinct (the indexer consolidates them, the wallet does not)', () => {
        const params = buildSendParams([
            { to: A, tick: 'PEPE', amount: '7' },
            { to: A, tick: 'PEPE', amount: '3' },
        ]);
        expect(params.LEGS).toHaveLength(2);
    });
});

describe('assertMultiSendSupported', () => {
    const btc = { coin: 'bitcoin' };

    it('allows a single native-coin send (the ordinary BTC payment)', () => {
        expect(() => assertMultiSendSupported({
            legs: [{ to: A, tick: 'BTC', amount: '1' }], descriptor: btc,
        })).not.toThrow();
    });

    it('refuses a multi-recipient native send: it pays outputs, not an action', () => {
        expect(() => assertMultiSendSupported({
            legs: [{ to: A, tick: 'BTC', amount: '1' }, { to: B, tick: 'BTC', amount: '2' }],
            descriptor: btc,
        })).toThrow(/BTC cannot be sent to several recipients/);
    });

    it('refuses a mixed token + native send for the same reason', () => {
        try {
            assertMultiSendSupported({
                legs: [{ to: A, tick: 'PEPE', amount: '1' }, { to: B, tick: 'btc', amount: '2' }],
                descriptor: btc,
            });
            throw new Error('expected a refusal');
        } catch (err) {
            expect(err.code).toBe('NATIVE_MULTI_SEND');
        }
    });

    it('allows a multi-recipient token send', () => {
        expect(() => assertMultiSendSupported({
            legs: [{ to: A, tick: 'PEPE', amount: '1' }, { to: B, tick: 'DANK', amount: '2' }],
            descriptor: btc,
        })).not.toThrow();
    });
});

describe('assertNoGatedLegs', () => {
    // One published gated file row as the explorer serves it. `getFiles` is the
    // SDK method listGatedFiles calls; the group survives the guard's filter
    // because it has a key hash and a non-demo action index.
    function gatedRow(tick) {
        return {
            gate_ticker: tick,
            key_hash: 'aa'.repeat(16),
            encryption_method: 1,
            action_index: '900001',
            name: 'secret.pdf',
        };
    }

    function ctx(rowsByTick) {
        const sdk = {
            gatedFile: {},
            messaging: {},
            getFiles: vi.fn(async (tick) => rowsByTick[String(tick).toUpperCase()] || []),
        };
        return {
            sdk,
            args: {
                sdkRegistry: { get: () => sdk },
                chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
                chainId: 'bitcoin-regtest',
            },
        };
    }

    beforeEach(() => { clearGatedGroupsCache(); });

    it('never blocks a single-recipient send (that path composes the handoff)', async () => {
        const { sdk, args } = ctx({ GATEDA: [gatedRow('GATEDA')] });
        await assertNoGatedLegs({ ...args, legs: [{ to: A, tick: 'GATEDA', amount: '1' }] });
        expect(sdk.getFiles).not.toHaveBeenCalled();
    });

    it('allows a multi-recipient send of ungated ticks', async () => {
        const { args } = ctx({});
        await expect(assertNoGatedLegs({
            ...args,
            legs: [{ to: A, tick: 'PEPEB', amount: '1' }, { to: B, tick: 'PEPEB', amount: '2' }],
        })).resolves.toBeUndefined();
    });

    it('refuses a multi-recipient send when any leg tick has active gated content', async () => {
        const { args } = ctx({ GATEDC: [gatedRow('GATEDC')] });
        await expect(assertNoGatedLegs({
            ...args,
            legs: [{ to: A, tick: 'PEPEC', amount: '1' }, { to: B, tick: 'GATEDC', amount: '2' }],
        })).rejects.toThrow(/GATEDC has token-gated content/);
    });

    it('skips the native coin and ^id ticks, exactly like prepareGatedSend', async () => {
        const { sdk, args } = ctx({});
        await assertNoGatedLegs({
            ...args,
            legs: [{ to: A, tick: 'BTC', amount: '1' }, { to: B, tick: '^42', amount: '2' }],
        });
        expect(sdk.getFiles).not.toHaveBeenCalled();
    });

    it('degrades to allowing the send when detection fails (matches the guard policy)', async () => {
        const sdk = {
            gatedFile: {},
            messaging: {},
            getFiles: vi.fn(async () => { throw new Error('explorer down'); }),
        };
        await expect(assertNoGatedLegs({
            sdkRegistry: { get: () => sdk },
            chainRegistry: { get: () => ({ coin: 'bitcoin' }) },
            chainId: 'bitcoin-regtest',
            legs: [{ to: A, tick: 'PEPED', amount: '1' }, { to: B, tick: 'PEPED', amount: '2' }],
        })).resolves.toBeUndefined();
    });
});

describe('summaries and totals', () => {
    it('keeps the single-send summary wording (memo included)', () => {
        expect(summarizeSendLegs([{ to: A, tick: 'PEPE', amount: '5', memo: 'hi' }]))
            .toBe(`Send 5 PEPE to ${A} (memo: "hi")`);
    });

    it('totals per tick for a multi-recipient summary', () => {
        expect(summarizeSendLegs([
            { to: A, tick: 'PEPE', amount: '7.5' },
            { to: B, tick: 'PEPE', amount: '2.5' },
            { to: C, tick: 'DANK', amount: '1' },
        ])).toBe('Send 10 PEPE, 1 DANK to 3 recipients');
    });

    it('adds decimals exactly (a float sum drifts at DOGE scale)', () => {
        expect(totalsByTick([
            { tick: 'DOGE', amount: '90000000.00000001' },
            { tick: 'DOGE', amount: '0.00000002' },
        ])).toEqual([{ tick: 'DOGE', amount: '90000000.00000003' }]);
    });
});

// The load-bearing check: the params this module builds, run through the REAL
// SDK serializer, must produce distinct legs on the wire and the expected
// format version.
//
// RESOLVED BY PACKAGE NAME, NOT BY SIBLING PATH. This read
// `../../../../xchain-sdk/src/formatSelector.js`, four levels up and out of
// the repo, so it found the SDK only on a machine that happened to have a
// sibling checkout. Everywhere else - CI, a clean clone, a release runner -
// the catch below turned the load-bearing check into a silent skip, and a
// test that skips where it matters most is worse than one that is absent,
// because the suite still reports green.
//
// The SDK is now an ordinary registry dependency
// (`npm:@dankest-llc/xchain-sdk`), so the package name resolves out of
// node_modules on every machine. The fallback stays for the maintainer case
// where a sibling checkout is deliberately linked in via `pnpm run sdk:link`.
const require_ = createRequire(import.meta.url);
let FormatSelector = null;
for (const specifier of [
    'xchain-sdk/src/formatSelector.js',
    '../../../../xchain-sdk/src/formatSelector.js',
]) {
    try {
        FormatSelector = require_(specifier);
        break;
    } catch {
        FormatSelector = null;
    }
}

describe.skipIf(!FormatSelector)('against the real SDK serializer', () => {
    /** @param {object} params */
    function wire(params) {
        const { version } = FormatSelector.select('SEND', params);
        return { version, action: FormatSelector.serialize('SEND', version, params) };
    }

    it('[REGRESSION] one leg still serializes as v0, byte-for-byte the old single send', () => {
        const legacy = { TICK: 'PEPE', AMOUNT: '5', DESTINATION: A, MEMO: 'hi' };
        const built = buildSendParams([{ to: A, tick: 'PEPE', amount: '5', memo: 'hi' }]);
        expect(wire(built)).toEqual(wire(legacy));
        expect(wire(built).version).toBe(0);
    });

    it('two legs on one tick serialize as v1 with DISTINCT legs (the failure)', () => {
        const { version, action } = wire(buildSendParams([
            { to: A, tick: 'PEPE', amount: '7' },
            { to: B, tick: 'PEPE', amount: '3' },
        ]));
        expect(version).toBe(1);
        expect(action).toBe(`SEND|1|PEPE|7|${A}|3|${B}`);
    });

    it('two ticks serialize as v2, each leg carrying its own tick', () => {
        const { version, action } = wire(buildSendParams([
            { to: A, tick: 'PEPE', amount: '7' },
            { to: B, tick: 'DANK', amount: '3' },
        ]));
        expect(version).toBe(2);
        expect(action).toBe(`SEND|2|PEPE|7|${A}|DANK|3|${B}`);
    });

    it('differing memos serialize as v3, one memo per leg', () => {
        const { version, action } = wire(buildSendParams([
            { to: A, tick: 'PEPE', amount: '7', memo: 'rent' },
            { to: B, tick: 'PEPE', amount: '3', memo: 'food' },
        ]));
        expect(version).toBe(3);
        expect(action).toBe(`SEND|3|PEPE|7|${A}|rent|PEPE|3|${B}|food`);
    });

    it('a shared memo rides the v1 trailing slot instead of forcing v3', () => {
        const { version, action } = wire(buildSendParams([
            { to: A, tick: 'PEPE', amount: '7', memo: 'payout' },
            { to: B, tick: 'PEPE', amount: '3', memo: 'payout' },
        ]));
        expect(version).toBe(1);
        expect(action).toBe(`SEND|1|PEPE|7|${A}|3|${B}|payout`);
    });

    it('three legs emit three distinct destinations', () => {
        const { action } = wire(buildSendParams([
            { to: A, tick: 'PEPE', amount: '1' },
            { to: B, tick: 'PEPE', amount: '2' },
            { to: C, tick: 'PEPE', amount: '3' },
        ]));
        expect(action).toBe(`SEND|1|PEPE|1|${A}|2|${B}|3|${C}`);
    });
});
