// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Pressing Create Poll with required fields empty outlines each one in red
// with its own line, opens the section that holds it (Poll, Voting) on every
// press, puts the cursor in the first one, and clears a field's mark as soon
// as it is filled. The form opens on From, then the Poll section with no
// separate heading above it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { CreatePollForm } from '../../../packages/core/src/shared/routes/CreatePollForm.jsx';
import { resetBackStackForTests } from '../../../packages/core/src/ui/backStack.js';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { __clearTokenInfoCache } from '../../../packages/core/src/shared/hooks/useTokenInfo.js';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = Object.freeze({
    id: 'address-1',
    address: 'bc1qdevmock01aabbcc',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingWith() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [CHAIN]: { id: ADDRESS.id } }),
        getSettings: vi.fn().mockResolvedValue({ activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getChainTipBlockTime: vi.fn().mockResolvedValue({ blockTime: 0 }),
        composeVoteForConfirm: vi.fn().mockResolvedValue({ psbt: '00', encoding: 'psbt' }),
    };
    return new Proxy(target, {
        get(object, property) {
            if (property in object) return object[property];
            if (typeof property !== 'string') return undefined;
            return vi.fn().mockResolvedValue(null);
        },
    });
}

beforeEach(() => {
    resetBackStackForTests();
    resetWalletModes();
    __clearTokenInfoCache();
    publishWalletModes({ activeWalletId: 'wallet-1' });
});
afterEach(cleanup);

async function mount() {
    const messaging = messagingWith();
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        React.createElement(CreatePollForm, { walletId: 'wallet-1', chainId: CHAIN, onBack() {} }),
    ));
    await screen.findByLabelText('Question');
    // Wrapped: the Proxy answers `then`, so returning it bare from an
    // async function would make the await wait forever.
    return { messaging };
}

function sectionToggle(title) {
    return screen.getByRole('button', { name: new RegExp(`^${title}\\b`) });
}

async function pressCreate() {
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Create Poll' }));
        await new Promise((resolve) => { setTimeout(resolve, 5); });
    });
}

describe('Create poll: red required fields on press', () => {
    it('opens on From and the Poll section, with no Poll details heading', async () => {
        await mount();
        expect(screen.queryByText(/Poll details/i)).toBeNull();
        const titles = [...document.querySelectorAll('[data-form-section-title]')].map((el) => el.textContent);
        expect(titles.slice(0, 2)).toEqual(['From', 'Poll']);
        // The shared Advanced section sits directly above Speed and Fees.
        expect(titles.slice(-2)).toEqual(['Advanced', 'Speed and Fees']);
        expect(sectionToggle('Poll')).toHaveAttribute('aria-expanded', 'true');
        expect(sectionToggle('Voting')).toHaveAttribute('aria-expanded', 'false');
    });

    it('marks every empty required field, opens Voting, and focuses the first', async () => {
        const { messaging } = await mount();
        await pressCreate();

        expect(screen.getByText('Pick the token whose holders vote on this poll.')).toBeInTheDocument();
        expect(screen.getAllByText('Enter the question voters will answer.').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Enter this option.')).toHaveLength(2);
        expect(screen.getByText('Enter the block the poll closes at.')).toBeInTheDocument();
        expect(screen.getByLabelText('Question')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Option 1')).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Closes at block')).toHaveAttribute('aria-invalid', 'true');
        // The section holding the red closing block opened by itself.
        expect(sectionToggle('Voting')).toHaveAttribute('aria-expanded', 'true');
        // The cursor sits in the first red field, the token picker.
        expect(document.activeElement?.id).toBe('poll-token');
        expect(messaging.composeVoteForConfirm).not.toHaveBeenCalled();
    });

    it('reopens a closed Voting section on the next press while its field is still red', async () => {
        await mount();
        await pressCreate();
        expect(sectionToggle('Voting')).toHaveAttribute('aria-expanded', 'true');
        fireEvent.click(sectionToggle('Voting'));
        expect(sectionToggle('Voting')).toHaveAttribute('aria-expanded', 'false');
        await pressCreate();
        expect(sectionToggle('Voting')).toHaveAttribute('aria-expanded', 'true');
    });

    it('puts the cursor in the closing block, opening Voting, when it is the first red field', async () => {
        render(React.createElement(
            MessagingProvider,
            { shell: 'web', messaging: messagingWith() },
            React.createElement(CreatePollForm, { walletId: 'wallet-1', chainId: CHAIN, presetTick: 'VOTE', onBack() {} }),
        ));
        await screen.findByLabelText('Question');
        fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Ship it?' } });
        fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Yes' } });
        fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'No' } });
        expect(sectionToggle('Voting')).toHaveAttribute('aria-expanded', 'false');
        await pressCreate();
        expect(sectionToggle('Voting')).toHaveAttribute('aria-expanded', 'true');
        expect(document.activeElement?.id).toBe('poll-end-block');
        expect(screen.getByLabelText('Closes at block')).toHaveAttribute('aria-invalid', 'true');
    });

    it('clears a field as soon as it is filled', async () => {
        await mount();
        await pressCreate();
        fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Ship it?' } });
        expect(screen.getByLabelText('Question')).not.toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Yes' } });
        expect(screen.getByLabelText('Option 1')).not.toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByLabelText('Option 2')).toHaveAttribute('aria-invalid', 'true');
        fireEvent.change(screen.getByLabelText('Closes at block'), { target: { value: '244' } });
        expect(screen.getByLabelText('Closes at block')).not.toHaveAttribute('aria-invalid', 'true');
    });
});
