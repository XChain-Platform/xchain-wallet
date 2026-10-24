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
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    // A selector can appear in a shared group (the RTL isolation rule) and in
    // its own rule, so collect the declarations of every block it heads.
    return [...contractCss.matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`, 'g'))]
        .map((match) => match[1])
        .join('\n');
}

function mount(walletMode = 'full', abiParamName = 'config', overrides = {}, props = {}) {
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
        ...overrides,
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
                {...props}
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

        expect(await screen.findByText('config contains invalid JSON. Check the syntax and try again.'))
            .toBeInTheDocument();
        expect(screen.queryByText(/position|unexpected token|JSON\.parse/i)).toBeNull();
        const submit = screen.getByRole('button', { name: 'Call contract' });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        expect(await screen.findAllByText('config contains invalid JSON. Check the syntax and try again.')).not.toHaveLength(0);
    });

    it('shows the required method message before compose', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Enter method manually' }));
        fireEvent.change(screen.getByLabelText('Method'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Method name is required.');
    });

    it('refuses hostile method text before review', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Enter method manually' }));
        fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'pay\u202eout' } });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Method cannot contain text-direction control characters.');
        expect(screen.queryByRole('form', { name: /Review/ })).toBeNull();
    });

    it('rejects malformed declared addresses before compose', async () => {
        mount('full', 'recipient', {
            getContractByActionIndex: () => Promise.resolve({
                data: {
                    abi: {
                        version: 1,
                        methods: {
                            send: { params: [{ name: 'recipient', type: 'address' }] },
                        },
                    },
                },
            }),
        });
        fireEvent.change(await screen.findByLabelText('recipient (address)'), {
            target: { value: 'not-an-address' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));

        expect(await screen.findAllByText('recipient must be a valid address for Bitcoin.'))
            .not.toHaveLength(0);
    });

    it('rejects ABI amounts with more than eight decimal places before compose', async () => {
        mount();
        fireEvent.change(await screen.findByLabelText('config (json)'), {
            target: { value: '{}' },
        });
        fireEvent.change(screen.getByLabelText('limit (amount)'), {
            target: { value: '1.123456789' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));

        expect(await screen.findAllByText(/limit can have at most 8 decimal places/))
            .not.toHaveLength(0);
    });

    it('rejects wrong boolean types and negative amounts before compose', async () => {
        mount('full', 'enabled', {
            getContractByActionIndex: () => Promise.resolve({
                data: {
                    abi: {
                        version: 1,
                        methods: {
                            configure: {
                                params: [
                                    { name: 'enabled', type: 'bool' },
                                    { name: 'limit', type: 'amount' },
                                ],
                            },
                        },
                    },
                },
            }),
        });
        fireEvent.change(await screen.findByLabelText('enabled (bool)'), {
            target: { value: 'TRUE' },
        });
        fireEvent.change(screen.getByLabelText('limit (amount)'), { target: { value: '-1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));
        expect(await screen.findAllByText('enabled must be true or false.')).not.toHaveLength(0);

        fireEvent.change(screen.getByLabelText('enabled (bool)'), { target: { value: 'false' } });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));
        expect(await screen.findAllByText('limit must be a positive decimal amount.')).not.toHaveLength(0);
    });

    it('rejects a malformed contract ID before compose', async () => {
        mount('full', 'config', {}, { contractActionIndex: '0' });
        fireEvent.change(await screen.findByLabelText('config (json)'), {
            target: { value: '{}' },
        });
        fireEvent.change(screen.getByLabelText('limit (amount)'), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Contract ID must be a positive whole number.');
    });

    it('turns an encoder failure into plain copy on the form', async () => {
        const failure = new Error('no spendable UTXOs found for the funding address');
        failure.name = 'SDKEncoderError';
        failure.code = 'NO_UTXOS';
        mount('full', 'config', {
            composeForConfirm: () => Promise.reject(failure),
        });
        fireEvent.change(await screen.findByLabelText('config (json)'), {
            target: { value: '{}' },
        });
        fireEvent.change(screen.getByLabelText('limit (amount)'), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));

        expect(await screen.findByText(/This address needs BTC for the protocol fee/))
            .toBeInTheDocument();
        expect(screen.queryByText(/no spendable UTXOs/)).toBeNull();
    });

    it('shows blank positional arguments in manual mode', async () => {
        mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Enter method manually' }));
        fireEvent.change(screen.getByLabelText('Arguments (optional)'), { target: { value: 'first||third' } });
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

    it('shows undeclared deep-link arguments and composes the visible values exactly', async () => {
        const composeForConfirm = vi.fn(() => new Promise(() => {}));
        mount('full', 'config', { composeForConfirm }, {
            initialMethod: 'configure',
            initialParamsText: '{"safe":true}|9007199254740993|hidden',
        });

        expect(await screen.findByLabelText('Arguments (optional)'))
            .toHaveValue('{"safe":true}|9007199254740993|hidden');
        expect(screen.queryByLabelText('config (json)')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));
        await waitFor(() => expect(composeForConfirm).toHaveBeenCalledTimes(1));
        expect(composeForConfirm.mock.calls[0][0].actionData.params.PARAMS).toEqual([
            '{"safe":true}',
            '9007199254740993',
            'hidden',
        ]);
    });
});

describe('ExecuteContractForm tick arguments', () => {
    const tickAbi = () => ({
        getContractByActionIndex: () => Promise.resolve({
            data: {
                abi: {
                    version: 1,
                    methods: { claim: { params: [{ name: 'asset', type: 'tick' }] } },
                },
            },
        }),
    });

    it.each(['XCH AIN', 'A,B', 'A;B', '.A', 'A..B'])('rejects the ticker %j before compose', async (value) => {
        mount('full', 'config', tickAbi());
        fireEvent.change(await screen.findByLabelText('asset (tick)'), { target: { value } });
        fireEvent.click(screen.getByRole('button', { name: 'Call contract' }));

        expect((await screen.findAllByText(/^asset /)).length).toBeGreaterThan(0);
        expect(screen.queryByRole('heading', { name: 'Review contract call' })).toBeNull();
    });

    it.each(['XCHAIN', 'Mixed-Case.sub', '^123'])('accepts the ticker %j', async (value) => {
        mount('watcher', 'config', tickAbi());
        fireEvent.change(await screen.findByLabelText('asset (tick)'), { target: { value } });
        fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

        expect(await screen.findByRole('heading', { name: 'Review contract call' })).toBeInTheDocument();
    });
});

describe('ExecuteContractForm link prefill against a declared method', () => {
    const twoParamAbi = () => ({
        getContractByActionIndex: () => Promise.resolve({
            data: {
                abi: {
                    version: 1,
                    methods: {
                        pay: { params: [{ name: 'who', type: 'string' }, { name: 'note', type: 'string' }] },
                        ping: { params: [] },
                    },
                },
            },
        }),
    });

    it('fills the typed inputs when the link carries the declared arguments', async () => {
        mount('full', 'config', twoParamAbi(), { initialMethod: 'pay', initialParamsText: 'ann|thanks' });

        expect(await screen.findByLabelText('who (string)')).toHaveValue('ann');
        expect(screen.getByLabelText('note (string)')).toHaveValue('thanks');
    });

    it('keeps every argument visible when the link carries more than the method declares', async () => {
        mount('full', 'config', twoParamAbi(), { initialMethod: 'pay', initialParamsText: 'ann|thanks|extra' });

        expect(await screen.findByLabelText('Arguments (optional)')).toHaveValue('ann|thanks|extra');
        expect(screen.queryByLabelText('who (string)')).toBeNull();
    });

    it('keeps the declared inputs for a no-argument method and a link with no arguments', async () => {
        mount('full', 'config', twoParamAbi(), { initialMethod: 'ping', initialParamsText: '' });

        expect(await screen.findByRole('button', { name: 'Enter method manually' })).toBeInTheDocument();
        expect(screen.queryByLabelText('Arguments (optional)')).toBeNull();
    });
});
