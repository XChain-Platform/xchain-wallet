// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AdvancedActionsForm } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import { AttachContentForm } from '../../../packages/core/src/shared/routes/AttachContentForm.jsx';
import { LinkForm } from '../../../packages/core/src/shared/routes/LinkForm.jsx';
import { PublishFileForm } from '../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { SignMessageForm } from '../../../packages/core/src/shared/routes/SignMessageForm.jsx';

const BTC = 'bitcoin-mainnet';
const LTC = 'litecoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'btc-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const LTC_ADDRESS = Object.freeze({
    ...ADDRESS,
    id: 'ltc-0',
    address: 'ltc1qexampleexampleexampleexampleexamplex',
});

function messagingFor() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [ADDRESS],
            [LTC]: [LTC_ADDRESS],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [BTC]: { id: ADDRESS.id },
            [LTC]: { id: LTC_ADDRESS.id },
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listActions: vi.fn().mockResolvedValue(['SEND']),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 9 }),
        getOwnedTokens: vi.fn().mockResolvedValue([]),
        getActionByIndex: vi.fn().mockResolvedValue(null),
        signMessageRequest: vi.fn(),
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue({});
        },
    });
}

function mount(Form, props = {}) {
    const messaging = messagingFor();
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(Form, { walletId: 'w', onBack() {}, ...props }),
    ));
    return messaging;
}

async function press(name) {
    const button = await screen.findByRole('button', { name });
    await waitFor(() => expect(button.disabled).toBe(false));
    fireEvent.click(button);
}

// A form loads its source address after the first render, so on a busy
// machine an early press reports the missing source instead. Press until
// the message the test is about appears.
async function pressUntil(name, text) {
    await waitFor(async () => {
        await press(name);
        expect(screen.getByRole('alert').textContent).toContain(text);
    });
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('action form validation feedback', () => {
    it('AdvancedActionsForm explains that an action is required', async () => {
        mount(AdvancedActionsForm);

        await pressUntil('Sign action', 'Pick an action.');
    });

    it('AttachContentForm explains that a file is required', async () => {
        mount(AttachContentForm, { chainId: BTC, tick: 'ART', issuerAddress: ADDRESS.address });

        await pressUntil('Attach artwork', 'Pick a file first.');
    });

    it('PublishFileForm explains that a file is required', async () => {
        mount(PublishFileForm);

        await pressUntil('Publish file', 'Pick a file first.');
    });

    it('LinkForm explains that both action indices are required', async () => {
        mount(LinkForm);

        await pressUntil('Link actions', 'Provide both action indices before reviewing.');
    });

    it('SignMessageForm explains that a message is required', async () => {
        mount(SignMessageForm);

        await pressUntil('Sign message', 'Type a message to sign.');
    });
});
