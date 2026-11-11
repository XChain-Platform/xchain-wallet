// Copyright 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { AdvancedActionsForm } from '../../../packages/core/src/shared/routes/AdvancedActionsForm.jsx';
import buttonStyles from '../../../packages/core/src/ui/Button.module.css';

const BTC = 'bitcoin-mainnet';
const FROM = {
    id: 'bc-0',
    address: 'bc1qadvancedrulingsaddress00000000000000000',
    publicKey: '02'.padEnd(66, 'a'),
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};

afterEach(() => cleanup());

function advancedMessaging() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({ [BTC]: [FROM] }),
        getActiveAddresses: vi.fn().mockResolvedValue({ [BTC]: FROM }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: false }),
        listActions: vi.fn().mockResolvedValue(['BATCH', 'BROADCAST']),
        getActionFormats: vi.fn(({ action }) => Promise.resolve(action === 'BROADCAST'
            ? {
                0: 'VERSION|MESSAGE|...ITEM',
                1: 'VERSION|MESSAGE|...ITEM|MEMO',
            }
            : { 0: 'VERSION|...COMMAND' })),
        getActionFields: vi.fn(({ action }) => Promise.resolve(action === 'BROADCAST'
            ? ['VERSION', 'MESSAGE', '...ITEM']
            : ['VERSION', '...COMMAND'])),
        quoteProtocolFee: vi.fn().mockResolvedValue(null),
    };
    return new Proxy(target, {
        get: (value, prop) => (prop in value ? value[prop] : () => Promise.resolve({ rows: [] })),
        has: (value, prop) => prop in value,
    });
}

function mount() {
    render(
        <MessagingProvider shell="web" messaging={advancedMessaging()}>
            <AdvancedActionsForm walletId="w" onBack={() => {}} />
        </MessagingProvider>,
    );
}

function expectHelp(label, copy) {
    const trigger = screen.getByRole('button', { name: `About ${label}` });
    fireEvent.click(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent(copy);
    fireEvent.pointerDown(document.body);
}

describe('Advanced action operator rulings', () => {
    it('explains the source, purpose, format, and each raw SDK field on its label line', async () => {
        mount();

        const picker = await screen.findByLabelText('Action', { selector: 'select' });
        await screen.findByRole('option', { name: /BROADCAST/ });
        await screen.findByRole('button', { name: 'About From' });
        expectHelp(
            'From',
            'The address that signs and pays for this action. Tap the icon to pick another of your addresses.',
        );
        expectHelp(
            'Action',
            'Pick any XChain action to compose it from its raw fields. Actions marked (dedicated form available) also have a guided form, which is easier to use.',
        );

        fireEvent.change(picker, { target: { value: 'BROADCAST' } });
        await screen.findByLabelText('MESSAGE');

        expectHelp(
            'Format version',
            'Choose the raw SDK format version for this action. Auto-select lets the SDK choose a compatible version from the fields you provide.',
        );
        expectHelp('MESSAGE', 'Raw value for MESSAGE, sent as text.');
        expectHelp(
            'ITEM',
            'Raw values for ITEM, sent as a list. Enter one value per line or separate values with commas.',
        );
        expect(screen.queryByText(/one per line or comma-separated/)).toBeNull();
    });

    it('uses an icon-bearing green Sign action control', async () => {
        mount();

        await screen.findByLabelText('Action', { selector: 'select' });
        const submit = screen.getByRole('button', { name: 'Sign action' });
        expect(submit).toHaveClass(buttonStyles.success);
        expect(submit.querySelector('svg')).toBeTruthy();
    });

    it('shows only Network fee for a free action and the Fees card for a fee-path action', async () => {
        mount();

        const picker = await screen.findByLabelText('Action', { selector: 'select' });
        await screen.findByRole('option', { name: /BROADCAST/ });
        fireEvent.change(picker, { target: { value: 'BROADCAST' } });
        await screen.findByLabelText('MESSAGE');
        expect(screen.getByRole('slider', { name: 'Network fee' })).toBeInTheDocument();
        expect(document.querySelector('[data-fees-card]')).toBeNull();
        expect(screen.queryByText('Protocol fee')).toBeNull();

        fireEvent.change(picker, { target: { value: 'BATCH' } });
        await waitFor(() => expect(document.querySelector('[data-fees-card]')).toBeTruthy());
        expect(screen.getByRole('slider', { name: 'Network fee' })).toBeInTheDocument();
        expect(screen.getByText('Protocol fee')).toBeInTheDocument();
    });

    it('declares icons on every form-owned action button', () => {
        const source = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/AdvancedActionsForm.jsx',
        ), 'utf8');

        expect(source).toMatch(/variant="success" icon=\{<Icon\.CheckIcon \/>\} onClick=\{onBack\}>Done/);
        expect(source).toMatch(/variant="success"\s+icon=\{isWatcherMode \? <Icon\.DownloadIcon \/> : <Icon\.KeyIcon \/>\}/);
        expect(source).toMatch(/variant="success"\s+icon=\{singleEncode \? <Icon\.KeyIcon \/> : <Icon\.ForwardIcon \/>\}/);
    });
});
