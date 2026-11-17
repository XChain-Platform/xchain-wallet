// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// My delegations is a wallet menu row (grouped full menu, 2026-11-13). Opened
// from the menu there is no poll chain to seed it, so it reads the delegations
// of the first voting network this wallet has an address on.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { MyDelegations } from '../../../packages/core/src/shared/routes/MyDelegations.jsx';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';

const ADDRESS = Object.freeze({
    id: 'address-1', address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', publicKey: '02aa',
    derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

const votingChains = () => defaultRegistry().supportedChains()
    .filter((d) => Array.isArray(d.supportedActions) && d.supportedActions.includes('VOTE'))
    .map((d) => d.id);

function messagingWith(byChain) {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue(byChain),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        governanceVoteDelegations: vi.fn().mockResolvedValue({ data: [] }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string' || property === 'then') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
}

beforeEach(() => {
    resetBackStackForTests();
    resetWalletModes();
    publishWalletModes({ activeWalletId: 'wallet-1' });
});
afterEach(cleanup);

describe('My delegations opened from the menu', () => {
    it('reads the first voting network the wallet has an address on', async () => {
        const chains = votingChains();
        expect(chains.length, 'the registry has a voting network').toBeGreaterThan(0);
        // The wallet holds an address on the last voting network only, so the
        // pick cannot be the registry's first entry by accident.
        const target = chains[chains.length - 1];
        const messaging = messagingWith({ [target]: [ADDRESS] });
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging },
            React.createElement(MyDelegations, { walletId: 'wallet-1', onClear() {}, onBack() {} }),
        ));
        await screen.findByRole('heading', { name: 'My Delegations' });
        await vi.waitFor(() => expect(messaging.governanceVoteDelegations).toHaveBeenCalled());
        expect(messaging.governanceVoteDelegations).toHaveBeenCalledWith({ chainId: target, address: ADDRESS.address });
    });
});
