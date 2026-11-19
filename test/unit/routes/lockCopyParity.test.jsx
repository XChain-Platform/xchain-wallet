// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One wording for the seven token locks: the Issue form's rows read from the
// shared list the wizard and Lock settings render, so they cannot drift.

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { IssueTokenForm } from '../../../packages/core/src/shared/routes/IssueTokenForm.jsx';
import { ISSUE_LOCKS } from '../../../packages/core/src/shared/routes/issueLocks.js';
import { LOCK_FLAGS } from '../../../packages/core/src/shared/utils/issueAdvancedFields.js';

const APPROVED = [
    ['LOCK_MAX_SUPPLY', 'Max supply', 'No one can raise the supply cap'],
    ['LOCK_MAX_MINT', 'Max mint per transaction', 'That limit never changes'],
    ['LOCK_MINT', 'Minting', 'Blocks the public MINT'],
    ['LOCK_MINT_SUPPLY', 'Mint supply', "Blocks the owner's MINT_SUPPLY through ISSUE"],
    ['LOCK_DESCRIPTION', 'Description', 'Description can never change'],
    ['LOCK_SLEEP', 'Pause', 'The token can never be paused'],
    [
        'LOCK_CALLBACK',
        'Callback',
        'No one can ever run a callback on this token again, and its block, token and amount never change',
    ],
];

const ADDRESS = Object.freeze({
    id: 'issue-source',
    address: 'bc1qlockcopyparity',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'software-signer',
});

afterEach(() => {
    cleanup();
    localStorage.clear();
});

describe('lock copy parity', () => {
    it('shared list carries the approved label and text for every lock field', () => {
        expect(LOCK_FLAGS.map((f) => [f.field, f.label, f.hint])).toEqual(APPROVED);
    });

    it('Issue lock rows show the same label and text as the shared list, by field', () => {
        expect(ISSUE_LOCKS.map((l) => l.key)).toEqual([
            'maxSupply', 'maxMint', 'minting', 'mintSupply', 'description', 'pause', 'callback',
        ]);
        for (const lock of ISSUE_LOCKS) {
            const flag = LOCK_FLAGS.find((f) => f.field === lock.field);
            expect(flag, lock.field).toBeTruthy();
            expect(lock.label).toBe(flag.label);
            expect(lock.description).toBe(flag.hint);
        }
        expect(ISSUE_LOCKS).toHaveLength(LOCK_FLAGS.length);
    });

    it('Issue form Locks section renders the shared label and text', async () => {
        const messaging = new Proxy({
            getAddressesByChain: vi.fn(async () => ({ 'bitcoin-mainnet': [ADDRESS] })),
            composeForConfirm: vi.fn(async () => ({})),
            getActiveAddresses: vi.fn(async () => ({})),
            getSettings: vi.fn(async () => ({ walletMode: 'full' })),
            signerReady: vi.fn(async () => ({ ready: true })),
        }, {
            get(target, property) {
                if (property in target) return target[property];
                return vi.fn(async () => []);
            },
        });
        render(
            <MessagingProvider shell="web" messaging={messaging}>
                <IssueTokenForm walletId="wallet" onBack={() => {}} />
            </MessagingProvider>,
        );
        await screen.findByLabelText('Ticker');
        fireEvent.click(screen.getByRole('button', { name: /^Locks/ }));
        for (const [, label, text] of APPROVED) {
            expect(screen.getByRole('switch', { name: label })).toBeInTheDocument();
            expect(screen.getByText(text)).toBeInTheDocument();
        }
    });
});
