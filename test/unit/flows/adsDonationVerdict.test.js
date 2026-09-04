// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The ADS accumulator books the verdict the BROADCAST BYTES carry.
//
// composeForConfirm resolves the donation against a snapshot taken before the
// modal opens and folds the output into the PSBT the user approves. submitAction
// then resolved it a SECOND time, from a fresh snapshot at submit time, and
// booked the accounting from that one. One background host serves every popup
// window, so the accumulator can cross its trigger in between: the counter reset
// and lifetimeDonatedSats advanced for a transaction carrying no donation at
// all, and the mirror case left the accumulator growing on top of a donation
// already paid.

import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';

const CHAIN = 'bitcoin-regtest';
const DONATE = 'bcrt1qdonate';

// Over the trigger: a submit-time resolution here says "donate".
function settingsOverTrigger() {
    return {
        schemaVersion: 2,
        ads: {
            enabled: true,
            perChain: {
                [CHAIN]: {
                    accumulatedSats: 5000, triggerAmountSats: 1000, perTxAmountSats: 100,
                    lifetimeTxCount: 0, lifetimeDonatedSats: 0,
                },
            },
        },
    };
}

function makeHarness({ adsDonation }) {
    let settings = settingsOverTrigger();
    const vault = {
        settings: {
            get: vi.fn(async () => JSON.parse(JSON.stringify(settings))),
            put: vi.fn(async (r) => { settings = JSON.parse(JSON.stringify(r)); }),
        },
    };
    const sdk = {
        encoder: { createTx: vi.fn(), broadcastTx: vi.fn(async () => ({})) },
        actions: { createAction: vi.fn() },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: 'txid-1' })),
    };
    return {
        vault,
        state: () => settings.ads.perChain[CHAIN],
        run: () => submitAction({
            vault,
            walletId: 'w1',
            chainRegistry: { get: () => ({ id: CHAIN, coin: 'bitcoin', adsDonationAddress: DONATE }) },
            sdkRegistry: { get: () => sdk },
            chainId: CHAIN,
            actionData: { action: 'ISSUE', params: { TICK: 'JDOG' } },
            encoderOpts: { pubkey: 'pub' },
            prebuiltPsbt: {
                psbtHex: 'PSBT', encoding: 'OP_RETURN', actionString: 'ISSUE|0|JDOG', version: 0,
                deferredFeeOutput: null, deferredOutputs: [],
                ...(adsDonation === undefined ? {} : { adsDonation }),
            },
            signer,
            signingPaths: [{ inputIndex: 0, path: 'm/0' }],
        }),
    };
}

describe('the donation verdict booked is the one the signed bytes carry', () => {

    // The forfeiture case: composed under the trigger, submitted over it.
    it('does not credit a donation the previewed PSBT never carried', async () => {
        const h = makeHarness({ adsDonation: { included: false } });
        await h.run();
        const s = h.state();
        expect(s.lifetimeDonatedSats).toBe(0);
        expect(s.accumulatedSats).toBe(5100);
        expect(s.lifetimeTxCount).toBe(1);
    });

    // ...and the mirror: composed WITH a donation, so the accumulator resets
    // even though a submit-time re-resolution would have agreed here anyway.
    it('credits one the PSBT does carry', async () => {
        const h = makeHarness({ adsDonation: { included: true } });
        await h.run();
        const s = h.state();
        expect(s.lifetimeDonatedSats).toBe(5000);
        expect(s.accumulatedSats).toBe(100);
    });

    // An envelope from a composer built before the carry keeps today's
    // behaviour: the submit-time snapshot decides.
    it('falls back to the submit-time plan for an envelope with no verdict', async () => {
        const h = makeHarness({ adsDonation: undefined });
        await h.run();
        const s = h.state();
        expect(s.lifetimeDonatedSats).toBe(5000);
        expect(s.accumulatedSats).toBe(100);
    });
});

// The cases above hand submitAction an envelope directly, so none of them can
// see a ROUTE that never puts the verdict on one. ADS keys only on chain and
// settings (applyAdsPlanToEncoderOpts), never on the action, so every prebuilt
// envelope is exposed and the census is the assertion.
describe('every prebuilt-PSBT builder carries the compose-time verdict', () => {
    const ROUTES = resolve(dirname(fileURLToPath(import.meta.url)),
        '../../../packages/core/src/shared/routes');
    const files = () => readdirSync(ROUTES).filter((f) => f.endsWith('.jsx'));

    // Slice each envelope literal by brace depth, so a nested field cannot be
    // read as the end of the object.
    function envelopes() {
        const out = [];
        for (const file of files()) {
            const src = readFileSync(join(ROUTES, file), 'utf8');
            const re = /prebuiltPsbt:\s*\{/g;
            let m;
            while ((m = re.exec(src)) !== null) {
                const start = src.indexOf('{', m.index);
                let depth = 0;
                let i = start;
                for (; i < src.length; i++) {
                    if (src[i] === '{') depth++;
                    else if (src[i] === '}' && --depth === 0) break;
                }
                out.push({
                    at: `${file}:${src.slice(0, start).split('\n').length}`,
                    body: src.slice(start, i),
                });
            }
        }
        return out;
    }

    it('finds envelopes to check', () => {
        // Guards the guard: a regex that matched nothing would pass the
        // assertion below over an empty set and prove nothing at all.
        expect(envelopes().length).toBeGreaterThan(5);
    });

    it('leaves no builder emitting a bare envelope', () => {
        const missing = envelopes()
            .filter((e) => !/adsDonation/.test(e.body))
            .map((e) => e.at);
        expect(missing).toEqual([]);
    });
});
