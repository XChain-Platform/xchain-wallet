// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G114: the Open a market form's allow and block lists are picker fields (the
// shared ListField) that read "None set" when empty and show the picked list's
// name, with "List #N" for a list that has none, never a typed list number.
//
// Queries go through `container`: this form renders a large tree, and a
// failed role lookup spends minutes building testing-library's role dump.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act as domAct, cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreateBetFeedForm } from '../../../packages/core/src/shared/routes/CreateBetFeedForm.jsx';
import * as walletModes from '../../../packages/core/src/shared/hooks/useWalletMode.js';

vi.mock('../../../packages/core/src/shared/components/ListPickerScreen.jsx', () => ({
    ListPickerScreen: ({ title, onSelect }) => (
        <button
            type="button"
            onClick={() => onSelect({ actionIndex: '7', name: title.includes('Allow') ? 'Team wallets' : undefined })}
        >
            List row {title}
        </button>
    ),
}));

const CHAIN = 'bitcoin-mainnet';
const HD_ADDRESS = Object.freeze({
    id: 'addr-hd-0', address: 'bc1qexampleexampleexampleexampleexampleex', publicKey: '02aabbcc', derivationPath: "m/84'/0'/0'/0/0", source: 'hd', signerId: 'signer-1',
});

afterEach(() => {
    cleanup();
    globalThis.localStorage?.clear();
    walletModes.resetWalletModes?.();
});

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function messaging() {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [HD_ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: true }),
        getSignerStatus: () => Promise.resolve({ status: 'unlocked' }),
        betProjectFeedCreateFee: () => Promise.resolve({ durationSeconds: 3801600, days: 44, billableDays: 0, free: true, fee: '0.00000000' }),
    };
    return new Proxy(target, { get(t, prop) { return prop in t ? t[prop] : () => Promise.resolve({}); }, has: (t, prop) => prop in t });
}

async function mount() {
    walletModes.publishWalletModes?.({ wallets: [{ id: 'w', walletMode: 'full' }], activeWalletId: 'w' });
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging()}>
                <CreateBetFeedForm walletId="w" onBack={() => {}} chainId={CHAIN} presetTick="PEPECREATURE" />
            </MessagingProvider>,
        );
        await drain();
    });
    await domAct(async () => {
        fireEvent.click([...utils.container.querySelectorAll('button')].find((b) => /^Full$/.test(b.textContent.trim())));
        await drain();
    });
    return utils;
}

const field = (utils, name) => utils.container.querySelector(`button[aria-label="${name}"]`);
const click = async (el) => { await domAct(async () => { fireEvent.click(el); await drain(); }); };
const byText = (utils, text) => [...utils.container.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

describe('Open a market form list fields', () => {
    it('reads None set when empty, then shows the list name or List #N once picked', async () => {
        const utils = await mount();
        expect(utils.container.querySelector('input[inputmode="numeric"][aria-label*="Addresses"]')).toBeNull();

        const allow = field(utils, 'Only These Addresses May Buy: None set');
        const block = field(utils, 'These Addresses May Not Buy: None set');
        expect(allow, 'allow list is a picker field reading None set').toBeTruthy();
        expect(block, 'block list is a picker field reading None set').toBeTruthy();
        expect(allow.querySelector('svg')).toBeTruthy();

        await click(allow);
        await click(byText(utils, 'List row Choose Allow-List'));
        expect(field(utils, 'Only These Addresses May Buy: Team wallets (List #7)'), 'the picked list shows by name').toBeTruthy();

        await click(field(utils, 'These Addresses May Not Buy: None set'));
        await click(byText(utils, 'List row Choose Block-List'));
        expect(field(utils, 'These Addresses May Not Buy: List #7'), 'an unnamed list reads List #N').toBeTruthy();

        const clear = [...utils.container.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Clear allow list');
        await click(clear);
        expect(field(utils, 'Only These Addresses May Buy: None set')).toBeTruthy();
    });
});
