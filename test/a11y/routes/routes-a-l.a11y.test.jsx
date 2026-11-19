// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createElement } from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ToastHost } from '../../../packages/core/src/shared/components/ToastHost.jsx';
import { createDefaultSettings } from '../../../packages/core/src/schemas/settings.js';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const routeModules = import.meta.glob(
    '../../../packages/core/src/shared/routes/*.jsx',
    { eager: true },
);

const ROUTE_NAMES = [
    'AccountPicker',
    'ActionsMenu',
    'AddAccountForm',
    'AddAddressModal',
    'AddressList',
    'AddressPreferencesForm',
    'AdvancedActionsForm',
    'AirdropForm',
    'AlertsRoute',
    'AttachContentForm',
    'BatchComposerForm',
    'BetFeedDetail',
    'BetFeedsList',
    'BridgeMoveForm',
    'BridgeOriginBadge',
    'BroadcastForm',
    'CallbackForm',
    // Order detail's and Swap Details' Cancel and Edit form routes.
    'CancelOrderForm',
    'CancelSwapForm',
    'CoSignerAccountDetail',
    'CoSignerAccountList',
    'CoSignerPolicyEditor',
    'CoSignerProvision',
    'CoinpayForm',
    'ComposeMessage',
    'ConnectedSites',
    'ContactsList',
    'ContractDetail',
    'ContractFundsForm',
    'ContractsList',
    'ControllerBindForm',
    'CreateBetFeedForm',
    'CreateOrderForm',
    'CreatePollForm',
    'CreateWallet',
    'CrossChainOrderForm',
    'CrossChainSwapForm',
    'DelegateVoteForm',
    'DeployContractForm',
    'DestroyForm',
    'DispenserDetail',
    'DispenserExplorer',
    'DispenserForm',
    'DispensersList',
    'DividendForm',
    'EditOrderForm',
    'EditSwapForm',
    'ExecuteContractForm',
    'GatedPublishForm',
    'GovernancePolls',
    'History',
    'Home',
    'ImportWallet',
    'IssueTokenForm',
    'LinkForm',
    'ListCreateForm',
    'ListDetail',
    'ListLookForm',
    'Loading',
    'Locked',
];

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
const SETTINGS = createDefaultSettings();
const LIST_REF = {
    chainId: CHAIN,
    actionIndex: '1',
    parentIndex: '1',
    source: ADDRESS,
    type: '1',
    items: ['XCP'],
    state: {},
};

const noop = () => {};
const COMMON_PROPS = {
    walletId: 'wallet-1',
    accountId: 'account-1',
    activeAccountId: 'account-1',
    chainId: CHAIN,
    chainIds: [CHAIN],
    initialChainId: CHAIN,
    address: ADDRESS,
    initialFromAddress: ADDRESS,
    contractActionIndex: '1',
    actionIndex: '1',
    feedIndex: '1',
    tick: 'XCP',
    initialTick: 'XCP',
    presetTick: 'XCP',
    issuerAddress: ADDRESS,
    entries: [],
    listRef: LIST_REF,
    onBack: noop,
    onClose: noop,
    onChange: noop,
    onDone: noop,
    onCreated: noop,
    onGenerated: noop,
    onImported: noop,
    onOpen: noop,
    onSelect: noop,
    onUnlocked: noop,
};

const ROUTE_OVERRIDES = {
    BridgeOriginBadge: { tick: 'BTC.XCP', localCoin: 'DOGE' },
    ContractFundsForm: { mode: 'deposit' },
    DelegateVoteForm: { mode: 'delegate' },
};

function pending() {
    return new Promise(() => {});
}

function messaging() {
    const base = {
        getSettings: vi.fn().mockResolvedValue(SETTINGS),
        updateSettings: vi.fn().mockResolvedValue(SETTINGS),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
    };
    return new Proxy(base, {
        get(target, property) {
            if (property in target) return target[property];
            if (typeof property !== 'string') return undefined;
            const stub = vi.fn(pending);
            target[property] = stub;
            return stub;
        },
    });
}

function componentFor(name) {
    const entry = Object.entries(routeModules)
        .find(([path]) => path.endsWith(`/${name}.jsx`));
    const exportName = name === 'BridgeOriginBadge' ? 'BridgeOriginTick' : name;
    return entry?.[1]?.[exportName];
}

afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
});

describe('A through L route accessibility', () => {
    it.each(ROUTE_NAMES)('scans %s', async (name) => {
        const Component = componentFor(name);
        const props = { ...COMMON_PROPS, ...ROUTE_OVERRIDES[name] };
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <ToastHost>{createElement(Component, props)}</ToastHost>
            </MessagingProvider>,
        );

        await expectNoSeriousAxeViolations(container);
    });

    // Create List on the Union type (picked in its List type field), which draws the
    // union body in place of the address and token fields.
    it('scans ListCreateForm on the Union type', async () => {
        const Component = componentFor('ListCreateForm');
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <ToastHost>{createElement(Component, { ...COMMON_PROPS, initialType: '3' })}</ToastHost>
            </MessagingProvider>,
        );

        await expectNoSeriousAxeViolations(container);
    });

    // The one List form on each list action (the list-rename, list-share,
    // list-transfer and list-fork routes), which replaced the four list forms.
    it.each(['edit', 'share', 'transfer', 'fork'])('scans ListCreateForm on the %s action', async (action) => {
        const Component = componentFor('ListCreateForm');
        const { container } = render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <ToastHost>{createElement(Component, { ...COMMON_PROPS, action })}</ToastHost>
            </MessagingProvider>,
        );

        await expectNoSeriousAxeViolations(container);
    });
});
