// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MessagingProvider } from '../../../../packages/core/src/shared/MessagingProvider.jsx';
import { BroadcastForm } from '../../../../packages/core/src/shared/routes/BroadcastForm.jsx';
import { CallbackForm } from '../../../../packages/core/src/shared/routes/CallbackForm.jsx';
import { GatedPublishForm } from '../../../../packages/core/src/shared/routes/GatedPublishForm.jsx';
import { LinkForm } from '../../../../packages/core/src/shared/routes/LinkForm.jsx';
import { PublishFileForm } from '../../../../packages/core/src/shared/routes/PublishFileForm.jsx';
import { actionParamsTextError } from '../../../../packages/core/src/shared/utils/actionTextSafety.js';
import {
    MAX_MEMO_LENGTH,
    memoLength,
    memoLengthError,
} from '../../../../packages/core/src/shared/utils/memoLimit.js';

const BTC = 'bitcoin-mainnet';
const DOGE = 'dogecoin-mainnet';
const REGTEST = 'bitcoin-regtest';
const SOURCE = Object.freeze({
    id: 'btc-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});
const DOGE_SOURCE = Object.freeze({
    ...SOURCE,
    id: 'doge-0',
    address: 'D8exampleexampleexampleexampleexample',
    derivationPath: "m/44'/3'/0'/0/0",
});

function messagingFor() {
    const target = {
        getAddressesByChain: vi.fn().mockResolvedValue({
            [BTC]: [SOURCE],
            [DOGE]: [DOGE_SOURCE],
            [REGTEST]: [SOURCE],
        }),
        getActiveAddresses: vi.fn().mockResolvedValue({
            [BTC]: { id: SOURCE.id },
            [DOGE]: { id: DOGE_SOURCE.id },
            [REGTEST]: { id: SOURCE.id },
        }),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full', activeNetwork: 'mainnet' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        getTokenInfo: vi.fn().mockResolvedValue({
            tick: 'CALLABLE',
            creator: SOURCE.address,
            callbackTick: 'XCHAIN',
            callbackAmount: '1',
            callbackBlock: '1',
            divisibility: 8,
        }),
        getGenesisForToken: vi.fn().mockResolvedValue({ action_index: 7 }),
        listGatedKeys: vi.fn().mockResolvedValue([]),
        tokenHolderSummary: vi.fn().mockResolvedValue({ recipientCount: 1, totalPayout: '1' }),
        getIndexerWatermark: vi.fn().mockResolvedValue({ watermark: 100 }),
        getActionByIndex: vi.fn().mockResolvedValue({ action: 'SEND', tick: 'JDOG', amount: '1' }),
    };
    return new Proxy(target, {
        get(value, prop) {
            if (prop in value) return value[prop];
            return vi.fn().mockResolvedValue([]);
        },
    });
}

function mount(Component, props = {}) {
    render(
        <MessagingProvider shell="web" messaging={messagingFor()}>
            <Component walletId="w" onBack={() => {}} {...props} />
        </MessagingProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('memo length units', () => {
    it('matches the compose boundary and counts UTF-16 units', () => {
        const overLimit = '😀'.repeat(300);
        const expected = 'Memo is 600 characters; the network accepts at most 250 characters.';

        expect(memoLength(overLimit)).toBe(600);
        expect(memoLengthError(overLimit)).toBe(expected);
        expect(actionParamsTextError({ action: 'TEST', params: { MEMO: overLimit } })).toBe(expected);
    });

    it('accepts 250 UTF-16 units regardless of encoded byte length', () => {
        expect(memoLengthError('😀'.repeat(125))).toBeNull();
        expect(memoLengthError('é'.repeat(250))).toBeNull();
    });
});

describe('shared Memo fields', () => {
    it('uses the shared optional state and network limit on every input', () => {
        const routesDir = join(process.cwd(), 'packages/core/src/shared/routes');
        const memoFields = readdirSync(routesDir)
            .filter((name) => name.endsWith('.jsx'))
            .flatMap((name) => {
                const source = readFileSync(join(routesDir, name), 'utf8');
                return [...source.matchAll(/<(?:Input|Textarea)\b[\s\S]*?\/>/g)]
                    .map(([field]) => ({ name, field }))
                    .filter(({ field }) => /label=(?:"Memo(?: \(optional\))?"|\{t\('send\.memo'\)\})/.test(field));
            });

        expect(memoFields.length).toBeGreaterThan(20);
        for (const { name, field } of memoFields) {
            expect(field, name).toMatch(/\boptional(?:\s|=)/);
            expect(field, name).toMatch(/maxLength=\{MAX_MEMO_LENGTH\}/);
        }
    });
});

describe.each([
    ['Publish file', PublishFileForm, {}],
    ['Gated publish', GatedPublishForm, {
        chainId: REGTEST,
        tick: 'GATE',
        issuerAddress: SOURCE.address,
    }],
])('%s Memo field', (_name, Component, props) => {
    it('shows one Optional pill and a UTF-16 counter at the network limit', async () => {
        mount(Component, props);
        const memo = await screen.findByRole('textbox', { name: 'Memo' });

        expect(memo).toHaveAttribute('maxlength', String(MAX_MEMO_LENGTH));
        expect(memo).toHaveAccessibleDescription(expect.stringMatching(/Optional/));
        expect(screen.getByText('0 / 250')).toBeInTheDocument();

        fireEvent.change(memo, { target: { value: 'hello' } });

        expect(screen.getByText('5 / 250')).toBeInTheDocument();
    });
});

describe.each([
    ['Link', LinkForm, {}],
    ['Callback', CallbackForm, {
        initialChainId: BTC,
        initialTick: 'CALLABLE',
        initialFromAddress: SOURCE.address,
    }],
])('%s Memo counter', (_name, Component, props) => {
    it('uses the same units as memo validation', async () => {
        mount(Component, props);
        const memo = await screen.findByRole('textbox', { name: 'Memo' });
        const value = '😀'.repeat(125);

        fireEvent.change(memo, { target: { value } });

        expect(memoLengthError(value)).toBeNull();
        expect(screen.getByText('250 / 250')).toBeInTheDocument();
    });
});

describe('Broadcast message counter', () => {
    it('uses the same UTF-16 units as its refusal', async () => {
        mount(BroadcastForm, { initialChainId: BTC });
        const message = await screen.findByRole('textbox', { name: 'Message' });
        const value = `${'😀'.repeat(125)}a`;

        fireEvent.change(message, { target: { value } });

        expect(screen.getByText('251 / 250')).toBeInTheDocument();
        expect(screen.getByText(
            'Message is 251 characters; the network accepts at most 250 characters.',
        )).toBeInTheDocument();
    });
});
