// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import {
    ACTION_ENTRY_DEFS,
    ACTION_GROUPS,
    buildActionEntries,
} from '../../../packages/core/src/shared/actionEntries.js';
import { ActionsMenu } from '../../../packages/core/src/shared/routes/ActionsMenu.jsx';

afterEach(() => cleanup());

function mount(entries, walletMode = 'full') {
    const messaging = {
        getSettings: vi.fn(async () => ({ walletMode })),
    };
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ActionsMenu entries={entries} onBack={() => {}} />
        </MessagingProvider>,
    );
}

describe('ActionsMenu navigation semantics', () => {
    it('assigns every catalogue entry to exactly one stable section', () => {
        const groupedIds = ACTION_GROUPS.flatMap((group) => group.entryIds);
        expect(groupedIds).toHaveLength(ACTION_ENTRY_DEFS.length);
        expect(new Set(groupedIds).size).toBe(groupedIds.length);
        expect(new Set(groupedIds)).toEqual(new Set(ACTION_ENTRY_DEFS.map((entry) => entry.id)));
    });

    it('renders ordered, labelled sections as semantic lists', () => {
        const entries = buildActionEntries({
            onIssue: vi.fn(),
            onSwap: vi.fn(),
            onPublishFile: vi.fn(),
            onMultisigCreate: vi.fn(),
            onSignPsbt: vi.fn(),
        });
        mount(entries);

        expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
            'Tokens',
            'Markets',
            'Publishing and multi-chain',
            'Communities and shared wallets',
            'Wallet tools',
        ]);
        for (const heading of screen.getAllByRole('heading', { level: 2 })) {
            const section = heading.closest('section');
            expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
            expect(within(section).getAllByRole('listitem')).toHaveLength(1);
        }
    });

    it('keeps explained unavailable actions focusable but inert, and hides dead entries', () => {
        const unavailable = vi.fn();
        mount([
            {
                id: 'unavailable',
                label: 'Unavailable action',
                description: 'Needs a supported chain.',
                disabled: true,
                disabledReason: 'Add a Bitcoin address to this wallet.',
                onSelect: unavailable,
            },
            { id: 'dead', label: 'Dead action' },
        ]);

        const button = screen.getByRole('button', { name: /unavailable action/i });
        button.focus();
        expect(document.activeElement).toBe(button);
        expect(button.getAttribute('aria-disabled')).toBe('true');
        const describedBy = button.getAttribute('aria-describedby').split(' ');
        expect(describedBy.map((id) => document.getElementById(id).textContent)).toEqual([
            'Needs a supported chain.',
            'Unavailable: Add a Bitcoin address to this wallet.',
        ]);
        fireEvent.click(button);
        expect(unavailable).not.toHaveBeenCalled();
        expect(screen.queryByText('Dead action')).toBeNull();
    });

    it('limits a signer-mode deep link to actions that can sign or verify', async () => {
        mount(buildActionEntries({
            onIssue: vi.fn(),
            onSignMessage: vi.fn(),
            onVerifySignature: vi.fn(),
            onSignPsbt: vi.fn(),
            onAdvanced: vi.fn(),
        }), 'signer');

        await waitFor(() => expect(screen.queryByText('Issue token')).toBeNull());
        expect(screen.queryByText('Advanced action')).toBeNull();
        expect(screen.getByText('Sign message')).toBeTruthy();
        expect(screen.getByText('Verify signature')).toBeTruthy();
        expect(screen.getByText('Sign transaction')).toBeTruthy();
    });
});
