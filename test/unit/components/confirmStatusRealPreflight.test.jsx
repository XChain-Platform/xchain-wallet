// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.
// @vitest-environment node

// What the Confirm status notice says for real actions, end to end: the
// wallet's SDK registry builds the real SDK, the host's action.preflight route
// runs it, useConfirmAction holds the report, the modal's report filter and
// confirmStatus pick the notice, and ConfirmStatusNotice draws it. Only the
// explorer's reads are stubbed; every other network read is refused.

import React from 'react';
import { JSDOM } from 'jsdom';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createBackgroundHost } from '../../../packages/extension/src/background/createBackgroundHost.js';
import { amountRulesFromSdk } from '../../../packages/core/src/flows/amountRepresentability.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { SDKRegistry } from '../../../packages/core/src/sdk/SDKRegistry.js';
import { adaptXChainSDK } from '../../../packages/core/src/sdk/defaultFactory.js';
import { requireSdkDeep, sdkInstalled } from '../../helpers/sdkDeepPaths.js';
import { memCollection } from '../background/_addressesByChainFixture.js';

const installed = sdkInstalled();

// The SDK refuses its curve library inside the jsdom test environment, so this
// file runs in Node and gives React a window of its own once the SDK is loaded.
// XMLHttpRequest stays out, so no stray read can leave through jsdom.
let ui = null;
beforeAll(async () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    for (const key of Object.getOwnPropertyNames(dom.window)) {
        if (key in globalThis || key.startsWith('_') || key === 'XMLHttpRequest') continue;
        globalThis[key] = dom.window[key];
    }
    for (const key of ['window', 'document', 'navigator']) {
        Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true });
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    const [rtl, hook, model, comp, modal] = await Promise.all([
        import('@testing-library/react'),
        import('../../../packages/core/src/shared/hooks/useConfirmAction.js'),
        import('../../../packages/core/src/shared/utils/confirmStandardModel.js'),
        import('../../../packages/core/src/shared/components/ConfirmStandard.jsx'),
        import('../../../packages/core/src/shared/components/ConfirmActionModal.jsx'),
    ]);
    ui = {
        ...rtl,
        useConfirmAction: hook.useConfirmAction,
        confirmStatus: model.confirmStatus,
        ConfirmStatusNotice: comp.ConfirmStatusNotice,
        displayed: modal.reportWithoutUnverifiedNativeFeeWarning,
    };
});
afterEach(() => ui?.cleanup());

const XCP = { tick: 'XCP', info: { tick: 'XCP', decimals: 8, owner: 'own-address' }, supply: { max: '0', current: '1000000', decimals: 8 } };
const EDITION = { tick: 'EDITION', info: { tick: 'EDITION', decimals: 0 }, supply: { max: '100', current: '40', decimals: 0 }, max_mint: '1' };
const OPEN_MINT = { tick: 'OPENMINT', info: { tick: 'OPENMINT', decimals: 0 }, supply: { max: '0', current: '40', decimals: 0 }, max_mint: '5' };
const TOKENS = { XCP, EDITION, OPENMINT: OPEN_MINT };

const notFound = () => Object.assign(new Error('Request failed with status code 404'), { code: 'EXPLORER_HTTP_404' });
const refused = (what) => async () => { throw new Error(`network read refused in test: ${what}`); };

// The real SDK the wallet builds for this chain, its explorer approving and answering every read.
function realSdkFor(chainId, { failTokenRead = false, dryRunDown = false } = {}) {
    const XChainSDK = requireSdkDeep('xchainSdkIndex').XChainSDK;
    const registry = new SDKRegistry({ chainRegistry: defaultRegistry(), sdkFactory: adaptXChainSDK(XChainSDK) });
    const sdk = registry.get(chainId);
    sdk.explorer.get = refused('explorer.get');
    if (sdk.hub) {
        for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(sdk.hub))) {
            if (key !== 'constructor' && typeof sdk.hub[key] === 'function') sdk.hub[key] = refused(`hub.${key}`);
        }
    }
    sdk.explorer.getPreflight = dryRunDown
        // What the wallet sees when the request never answers: an aborted fetch or a timeout.
        ? async () => { throw new Error('Explorer request failed: Network Error'); }
        : async () => ({ supported: true, valid: true, status: 'valid' });
    // The explorer layer backs the whole host off after that transport failure
    // (explorerRateLimit.js, 1.5 to 2.5 s), so a read the pre-flight makes beside
    // the dry run can miss its own budget too: an ISSUE's activation read does.
    sdk.explorer.getStatus = dryRunDown
        ? async () => { throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }); }
        : async () => ({ last_block: { [sdk.explorer.coin]: 300000 } });
    sdk.explorer.getToken = async (tick) => {
        if (failTokenRead) throw new Error('timeout of 8000ms exceeded');
        if (TOKENS[tick]) return TOKENS[tick];
        throw notFound();
    };
    sdk.explorer.getBalances = async () => ({ data: [
        { tick: 'XCP', quantity: '1000', divisibility: 0 },
        { tick: 'EDITION', quantity: '1', divisibility: 0 },
    ] });
    sdk.getAddress = async () => ({ balances: { confirmed: '5' } });
    return sdk;
}

function hostFor(sdk) {
    return createBackgroundHost({
        vault: {
            wallets: memCollection(), accounts: memCollection(), addresses: memCollection(), signers: memCollection(),
            settings: { async get() { return { schemaVersion: 1, activeNetwork: 'regtest', fees: {}, ads: { perChain: {} } }; }, async put() {} },
            pendingTxs: { async list() { return []; } },
        },
        chainRegistry: defaultRegistry(),
        sdkRegistry: { get: () => sdk },
        signerPool: { get: () => null, has: () => false },
        broadcastQueueStorage: null,
        signThrottleStorage: null,
        logConsoleStorage: null,
        loadAmountRules: async () => amountRulesFromSdk({
            numeric: requireSdkDeep('preflightNumeric'),
            amountFormat: requireSdkDeep('preflightAmountFormat'),
        }),
    });
}

// Opens the confirm for an envelope through useConfirmAction and returns the drawn notice.
async function confirmNotice(chainId, envelope, opts) {
    const { act, render, renderHook, waitFor, useConfirmAction, confirmStatus, ConfirmStatusNotice, displayed } = ui;
    const host = hostFor(realSdkFor(chainId, opts));
    const { result, unmount } = renderHook(() => useConfirmAction());
    act(() => {
        result.current.confirm({
            chainId,
            source: 'own-address',
            compose: async () => ({ psbt: '70736274ff', payFeeInNativeCoin: false, bareNativePayment: false, ...envelope }),
            preflight: async (o) => {
                const res = await host.handle({ type: 'action.preflight', request: { chainId, ...o } });
                if (!res.ok) throw new Error(res.error?.message || 'preflight failed');
                return res.result;
            },
            onApprove: async () => null,
        }).catch(() => {});
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'), { timeout: 10_000 });
    const report = result.current.report;
    const status = confirmStatus({ report: displayed(report), applies: !result.current.composed?.bareNativePayment });
    const view = render(<ConfirmStatusNotice status={status} acknowledged={new Set()} onAcknowledge={() => {}} />);
    const notice = view.queryByTestId('confirm-status');
    const out = {
        state: notice ? notice.getAttribute('data-state') : null,
        text: notice ? notice.textContent : '',
        unverified: (report?.unverified || []).map((u) => u.check),
        reasons: (report?.unverified || []).map((u) => u.reason).filter(Boolean),
    };
    view.unmount();
    act(() => { result.current.reject?.(); });
    unmount();
    return out;
}

const action = (actionString) => ({ actionString });
const CHAINS = ['bitcoin-regtest', 'bitcoin-testnet', 'bitcoin-mainnet'];

describe.skipIf(!installed)('Confirm status on the real pre-flight path', () => {
    it.each(CHAINS)('a plain token send on %s is checked when it settles, with no SDK text on screen', async (chainId) => {
        const out = await confirmNotice(chainId, action('SEND|0|XCP|1.5|own-dest'));
        expect(out.unverified).toEqual(expect.arrayContaining(['LEG_AMOUNT_CONSOLIDATION', 'SEND_RESTRICTIONS', 'GATED_HANDOFF_REF']));
        expect(out.unverified).not.toContain('AMOUNT_REPRESENTABILITY');
        expect(out.state).toBe('settleChecks');
        expect(out.text).toContain('Checked When It Settles');
        expect(out.text).toContain('How the key to locked content reaches the recipient');
        for (const reason of out.reasons) expect(out.text).not.toContain(reason);
        expect(out.text).not.toMatch(/server-side|flag-day|activation|_[A-Z]{3,}/);
    }, 30_000);

    it.each(CHAINS)('a three-recipient token send on %s is checked when it settles', async (chainId) => {
        const out = await confirmNotice(chainId, action('SEND|1|XCP|1|dest-a|2.5|dest-b|3|dest-c'));
        expect(out.unverified).not.toContain('AMOUNT_REPRESENTABILITY');
        expect(out.state).toBe('settleChecks');
    }, 30_000);

    it.each(CHAINS)('an edition mint on %s is checked when it settles', async (chainId) => {
        const out = await confirmNotice(chainId, action('MINT|0|EDITION|1'));
        expect(out.unverified).toEqual(['MINT_ADDRESS_HEADROOM']);
        expect(out.state).toBe('settleChecks');
    }, 30_000);

    it.each(CHAINS)('a new-token ISSUE on %s stays a plain pass', async (chainId) => {
        const out = await confirmNotice(chainId, action('ISSUE|0|NEWTOK|1000||0||1000'));
        expect(out.unverified).toEqual([]);
        expect(out.state).toBe('pass');
    }, 30_000);

    // A fee-bearing action also carries the fee-forfeit warning the modal strips;
    // its settle-time checks must still reach the blue note, not hold it at warn.
    it.each(CHAINS)('a dividend and an ISSUE edit on %s are checked when they settle', async (chainId) => {
        const dividend = await confirmNotice(chainId, action('DIVIDEND|0|XCP|XCP|0.001'));
        expect(dividend.unverified).toEqual(['DIVIDEND_DEBIT_TOTAL']);
        expect(dividend.state).toBe('settleChecks');
        const edit = await confirmNotice(chainId, action('ISSUE|0|XCP|||||||1'));
        expect(edit.unverified).toEqual(['ISSUE_LOCK_RATCHETS', 'ISSUE_BRIDGE_POLICY_EXCLUSION']);
        expect(edit.state).toBe('settleChecks');
    }, 60_000);

    it.each(CHAINS)('an airdrop whose list read fails on %s never reads as checked', async (chainId) => {
        const out = await confirmNotice(chainId, action('AIRDROP|0|XCP|1|7'));
        expect(out.unverified).toContain('LIST_LOOKUP');
        expect(['settleChecks', 'pass']).not.toContain(out.state);
    }, 30_000);

    it('shows no network claim for a native coin payment', async () => {
        const out = await confirmNotice('bitcoin-regtest', { actionString: null, bareNativePayment: true });
        expect(out.state).toBeNull();
    }, 30_000);

    it.each(CHAINS)('a send whose token read fails on %s stays only partly checked', async (chainId) => {
        const out = await confirmNotice(chainId, action('SEND|0|XCP|1.5|own-dest'), { failTokenRead: true });
        expect(out.unverified).toContain('TOKEN_LOOKUP');
        expect(out.state).toBe('partial');
        expect(out.text).toContain('Only partly checked');
        expect(out.text).not.toContain('timeout of 8000ms exceeded');
    }, 30_000);

    it.each(CHAINS)('a mint of an uncapped token on %s keeps the supply limit it could not judge red', async (chainId) => {
        const out = await confirmNotice(chainId, action('MINT|0|OPENMINT|1'));
        expect(out.unverified).toContain('SUPPLY_EXCEEDED');
        expect(out.state).toBe('partial');
    }, 30_000);

    // PRICE v1 is the oracle publish the wallet composes (flows/oraclePriceAction.js).
    // The SDK declares PRICE_STATE on every PRICE whatever the address; v1 itself
    // needs no stake (xchain-indexer src/actions/price/index.js), so no state the
    // wallet could read would refuse it, and the review is the blue settle note.
    it.each(CHAINS)('a first oracle price publish on %s is checked when it settles, with no SDK text', async (chainId) => {
        const out = await confirmNotice(chainId, action('PRICE|1|BTC|XCHAIN|USD|1.50|0.01|'));
        expect(out.unverified).toEqual(['PRICE_STATE']);
        expect(out.state).toBe('settleChecks');
        expect(out.text).toContain('Checked When It Settles');
        expect(out.text).toContain('Whether this address may publish prices');
        expect(out.text).not.toContain('Only partly checked');
        for (const reason of out.reasons) expect(out.text).not.toContain(reason);
        expect(out.text).not.toMatch(/server-side|capability|_[A-Z]{3,}/);
    }, 30_000);

    it.each(CHAINS)('an oracle price republish at double the last price on %s is checked when it settles', async (chainId) => {
        const out = await confirmNotice(chainId, action('PRICE|1|BTC|XCHAIN|USD|3.00|0.01|'));
        expect(out.unverified).toEqual(['PRICE_STATE']);
        expect(out.state).toBe('settleChecks');
        expect(out.text).not.toMatch(/server-side|capability|_[A-Z]{3,}/);
    }, 30_000);

    // A dry run that never answered (an aborted request, a timeout) is not a
    // reason to doubt the action: the notice says it was not checked with the
    // network, never the "check this" warning a real concern raises. A
    // fee-bearing action carries the forfeit warning the modal strips, and the
    // activation read that missed beside the dry run must not hold it at warn.
    it.each(CHAINS)('a new-token ISSUE on %s whose dry run never answers is not checked, not a warning', async (chainId) => {
        const out = await confirmNotice(chainId, action('ISSUE|0|NEWTOK|1000||8||1000'), { dryRunDown: true });
        if (chainId === 'bitcoin-testnet') {
            expect(out.unverified).toContain('ISSUE_TICK_COIN_PREFIX');
        } else {
            expect(out.unverified).not.toContain('ISSUE_TICK_COIN_PREFIX');
        }
        expect(out.state).toBe('notChecked');
        expect(out.text).toContain('Not checked with the network');
        expect(out.text).not.toContain('Check this before you approve');
    }, 30_000);


    it('a mainnet send in exponent form keeps the amount rule red', async () => {
        const out = await confirmNotice('bitcoin-mainnet', action('SEND|0|XCP|1e2|own-dest'));
        expect(out.unverified).toContain('AMOUNT_REPRESENTABILITY');
        expect(out.state).toBe('partial');
        expect(out.text).toContain('Whether every amount is written in a form the network accepts');
    }, 30_000);
});
