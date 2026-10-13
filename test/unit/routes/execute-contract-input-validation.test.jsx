// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { ExecuteContractForm } from '../../../packages/core/src/shared/routes/ExecuteContractForm.jsx';
import contractStyles from '../../../packages/core/src/shared/routes/ContractScreens.module.css';

const CHAIN = 'bitcoin-mainnet';
const ADDRESS = {
    id: 'addr-1',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02ab',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
};
const contractCss = readFileSync(
    'packages/core/src/shared/routes/ContractScreens.module.css',
    'utf8',
);

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return contractCss.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] || '';
}

function mount(walletMode = 'full', abiParamName = 'config') {
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode }),
        signerReady: () => Promise.resolve({ ready: false }),
        getContractByActionIndex: () => Promise.resolve({
            data: {
                abi: {
                    version: 1,
                    methods: {
                        configure: {
                            params: [
                                { name: abiParamName, type: 'json' },
                                { name: 'limit', type: 'amount' },
                            ],
                        },
                    },
                },
            },
        }),
    };
    const messaging = new Proxy(target, {
        get(object, property) {
            return property in object ? object[property] : () => Promise.resolve({});
        },
    });
    return render(
        <MessagingProvider shell="web" messaging={messaging}>
            <ExecuteContractForm
                walletId="w"
                chainId={CHAIN}
                contractActionIndex="49"
                onBack={() => {}}
            />
        </MessagingProvider>,
    );
}

afterEach(() => cleanup());

describe('ExecuteContractForm argument validation', () => {
    it.each([320, 360])('contains a long ABI label and hex value at %ipx', async (viewportWidth) => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
        const paramName = 'configuration_parameter_without_any_natural_break_points';

        try {
            mount('full', paramName);
            const input = await screen.findByLabelText(`${paramName} (json)`);
            const hex = `0x${'ab'.repeat(128)}`;
            fireEvent.change(input, { target: { value: hex } });

            expect(input).toHaveValue(hex);
            expect(input).toHaveClass(contractStyles.monospaceInput);
            expect(input.closest(`.${contractStyles.abiField}`)).not.toBeNull();
            expect(rule('.abiField label')).toMatch(/overflow-wrap:\s*anywhere/);
            expect(rule('.monospaceInput')).toMatch(/overflow-x:\s*auto/);
            expect(rule('.monospaceInput')).toMatch(/white-space:\s*nowrap/);
            expect(rule('.monospaceValue')).toMatch(/overflow-wrap:\s*anywhere/);
            expect(rule('.codeSource')).toMatch(/overflow:\s*auto/);
            expect(rule('.toolActions')).toMatch(/flex-wrap:\s*wrap/);
            expect(rule('.contractRow')).toMatch(/width:\s*100%/);
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });

    it('shows invalid declared JSON before compose', async () => {
        mount();
        const input = await screen.findByLabelText('config (json)');
        fireEvent.change(input, { target: { value: '{"missing":' } });

        expect(await screen.findByText(/config contains invalid JSON:/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Call contract' })).toBeDisabled();
    });

    it('shows blank positional arguments in manual mode', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Enter method manually' }));
        fireEvent.change(screen.getByLabelText('Params (optional)'), { target: { value: 'first||third' } });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(
                'Arguments cannot be blank between "|" separators.',
            );
        });
    });

    it('returns from watcher review to the populated form', async () => {
        mount('watcher');
        fireEvent.change(await screen.findByLabelText('config (json)'), {
            target: { value: '{"enabled":true}' },
        });
        fireEvent.change(screen.getByLabelText('limit (amount)'), { target: { value: '2.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByRole('heading', { name: 'Review contract call' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));

        expect(await screen.findByRole('form', { name: 'Call contract' })).toBeInTheDocument();
        expect(screen.getByLabelText('config (json)')).toHaveValue('{"enabled":true}');
        expect(screen.getByLabelText('limit (amount)')).toHaveValue('2.5');
    });
});
