// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Regression: bridge.signAction confirm-what-you-sign integrity, driven through
// the REAL registerBridgeHandlers rather than by scanning the source.
//
// executeSignAction must never spread the page's whole `params` object into
// sendToken / sweepToken and then re-apply the handful of trusted keys it names.
// Any OTHER internal option survives that, and two of them replace what gets
// signed while approvalPayload keeps describing the same to/tick/amount:
//   - `legs`: normalizeSendLegs (core/src/flows/sendLegs.js) prefers opts.legs
//     over to/tick/amount, so an approval rendered for 0.0001 BTC to one address
//     signs a different amount to a different address.
//   - `prebuiltPsbt`: sendToken/sweepToken forward it to submitWithSigner, which
//     signs those bytes verbatim and deliberately does NO rebuild, on the
//     assumption the in-wallet confirm pipeline composed and previewed them. The
//     bridge composes nothing, so nothing previewed them.
// Both are now refused BEFORE the approval prompt, so the wallet never renders a
// screen it cannot honour.

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';

const ORIGIN = 'https://dapp.example';
const CHAIN = 'bitcoin-regtest';

const chainRegistry = {
    get: (id) => (id === CHAIN ? { id, coin: 'bitcoin', networkKind: 'regtest' } : null),
    supportedChains: () => [{ id: CHAIN, coin: 'bitcoin', networkKind: 'regtest' }],
};

function fakeSite() {
    return {
        id: 'site-1',
        origin: ORIGIN,
        permissions: {
            chains: [CHAIN],
            accounts: [],
            canSignAction: {},
            canSignMessage: false,
        },
    };
}

function fakeVault(site) {
    const sites = new Map([[site.id, site]]);
    return {
        settings: { get: async () => ({ blockedOrigins: [] }) },
        connectedSites: {
            findBy: async (field, value) => [...sites.values()].filter((s) => s[field] === value),
            put: async (s) => { sites.set(s.id, s); return s; },
        },
        accounts: { list: async () => [] },
        addresses: { list: async () => [] },
    };
}

// Records every prompt. Approving is deliberate: a divergent request must be
// refused by the shape check, not merely by the user saying no.
function fakeApprovals() {
    const calls = [];
    return {
        calls,
        approvals: {
            signAction: async (req) => {
                calls.push(req);
                return { approved: true, password: 'pw', walletId: 'w1' };
            },
        },
    };
}

function signAction(vault, approvals, params, action = 'SEND') {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals });
    return host.handle({
        type: 'bridge.signAction',
        request: { origin: ORIGIN, chainId: CHAIN, action, params },
    });
}

describe('bridge.signAction refuses page params that diverge the signature', () => {
    let site;
    let vault;
    beforeEach(() => {
        site = fakeSite();
        vault = fakeVault(site);
    });

    for (const action of ['SEND', 'SWEEP']) {
        it(`${action}: a page-supplied prebuiltPsbt is refused before any prompt`, async () => {
            const { approvals, calls } = fakeApprovals();
            const resp = await signAction(vault, approvals, {
                fromAddress: 'bcrt1qfrom',
                toAddress: 'bcrt1qto',
                asset: 'BTC',
                amountRaw: '10000',
                prebuiltPsbt: { psbtHex: 'deadbeef', encoding: 'hex' },
            }, action);

            expect(resp.ok).toBe(false);
            expect(resp.error?.code ?? resp.error).toBe('INVALID_PARAMS');
            expect(resp.error?.message ?? resp.message).toMatch(/prebuiltPsbt/);
            expect(calls, 'the user must never be prompted for a request the screen cannot describe')
                .toHaveLength(0);
        });
    }

    it('SEND: a page-supplied legs array is refused before any prompt', async () => {
        const { approvals, calls } = fakeApprovals();
        const resp = await signAction(vault, approvals, {
            fromAddress: 'bcrt1qfrom',
            toAddress: 'bcrt1qshown',
            asset: 'BTC',
            amountRaw: '10000',
            // What the screen would have shown: 0.0001 BTC to bcrt1qshown.
            // What normalizeSendLegs would have signed:
            legs: [{ to: 'bcrt1qattacker', tick: 'BTC', amount: '1' }],
        });

        expect(resp.ok).toBe(false);
        expect(resp.error?.code ?? resp.error).toBe('INVALID_PARAMS');
        expect(resp.error?.message ?? resp.message).toMatch(/legs/);
        expect(calls).toHaveLength(0);
    });

    it('a clean request still reaches the approval prompt', async () => {
        // The negative control for the three cases above: without it, a handler
        // that refused EVERYTHING would pass all of them. The legacy in-repo
        // names are used deliberately: the published `amountRaw` is scaled to a
        // decimal before the prompt, and that scaling needs a real balance row
        // for the source address, which this vault fake cannot supply.
        const { approvals, calls } = fakeApprovals();
        const resp = await signAction(vault, approvals, {
            fromAddress: 'bcrt1qfrom',
            to: 'bcrt1qto',
            tick: 'BTC',
            amount: '0.0001',
        });

        expect(calls, 'a spec-compliant SEND must still prompt').toHaveLength(1);
        // It fails after the prompt on the fake vault's missing address record;
        // what matters is that it got past the shape gate to get there.
        expect(resp.error?.code ?? resp.error).not.toBe('INVALID_PARAMS');
    });
});
