// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pin the generic composers' fallback action list to the registry's
// authorable set, so a failed SDK introspection never offers less than the
// registry says is authorable. Assertions read the registry constants, never
// a literal, so this test cannot drift either.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ParallelComposer } from '../../../packages/core/src/shared/routes/ParallelComposer.jsx';
import { BatchComposerForm } from '../../../packages/core/src/shared/routes/BatchComposerForm.jsx';
import {
    AUTHORABLE_ACTIONS,
    BTC_EXCLUSIVE_ACTIONS,
    COMMON_ACTIONS,
} from '../../../packages/core/src/registry/actions.js';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const FROM = {
    id: 'address-1',
    address: 'bc1qfallbackfromaddress00000000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => cleanup());

function messagingWith(listActions, chainId) {
    return {
        getAddressesByChain: vi.fn(async () => ({ [chainId]: [FROM] })),
        getActiveAddresses: vi.fn(async () => ({ [chainId]: FROM })),
        listActions,
        getSettings: vi.fn(async () => ({ walletMode: 'full' })),
        signerReady: vi.fn(async () => ({ ready: true })),
    };
}

// Read the option values of the first "Action" picker, blank option dropped.
async function actionOptions() {
    const label = await screen.findByText('Action', { selector: 'span' });
    const select = within(label.closest('label')).getByRole('combobox');
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1));
    return [...select.querySelectorAll('option')].map((o) => o.value).filter(Boolean);
}

function mountParallel(listActions, chainId) {
    render(
        <MessagingProvider shell="web" messaging={messagingWith(listActions, chainId)}>
            <ParallelComposer
                walletId="wallet-1"
                onBack={() => {}}
                initialRows={[{ chainId, action: '', params: {} }]}
            />
        </MessagingProvider>,
    );
}

function mountBatch(listActions) {
    render(
        <MessagingProvider shell="web" messaging={messagingWith(listActions, BTC)}>
            <BatchComposerForm walletId="wallet-1" onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('AUTHORABLE_ACTIONS', () => {
    it('is exactly the union of COMMON_ACTIONS and BTC_EXCLUSIVE_ACTIONS, sorted', () => {
        const union = [...new Set([...COMMON_ACTIONS, ...BTC_EXCLUSIVE_ACTIONS])].sort();
        expect([...AUTHORABLE_ACTIONS]).toEqual(union);
        expect(Object.isFrozen(AUTHORABLE_ACTIONS)).toBe(true);
    });
});

describe('ParallelComposer fallback action list', () => {
    it('offers every authorable action on a Bitcoin row when listActions rejects', async () => {
        mountParallel(vi.fn(async () => { throw new Error('sdk down'); }), BTC);
        expect(await actionOptions()).toEqual([...AUTHORABLE_ACTIONS]);
    });

    it('offers every authorable action on a Bitcoin row when listActions resolves empty', async () => {
        mountParallel(vi.fn(async () => []), BTC);
        expect(await actionOptions()).toEqual([...AUTHORABLE_ACTIONS]);
    });

    it('still drops the Bitcoin-only actions on a Litecoin row', async () => {
        mountParallel(vi.fn(async () => { throw new Error('sdk down'); }), LTC);
        const options = await actionOptions();
        for (const btcOnly of BTC_EXCLUSIVE_ACTIONS) expect(options).not.toContain(btcOnly);
        expect(options).toEqual([...COMMON_ACTIONS].sort());
    });
});

describe('BatchComposerForm fallback action list', () => {
    it('offers every authorable action except BATCH and FILE when listActions rejects', async () => {
        mountBatch(vi.fn(async () => { throw new Error('sdk down'); }));
        const expected = AUTHORABLE_ACTIONS.filter((a) => a !== 'BATCH' && a !== 'FILE');
        expect(await actionOptions()).toEqual(expected);
    });
});
