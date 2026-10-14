// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { afterAll, afterEach, beforeAll, describe, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ROUTE_REGISTRY } from '../../../packages/core/src/shared/routeRegistry.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

vi.mock('../../../packages/core/src/shared/components/MarketChart.jsx', () => ({
    MarketChart: () => <div>Market chart</div>,
}));

const routeModules = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
);

const ROUTE_NAMES = [
    'ManageToken',
    'MarketActivity',
    'MarketView',
    'MarketsList',
    'MenuRoute',
    'MessagingInbox',
    'MigrateToBip39',
    'MintForm',
    'MultisigCosignerShare',
    'MultisigCreate',
    'MultisigSigningSession',
    'MyBets',
    'MyLists',
    'MyOrdersView',
    'MySwapsView',
    'MyTokens',
    'ObligationsView',
    'OperatorDashboard',
    'OracleConsole',
    'OracleForm',
    'OracleRecord',
    'PairPartnerWallet',
    'PairSignerForm',
    'ParallelComposer',
    'PollDetail',
    'ProjectRosterForm',
    'PsbtSignForm',
    'PublishFileForm',
    'ReceivePicker',
    'RenameAccountForm',
    'RenameWalletForm',
    'ResumeConfirm',
    'RouteNotFound',
    'ScanRoute',
    'SellOwnershipForm',
    'SendPicker',
    'SharedListDirectory',
    'SignMessageForm',
    'SignerSelectForm',
    'SleepForm',
    'StakeDetail',
    'StakeForm',
    'StakeNew',
    'StakingActionForm',
    'StakingList',
    'SwapForm',
    'SweepForm',
    'TokenAdminForm',
    'TokenPicker',
    'TokenWizard',
    'UnionListForm',
    'VaultUnavailable',
    'VerifySignatureForm',
    'ViewPrivateKey',
    'WalletDetails',
    'WalletPicker',
];

const ROUTE_PROPS = Object.values(ROUTE_REGISTRY).reduce((props, route) => {
    if (!(route.component in props)) props[route.component] = route.minimalProps;
    return props;
}, {});

const DEFAULT_PROPS = {
    walletId: 'wallet-1',
    accountId: 'account-1',
    chainId: 'bitcoin-mainnet',
    tick: 'A11Y',
    tick1: 'A11Y',
    tick2: 'BTC',
    mode: 'transfer',
    divisibility: 0,
    actionIndex: '1',
    address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    contractId: '1',
    dispenserId: '1',
    addresses: [],
    entries: [],
    onBack() {},
    onDone() {},
    onClose() {},
    onNavigate() {},
    onSelect() {},
    onFork() {},
};

function pending() {
    return new Promise(() => {});
}

function messaging() {
    return new Proxy({}, {
        get(target, property) {
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

async function loadRoute(name) {
    const path = Object.keys(routeModules).find((candidate) => (
        candidate.endsWith(`/${name}.jsx`)
    ));
    const module = await routeModules[path]();
    return module[name];
}

let savedGlobals;
beforeAll(() => {
    class StubObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    savedGlobals = {
        ResizeObserver: globalThis.ResizeObserver,
        IntersectionObserver: globalThis.IntersectionObserver,
        matchMedia: globalThis.matchMedia,
    };
    globalThis.ResizeObserver = StubObserver;
    globalThis.IntersectionObserver = StubObserver;
    globalThis.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent() { return false; },
    });
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

afterAll(() => {
    globalThis.ResizeObserver = savedGlobals.ResizeObserver;
    globalThis.IntersectionObserver = savedGlobals.IntersectionObserver;
    globalThis.matchMedia = savedGlobals.matchMedia;
});

describe('M-Z route accessibility', () => {
    it.each(ROUTE_NAMES)('scans %s', async (name) => {
        const Component = await loadRoute(name);
        const props = { ...DEFAULT_PROPS, ...ROUTE_PROPS[name] };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <Component {...props} />
            </MessagingProvider>,
        );
        await expectNoSeriousAxeViolations(container);
    });
});
