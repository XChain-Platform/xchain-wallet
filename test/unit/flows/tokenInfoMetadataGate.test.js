// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SSC-5's SECOND control ( §1.1, corrected 2026-08-02).
//
// The contract used to say `img-src 'self' data: blob:` was "the whole
// control" on remote token media. It is the whole control on every media
// TAG, and it does not touch the one remote request that matters most:
// `tokenInfoFor` fetches a token-information document from a host named in
// the token's OWN on-chain description. That is a fetch(), so it answers to
// `connect-src`, which is deliberately broad because the wallet talks to
// user-configured endpoints nobody can enumerate at build time. No
// tightening of `img-src` will ever reach it.
//
// So the only thing standing between an airdropped token and a
// deanonymization beacon (the holder's IP, plus which token was opened,
// disclosed to a host the ISSUER chose) is
// `settings.privacy.metadataFetchEnabled`, which DEFAULTS TO TRUE. That is
// a disclosed product decision, not a defect: `privacy/wireAudit.js`
// registers the issuer-chosen host as a class and names this control.
//
// It had no test. `img-src` is structural and cannot be forgotten; this one
// is an ordinary boolean read at one call site, and a call site that forgets
// to pass it silently restores the beacon. That asymmetry is why the weaker
// control is the one that needs pinning.

import { describe, it, expect } from 'vitest';
import { tokenInfoFor } from '../../../packages/core/src/flows/tokenInfo.js';

const ISSUER_URL = 'https://issuer.example/token.json';

const TIS_JSON = JSON.stringify({
    tick: 'BEACON',
    name: 'Beacon Token',
    categories: [{ type: 'main', data: 'NFT' }],
});

/**
 * An SDK whose token row carries an issuer-chosen description, i.e. exactly
 * what an airdropped token controls.
 */
function registryFor(description) {
    return {
        get: () => ({
            getToken: async () => ({ info: { description } }),
        }),
    };
}

/** A fetch that records every URL it is asked for and never really leaves. */
function recordingFetch(body = TIS_JSON) {
    const calls = [];
    const impl = async (url) => {
        calls.push(String(url));
        return { ok: true, text: async () => body };
    };
    impl.calls = calls;
    return impl;
}

describe('SSC-5 second control: metadataFetchEnabled gates the issuer-chosen fetch', () => {
    it('makes NO request when the control is off, however hostile the description', async () => {
        const fetchImpl = recordingFetch();
        await tokenInfoFor({
            sdkRegistry: registryFor(ISSUER_URL),
            chainId: 'BTC',
            tick: 'BEACON',
            metadataFetchEnabled: false,
            fetch: fetchImpl,
        });
        expect(fetchImpl.calls).toEqual([]);
    });

    it('DOES request when the control is left at its default, which is the disclosed posture', async () => {
        const fetchImpl = recordingFetch();
        await tokenInfoFor({
            sdkRegistry: registryFor(ISSUER_URL),
            chainId: 'BTC',
            tick: 'BEACON',
            // metadataFetchEnabled deliberately omitted: the default is TRUE,
            // and the wire audit / store forms are filled on that basis. If
            // this ever comes back empty, the disclosure is now wrong too.
            fetch: fetchImpl,
        });
        expect(fetchImpl.calls).toEqual([ISSUER_URL]);
    });

    it('resolves ipfs:// and ar: through the gateways the wire audit names, and only when enabled', async () => {
        for (const [description, expected] of [
            ['ipfs://QmBeacon/x.json', 'https://ipfs.io/ipfs/QmBeacon/x.json'],
            ['ar:beaconTxId', 'https://arweave.net/beaconTxId'],
        ]) {
            const on = recordingFetch();
            await tokenInfoFor({
                sdkRegistry: registryFor(description), chainId: 'BTC', tick: 'BEACON', fetch: on,
            });
            expect(on.calls).toEqual([expected]);

            const off = recordingFetch();
            await tokenInfoFor({
                sdkRegistry: registryFor(description),
                chainId: 'BTC',
                tick: 'BEACON',
                metadataFetchEnabled: false,
                fetch: off,
            });
            expect(off.calls).toEqual([]);
        }
    });

    it('never egresses for an on-chain action: pointer, which resolves through the explorer', async () => {
        // The on-chain TIS form is the one that is safe by construction rather
        // than by setting: it is read from the same explorer the token row came
        // from, so there is no issuer-chosen host to leak to at all.
        const fetchImpl = recordingFetch();
        await tokenInfoFor({
            sdkRegistry: registryFor('action:101'),
            chainId: 'BTC',
            tick: 'BEACON',
            fetch: fetchImpl,
        });
        expect(fetchImpl.calls).toEqual([]);
    });
});
