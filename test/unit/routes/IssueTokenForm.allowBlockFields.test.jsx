// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// G114: Issue Token's "Allow and block lists" section is two picker fields,
// Allow list and Block list. Each reads the chosen list's name, or "None set"
// when empty, with the list icon on its right; tapping it opens the list
// picker, and its clear action sets it back to none.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

vi.mock('../../../packages/core/src/shared/components/ListPickerScreen.jsx', async () => {
    const ReactModule = await import('react');
    return {
        ListPickerScreen({ title, onSelect, onBack }) {
            const allow = /allow/i.test(title);
            return ReactModule.createElement(
                'div',
                { 'data-testid': 'list-picker' },
                ReactModule.createElement('h1', null, title),
                ReactModule.createElement(
                    'button',
                    {
                        type: 'button',
                        onClick: () => onSelect(allow
                            ? { actionIndex: '61', type: '2', memberCount: 3, name: 'Partners' }
                            : { actionIndex: '62', type: '2', memberCount: 2, name: 'Sanctioned' }),
                    },
                    'Pick named list',
                ),
                ReactModule.createElement(
                    'button',
                    { type: 'button', onClick: () => onSelect({ actionIndex: '70', type: '2', memberCount: null }) },
                    'Pick unnamed list',
                ),
                ReactModule.createElement('button', { type: 'button', onClick: onBack }, 'Back'),
            );
        },
    };
});

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import tokenFieldStyles from '../../../packages/core/src/shared/components/TokenField.module.css';

const ADDRESS = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

function mount() {
    const composeForConfirm = vi.fn().mockResolvedValue({
        psbt: 'aa00', encoding: 'psbt', actionString: 'ACT', version: 0,
    });
    const messaging = {
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-mainnet': [ADDRESS] }),
        getActiveAddresses: vi.fn().mockResolvedValue({}),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listContacts: vi.fn().mockResolvedValue([]),
        composeForConfirm,
        preflight: vi.fn().mockResolvedValue({ verdict: 'pass', findings: [] }),
    };
    const mounted = render(
        <MessagingProvider shell="web" messaging={messaging}>
            <IssueTokenForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
    return { ...mounted, composeForConfirm };
}

function listsSection(container) {
    return container.querySelector('[data-form-section="lists"]');
}

async function openLists(container) {
    await screen.findByLabelText('Ticker');
    fireEvent.click(listsSection(container).querySelector('button[aria-expanded]'));
}

afterEach(() => cleanup());

describe('Issue Token Allow list and Block list fields (G114)', () => {
    it('shows two picker fields that read None set, each with the list icon on its right', async () => {
        const { container } = mount();
        await openLists(container);
        const section = listsSection(container);

        const allow = within(section).getByRole('button', { name: 'Allow list: None set' });
        const block = within(section).getByRole('button', { name: 'Block list: None set' });
        for (const field of [allow, block]) {
            // The standard picker field: TokenField's control chrome, the
            // empty text, and the list icon as the control's last child.
            expect(field.className).toContain(tokenFieldStyles.control);
            expect(field).toHaveTextContent('None set');
            const trailing = field.lastElementChild;
            expect(trailing.className).toContain(tokenFieldStyles.caret);
            expect(trailing.querySelector('svg')).toBeTruthy();
        }

        // The old design is gone: no typed list number, no Choose or
        // Change buttons, and no clear action while nothing is set.
        expect(within(section).queryByRole('textbox')).toBeNull();
        for (const name of [/Choose allow-list/i, /Change allow-list/i, /Choose block-list/i, /Change block-list/i]) {
            expect(within(section).queryByRole('button', { name })).toBeNull();
        }
        expect(within(section).queryByRole('button', { name: 'Remove allow-list' })).toBeNull();
        expect(within(section).queryByRole('button', { name: 'Remove block-list' })).toBeNull();
    });

    it('opens the list picker from each field and then reads the chosen name', async () => {
        const { container, composeForConfirm } = mount();
        await openLists(container);

        fireEvent.click(screen.getByRole('button', { name: 'Allow list: None set' }));
        expect(screen.getByRole('heading', { name: 'Select Allow List' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Pick named list' }));
        const allow = await screen.findByRole('button', { name: 'Allow list: Partners (List #61)' });
        expect(allow).toHaveTextContent('Partners (List #61)');

        fireEvent.click(screen.getByRole('button', { name: 'Block list: None set' }));
        expect(screen.getByRole('heading', { name: 'Select Block List' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Pick named list' }));
        expect(await screen.findByRole('button', { name: 'Block list: Sanctioned (List #62)' })).toBeInTheDocument();

        // Closed, the section summary says the lists are set, and the ISSUE
        // carries the picked indexes exactly as before.
        const header = listsSection(container).querySelector('button[aria-expanded]');
        fireEvent.click(header);
        expect(header).toHaveTextContent(/Set$/);
        fireEvent.change(screen.getByLabelText('Ticker'), { target: { value: 'GATED' } });
        fireEvent.click(screen.getByRole('button', { name: 'Issue Token' }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composeForConfirm.mock.calls[0][0].actionData.params).toMatchObject({
            ALLOW_LIST: '61',
            BLOCK_LIST: '62',
        });
    });

    it('changes a chosen list from the field and clears it back to None set', async () => {
        const { container } = mount();
        await openLists(container);

        fireEvent.click(screen.getByRole('button', { name: 'Allow list: None set' }));
        fireEvent.click(screen.getByRole('button', { name: 'Pick named list' }));
        const chosen = await screen.findByRole('button', { name: 'Allow list: Partners (List #61)' });

        // Change: the same field reopens the picker; an unnamed list reads its number.
        fireEvent.click(chosen);
        fireEvent.click(screen.getByRole('button', { name: 'Pick unnamed list' }));
        expect(await screen.findByRole('button', { name: 'Allow list: List #70' })).toBeInTheDocument();

        // Clear: the in-field clear action sets the field back to none.
        fireEvent.click(screen.getByRole('button', { name: 'Remove allow-list' }));
        expect(screen.getByRole('button', { name: 'Allow list: None set' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Remove allow-list' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Block list: None set' })).toBeInTheDocument();
    });

    it('keeps the form state when the picker is left with Back', async () => {
        const { container } = mount();
        await openLists(container);
        fireEvent.click(screen.getByRole('button', { name: 'Block list: None set' }));
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        expect(await screen.findByRole('button', { name: 'Block list: None set' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Allow list: None set' })).toBeInTheDocument();
    });
});
