// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// bridge.parallel (§43.2 / §42.8.2): the cross-chain composer batches N
// actions into one call. These drive the real registerBridgeHandlers through
// a real MessageHost against a fake vault + approvals, exercising the batch
// orchestration WITHOUT reaching the SEND/SWEEP signing flow (every action
// here fails or is rejected before a signature would be produced), so no SDK
// wiring is needed.

import { describe, it, expect, beforeEach } from 'vitest';
import { MessageHost } from '../../../packages/extension/src/background/MessageHost.js';
import { registerBridgeHandlers } from '../../../packages/extension/src/bridge/handlers.js';
import handlersSource from '../../../packages/extension/src/bridge/handlers.js?raw';

const ORIGIN = 'https://composer.example';

const chainRegistry = {
    get: (id) => (id === 'bitcoin-regtest' ? { id, coin: 'bitcoin', networkKind: 'regtest' } : null),
    supportedChains: () => [{ id: 'bitcoin-regtest', coin: 'bitcoin', networkKind: 'regtest' }],
};

function fakeSite(overrides = {}) {
    return {
        id: 'site-1',
        origin: ORIGIN,
        permissions: {
            // Non-empty chains list so 'litecoin-regtest' is genuinely unpermitted
            // (an empty list means "all permitted" in this model).
            chains: ['bitcoin-regtest'],
            accounts: [],
            canSignAction: {},
            canSignMessage: false,
            ...overrides,
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

function fakeApprovals({ signAction, parallel } = {}) {
    const calls = { signAction: [], parallel: [] };
    const approvals = {
        signAction: async (req) => {
            calls.signAction.push(req);
            return signAction ?? { approved: false };
        },
    };
    if (parallel !== undefined) {
        approvals.parallel = async (req) => {
            calls.parallel.push(req);
            return parallel;
        };
    }
    return { approvals, calls };
}

function runParallel(vault, approvals, actions) {
    const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
    registerBridgeHandlers(host, { approvals });
    return host.handle({ type: 'bridge.parallel', request: { origin: ORIGIN, actions } });
}

describe('bridge.parallel: the Phase-4 deferral is gone', () => {
    it('no longer emits a PHASE_DEFERRED stub', () => {
        expect(handlersSource.includes('PHASE_DEFERRED')).toBe(false);
    });
    it('iterates the actions array and preserves input order in the result', () => {
        // Loops the batch and pushes one result per action.
        expect(/for \(const action of actions\)/.test(handlersSource)).toBe(true);
        expect(/results\.push\(/.test(handlersSource)).toBe(true);
    });
});

describe('bridge.parallel: per-action results carry their own ok flag', () => {
    let site;
    let vault;
    beforeEach(() => {
        site = fakeSite();
        vault = fakeVault(site);
    });

    it('folds unsupported / unpermitted / rejected actions into ordered ok:false entries', async () => {
        const { approvals, calls } = fakeApprovals({ signAction: { approved: false } });
        const resp = await runParallel(vault, approvals, [
            { chainId: 'bitcoin-regtest', action: 'ISSUE', params: {} },          // unsupported kind
            { chainId: 'litecoin-regtest', action: 'SEND', params: { from: 'x' } }, // chain not permitted
            { chainId: 'bitcoin-regtest', action: 'SEND', params: { from: 'x' } },  // user rejects
        ]);

        expect(resp.ok).toBe(true);
        const results = resp.result;
        expect(Array.isArray(results)).toBe(true);
        expect(results).toHaveLength(3);

        // Order preserved, each entry self-describes success/failure.
        expect(results[0].ok).toBe(false);
        expect(results[0].error).toBe('UNSUPPORTED_ACTION');
        expect(results[0].supportedActions).toEqual(['SEND', 'SWEEP']);

        expect(results[1].ok).toBe(false);
        // The published code, not the wallet's internal CHAIN_NOT_PERMITTED: a
        // batch entry is read by the page and must carry a BridgeErrorCode
        //The internal name survives in the message.
        expect(results[1].error).toBe('CHAIN_NOT_SUPPORTED');
        expect(results[1].message).toMatch(/CHAIN_NOT_PERMITTED/);

        expect(results[2].ok).toBe(false);
        expect(results[2].error).toBe('USER_REJECTED');

        // Only the supported, permitted action ever opened an approval prompt:
        // the unsupported kind and the unpermitted chain are refused before it.
        expect(calls.signAction).toHaveLength(1);
        expect(calls.signAction[0].action).toBe('SEND');
        expect(calls.signAction[0].chainId).toBe('bitcoin-regtest');
    });

    it('an action never override the approved chainId is enforced in one shared code path', () => {
        // executeSignAction is the single place that builds the flow call; the
        // sign-action-chain-scope regression already guards its key ordering.
        // Assert both the single and the batch handler route through it.
        expect(/return executeSignAction\(req, deps, \{/.test(handlersSource)).toBe(true);
        expect(/await executeSignAction\(actionReq, deps, \{/.test(handlersSource)).toBe(true);
    });
});

describe('bridge.parallel: batch-level validation', () => {
    let vault;
    beforeEach(() => { vault = fakeVault(fakeSite()); });

    it('rejects an empty actions array with INVALID_PARAMS', async () => {
        const { approvals } = fakeApprovals();
        const resp = await runParallel(vault, approvals, []);
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('INVALID_PARAMS');
    });

    it('rejects a non-array actions payload with INVALID_PARAMS', async () => {
        const { approvals } = fakeApprovals();
        const host = new MessageHost({ vault, chainRegistry, sdkRegistry: {} });
        registerBridgeHandlers(host, { approvals });
        const resp = await host.handle({ type: 'bridge.parallel', request: { origin: ORIGIN } });
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('INVALID_PARAMS');
    });

    it('rejects an oversized batch with INVALID_PARAMS', async () => {
        const { approvals } = fakeApprovals();
        const actions = Array.from({ length: 21 }, () => ({
            chainId: 'bitcoin-regtest', action: 'SEND', params: { from: 'x' },
        }));
        const resp = await runParallel(vault, approvals, actions);
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('INVALID_PARAMS');
    });
});

describe('bridge.parallel: grouped approval modal', () => {
    let vault;
    beforeEach(() => { vault = fakeVault(fakeSite()); });

    it('rejecting the grouped modal rejects the whole batch and signs nothing', async () => {
        const { approvals, calls } = fakeApprovals({ parallel: { approved: false } });
        const resp = await runParallel(vault, approvals, [
            { chainId: 'bitcoin-regtest', action: 'SEND', params: { from: 'x' } },
            { chainId: 'bitcoin-regtest', action: 'SEND', params: { from: 'y' } },
        ]);
        expect(resp.ok).toBe(false);
        expect(resp.error.name).toBe('UserRejectedError');
        expect(resp.error.message).toContain('parallel');
        // No per-action prompt fired: the grouped rejection short-circuits.
        expect(calls.parallel).toHaveLength(1);
        expect(calls.signAction).toHaveLength(0);
    });

    it('an approved grouped modal is not re-prompted per action', async () => {
        // The grouped decision is threaded into every action. A chain-not-
        // permitted action still fails per-slot, proving the per-action gate
        // survives, while no per-action signAction prompt is opened.
        const { approvals, calls } = fakeApprovals({
            parallel: { approved: true, password: 'pw' },
        });
        const resp = await runParallel(vault, approvals, [
            { chainId: 'bitcoin-regtest', action: 'ISSUE', params: {} },            // unsupported
            { chainId: 'litecoin-regtest', action: 'SEND', params: { from: 'x' } },  // chain not permitted
        ]);
        expect(resp.ok).toBe(true);
        expect(resp.result[0].error).toBe('UNSUPPORTED_ACTION');
        expect(resp.result[1].error).toBe('CHAIN_NOT_SUPPORTED');
        expect(calls.parallel).toHaveLength(1);
        expect(calls.signAction).toHaveLength(0);
    });

    it('a grouped modal that approves without a password rejects the batch', async () => {
        const { approvals } = fakeApprovals({ parallel: { approved: true } });
        const resp = await runParallel(vault, approvals, [
            { chainId: 'bitcoin-regtest', action: 'SEND', params: { from: 'x' } },
        ]);
        expect(resp.ok).toBe(false);
        expect(resp.error.message).toContain('NO_PASSWORD');
    });
});
