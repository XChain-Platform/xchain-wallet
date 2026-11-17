// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// The donation queue books the verdict the BROADCAST BYTES carry, and only
// once they are broadcast (§36, ruling 2026-11-14).
//
// composeForConfirm decides the donation before the modal opens and folds the
// output into the PSBT the user approves. One background host serves every
// popup window, so the queue can cross its send-at total between compose and
// submit; booking from a fresh snapshot would take a donation off the queue for
// a transaction carrying none, or keep a queue that was already paid.

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { submitAction } from '../../../packages/core/src/flows/submitAction.js';
import { prebuiltPsbtFromComposed } from '../../../packages/core/src/flows/prebuiltPsbtFromComposed.js';
import { MAINNET_LAUNCH_EPOCH } from '../../../packages/core/src/flows/mainnetPrelaunch.js';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';

// Only mainnet sends count for automatic donations, and an XChain action on a
// mainnet chain waits for launch, so the clock reads a day past it.
const CHAIN = 'bitcoin-mainnet';
const DONATE = 'bc1qdonate';
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue((MAINNET_LAUNCH_EPOCH + 86_400) * 1000); });
afterEach(() => { vi.restoreAllMocks(); });

// Over the send-at total: a submit-time resolution here would say "donate".
function settingsOverSendAt() {
    const s = createDefaultSettings();
    return { ...s, ads: { ...s.ads, queued: '30', sendAt: '25', perTransaction: '0.05' } };
}

function makeHarness({ adsDonation, broadcastFails = false, chainId = CHAIN, networkKind = 'mainnet' }) {
    let settings = settingsOverSendAt();
    const vault = {
        settings: {
            get: vi.fn(async () => JSON.parse(JSON.stringify(settings))),
            put: vi.fn(async (r) => { settings = JSON.parse(JSON.stringify(r)); }),
        },
    };
    const sdk = {
        encoder: {
            createTx: vi.fn(),
            broadcastTx: vi.fn(async () => {
                if (broadcastFails) throw Object.assign(new Error('rejected: bad-txns-inputs-missingorspent'), { code: -25 });
                return {};
            }),
        },
        actions: { createAction: vi.fn() },
        wallet: { decomposePsbt: () => ({ inputs: [{}], outputs: [] }) },
    };
    const signer = {
        kind: 'software',
        signPsbt: vi.fn(async ({ psbtHex }) => ({ txHex: `TX(${psbtHex})`, txid: 'txid-1' })),
    };
    return {
        vault,
        sdk,
        ads: () => settings.ads,
        run: () => submitAction({
            vault,
            walletId: 'w1',
            chainRegistry: { get: () => ({ id: chainId, coin: 'bitcoin', networkKind, adsDonationAddress: DONATE }) },
            sdkRegistry: { get: () => sdk },
            chainId,
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
    it('only accrues when the previewed PSBT carried no donation', async () => {
        const h = makeHarness({ adsDonation: { included: false } });
        await h.run();
        expect(h.ads()).toMatchObject({ queued: '30.05', donated: '0', donationCount: 0 });
    });

    it('takes the donated amount off the queue when the PSBT carried it', async () => {
        const h = makeHarness({ adsDonation: { included: true, fiat: '25', currency: 'USD' } });
        await h.run();
        // 30 queued, 25 donated, plus this send's own 0.05.
        expect(h.ads()).toMatchObject({ queued: '5.05', donated: '25', donationCount: 1 });
    });

    // An envelope from a composer built before the verdict carried an amount
    // cannot say what it paid, so nothing is subtracted.
    it('only accrues for an envelope with no verdict or no amount', async () => {
        const bare = makeHarness({ adsDonation: undefined });
        await bare.run();
        expect(bare.ads()).toMatchObject({ queued: '30.05', donated: '0' });
        const old = makeHarness({ adsDonation: { included: true } });
        await old.run();
        expect(old.ads()).toMatchObject({ queued: '30.05', donated: '0', donationCount: 0 });
    });

    it('books nothing when the broadcast fails', async () => {
        const h = makeHarness({ adsDonation: { included: true, fiat: '25', currency: 'USD' }, broadcastFails: true });
        await expect(h.run()).rejects.toThrow();
        expect(h.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
        // The claim those bytes took is released, so the next send may carry it.
        expect(h.ads().reserved).toBeUndefined();
    });

    it('settles the claim the carrying bytes took, and leaves none behind', async () => {
        const h = makeHarness({ adsDonation: { included: true, fiat: '25', currency: 'USD' } });
        await h.run();
        expect(h.ads().reserved).toBeUndefined();
        expect(h.ads()).toMatchObject({ queued: '5.05', donated: '25', donationCount: 1 });
    });

    it('a test-network send neither accrues nor takes anything off the queue', async () => {
        for (const adsDonation of [{ included: false }, { included: true, fiat: '25', currency: 'USD' }]) {
            const h = makeHarness({ adsDonation, chainId: 'bitcoin-regtest', networkKind: 'regtest' });
            await h.run();
            expect(h.ads()).toMatchObject({ queued: '30', donated: '0', donationCount: 0 });
            expect(h.vault.settings.put).not.toHaveBeenCalled();
        }
    });

    it('never resolves a fresh plan or price on the prebuilt path', async () => {
        const h = makeHarness({ adsDonation: { included: false } });
        await h.run();
        expect(h.sdk.encoder.createTx).not.toHaveBeenCalled();
    });
});

// The cases above hand submitAction an envelope directly, so none of them can
// see a ROUTE that never puts the verdict on one. Every route builds it through
// prebuiltPsbtFromComposed (prebuiltEnvelopeDeferredCarry pins that), so the
// helper carrying the verdict is the assertion.
describe('every prebuilt-PSBT builder carries the compose-time verdict', () => {
    it('carries the verdict and the fiat amount it settles, either way', () => {
        const base = { psbt: 'PSBT', encoding: 'OP_RETURN', actionString: 'ISSUE|0|JDOG', version: 0 };
        expect(prebuiltPsbtFromComposed({
            ...base,
            adsPlan: { canSubmit: true, donationFiat: '25.05', currency: 'EUR' },
        }).adsDonation).toEqual({ included: true, fiat: '25.05', currency: 'EUR' });
        // The review claim the compose took rides along, so Approve can take it over.
        expect(prebuiltPsbtFromComposed({
            ...base,
            adsPlan: { canSubmit: true, donationFiat: '25.05', currency: 'EUR', reservationId: 'ads-review-1' },
        }).adsDonation).toEqual({ included: true, fiat: '25.05', currency: 'EUR', reservationId: 'ads-review-1' });
        expect(prebuiltPsbtFromComposed({ ...base, adsPlan: { canSubmit: false, donationFiat: null } }).adsDonation)
            .toEqual({ included: false, fiat: null, currency: null });
        expect(prebuiltPsbtFromComposed(base).adsDonation).toEqual({ included: false, fiat: null, currency: null });
    });

    it('leaves no route emitting a bare envelope', () => {
        const ROUTES = resolve(dirname(fileURLToPath(import.meta.url)),
            '../../../packages/core/src/shared/routes');
        const bare = readdirSync(ROUTES)
            .filter((f) => f.endsWith('.jsx'))
            .filter((f) => /prebuiltPsbt(:|\s*=)\s*\{/.test(readFileSync(join(ROUTES, f), 'utf8')));
        expect(bare).toEqual([]);
    });
});
