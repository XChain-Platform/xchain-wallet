// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, it, expect } from 'vitest';
import { render, act as domAct, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import contractStyles from '../../../packages/core/src/shared/routes/ContractScreens.module.css';

const CHAIN = 'bitcoin-mainnet';
const SOURCE = [
    'module.exports = {',
    '  run() {',
    '    return 0.5;',
    '  }',
    '};',
].join('\n');

const ADDRESS = Object.freeze({
    id: 'addr-hd-0',
    address: 'bc1qexampleexampleexampleexampleexampleex',
    publicKey: '02aabbcc',
    derivationPath: "m/84'/0'/0'/0/0",
    source: 'hd',
    signerId: 'signer-1',
});

function messagingWithValidation(result, overrides = {}) {
    const fallback = () => Promise.resolve({});
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({ walletMode: 'full' }),
        signerReady: () => Promise.resolve({ ready: false }),
        getSignerStatus: () => Promise.resolve({ status: 'locked' }),
        listContractTemplates: () => Promise.resolve({ templates: [], patterns: [] }),
        listPendingDeploys: () => Promise.resolve([]),
        planDeploy: () => Promise.resolve({ single: true, totalChunks: 0, codeHash: 'ab' }),
        getContractExportedMeta: () => Promise.resolve(null),
        validateContractCode: () => Promise.resolve(result),
        ...overrides,
    };
    return new Proxy(target, {
        get(object, property) {
            return property in object ? object[property] : fallback;
        },
    });
}

afterEach(() => cleanup());

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

async function renderAndValidate(result) {
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messagingWithValidation(result)}>
                <DeployContractForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
        await drain();
    });
    await domAct(async () => {
        fireEvent.click(utils.getByRole('button', { name: 'Validate code' }));
        await drain();
    });
    return utils;
}

describe('DeployContractForm validation diagnostics', () => {
    it.each([320, 360])('keeps source and tool controls inside the %ipx form', async (viewportWidth) => {
        const widthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
        let utils;

        try {
            await domAct(async () => {
                utils = render(
                    <MessagingProvider shell="web" messaging={messagingWithValidation({ valid: true })}>
                        <DeployContractForm walletId="w" onBack={() => {}} />
                    </MessagingProvider>,
                );
                await drain();
            });

            const source = utils.getByLabelText('Code source');
            const tools = utils.getByRole('button', { name: 'Validate code' }).parentElement;
            expect(source).toHaveClass(contractStyles.codeSource);
            expect(source).toHaveAttribute('wrap', 'off');
            expect(tools).toHaveClass(contractStyles.toolActions);
            expect(utils.getByRole('button', { name: 'Estimate size' })).toBeInTheDocument();
            expect(utils.getByRole('button', { name: 'Suggest gas' })).toBeInTheDocument();
        } finally {
            if (widthDescriptor) Object.defineProperty(window, 'innerWidth', widthDescriptor);
        }
    });

    it('shows every structured warning with its location and rule, and jumps to its line', async () => {
        const utils = await renderAndValidate({
            valid: true,
            warnings: [
                {
                    rule: 'float-literal',
                    message: 'Decimal literal can produce a non-deterministic result.',
                    line: 3,
                    severity: 'warning',
                },
                {
                    code: 'state-null-guard',
                    message: 'Guard this state lookup before dereferencing it.',
                    line: 4,
                    column: 5,
                    severity: 'warning',
                },
            ],
        });

        expect(utils.getByText(/Syntax OK\. \(2 warnings\)/)).toBeTruthy();
        expect(utils.getByText('Decimal literal can produce a non-deterministic result.')).toBeTruthy();
        expect(utils.getByText(/Line 3.*Rule float-literal/)).toBeTruthy();
        expect(utils.getByText('Guard this state lookup before dereferencing it.')).toBeTruthy();
        expect(utils.getByText(/Line 4.*Column 5.*Code state-null-guard/)).toBeTruthy();

        const textarea = utils.getByLabelText('Code source');
        fireEvent.click(utils.getByRole('button', { name: /Decimal literal/ }));
        expect(textarea.selectionStart).toBe(SOURCE.indexOf('    return 0.5;'));

        fireEvent.change(textarea, { target: { value: `${SOURCE}\n` } });
        expect(utils.queryByText(/Syntax OK/)).toBeNull();
        expect(utils.queryByText(/Decimal literal/)).toBeNull();
    });

    it('shows every structured and string error returned in the errors array', async () => {
        const utils = await renderAndValidate({
            valid: false,
            errors: [
                {
                    ruleId: 'reserved-identifier',
                    message: 'The name __gas is reserved.',
                    line: 2,
                    column: 9,
                    severity: 'error',
                },
                'Unexpected token at line 5',
            ],
        });

        expect(utils.getByText(/Validation failed\. \(2 errors\)/)).toBeTruthy();
        expect(utils.getByText('The name __gas is reserved.')).toBeTruthy();
        expect(utils.getByText(/Line 2.*Column 9.*Rule reserved-identifier/)).toBeTruthy();
        expect(utils.getByText('Unexpected token at line 5')).toBeTruthy();
    });

    it('uses singular wording for one legacy warning', async () => {
        const utils = await renderAndValidate({
            valid: true,
            warnings: ['Decimal number literal detected at line 3.'],
        });

        expect(utils.getByText(/Syntax OK\. \(1 warning\)/)).toBeTruthy();
        expect(utils.queryByText(/warning\(s\)/)).toBeNull();
        expect(utils.getByText('Decimal number literal detected at line 3.')).toBeTruthy();
    });

    it('shows the legacy singular error with its location', async () => {
        const utils = await renderAndValidate({
            valid: false,
            error: 'unsupported syntax (ES2020 maximum): Unexpected token (3:9)',
        });

        expect(utils.getByText(/Validation failed\. \(1 error\)/)).toBeTruthy();
        expect(utils.getByText(/The parser stopped at: Unexpected token \(3:9\)/)).toBeTruthy();
        expect(utils.getByText(/Line 3.*Column 9/)).toBeTruthy();
    });

    it('rejects multiple constructor arguments when staking makes the wire field scalar', async () => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messagingWithValidation({ valid: true })}>
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });

        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '100000' } });
        fireEvent.change(utils.getByLabelText('Constructor params (optional)'), { target: { value: 'first|second' } });
        fireEvent.change(utils.getByLabelText('Cooldown blocks (optional)'), { target: { value: '10' } });
        fireEvent.click(utils.getByRole('button', { name: 'Publish' }));

        expect(await utils.findByRole('alert')).toHaveTextContent(
            'A stake-enabled contract accepts one constructor argument.',
        );
    });

    it('rejects exponent notation for the integer gas limit', async () => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messagingWithValidation({ valid: true })}>
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });

        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '1e5' } });
        fireEvent.click(utils.getByRole('button', { name: 'Publish' }));

        expect(await utils.findByRole('alert')).toHaveTextContent('Gas limit must be a positive whole number.');
    });

    it('draws template names as plain labels with no icon picked from the word', async () => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider
                    shell="web"
                    messaging={messagingWithValidation({}, {
                        listContractTemplates: () => Promise.resolve({
                            templates: ['escrow', 'validation'],
                            patterns: [],
                        }),
                    })}
                >
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });
        const chip = utils.getByRole('button', { name: 'validation' });
        expect(chip.querySelector('svg')).toBeNull();
        expect(utils.getByRole('button', { name: 'escrow' }).querySelector('svg')).toBeNull();
    });

    it('shows the required source message before review', async () => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messagingWithValidation({ valid: true })}>
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });

        const submit = utils.getByRole('button', { name: 'Publish' });
        expect(submit).toBeEnabled();
        fireEvent.click(submit);
        expect(await utils.findByRole('alert')).toHaveTextContent('Contract source is required.');
    });

    it('rejects a malformed slash destination before review', async () => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider shell="web" messaging={messagingWithValidation({ valid: true })}>
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '100000' } });
        fireEvent.change(utils.getByLabelText('Cooldown blocks (optional)'), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText('Slash destination (optional)'), {
            target: { value: 'not-an-address' },
        });
        fireEvent.click(utils.getByRole('button', { name: 'Publish' }));

        expect(await utils.findByRole('alert'))
            .toHaveTextContent('Slash destination must be BURN or a valid address for Bitcoin.');
    });

    it('review display matches the build for multi-value constructor parameters', async () => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider
                    shell="web"
                    messaging={messagingWithValidation({ valid: true }, {
                        getSettings: () => Promise.resolve({ walletMode: 'watcher' }),
                    })}
                >
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '100000' } });
        fireEvent.change(utils.getByLabelText('Constructor params (optional)'), {
            target: { value: 'first|second' },
        });
        fireEvent.click(utils.getByRole('button', { name: 'Preview' }));

        expect(await utils.findByRole('heading', { name: 'Review publish' })).toBeInTheDocument();
        const constructorRow = utils.getByText('Constructor').nextElementSibling;
        expect(Array.from(constructorRow.querySelectorAll('li')).map((node) => node.textContent))
            .toEqual(['first', 'second']);
        expect(constructorRow).not.toHaveTextContent('first,second');

        fireEvent.click(utils.getByRole('button', { name: 'Back to previous screen' }));
        expect(await utils.findByLabelText('Constructor params (optional)')).toHaveValue('first|second');
        expect(utils.getByLabelText('Gas limit')).toHaveValue('100000');
    });

});

describe('DeployContractForm suggested gas label', () => {
    // The label must follow the gas value that is submitted: the trimmed
    // field, or the suggestion when the field is empty.
    async function renderWithSuggestion() {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider
                    shell="web"
                    messaging={messagingWithValidation({ valid: true }, {
                        suggestContractGasLimit: () => Promise.resolve({ suggested: 21000, rationale: null }),
                    })}
                >
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
            await drain();
        });
        return utils;
    }

    async function suggest(utils) {
        await domAct(async () => {
            fireEvent.click(utils.getByRole('button', { name: 'Suggest gas' }));
            await drain();
        });
        return utils.getByText(/Suggested gas limit:/);
    }

    it('says applied when the suggestion fills an empty gas field', async () => {
        const utils = await renderWithSuggestion();
        const label = await suggest(utils);
        expect(utils.getByLabelText('Gas limit')).toHaveValue('21000');
        expect(label).toHaveTextContent('Suggested gas limit: 21000 (applied)');
    });

    it('says not applied when the user already set a different gas limit', async () => {
        const utils = await renderWithSuggestion();
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '50000' } });
            await drain();
        });
        const label = await suggest(utils);
        expect(utils.getByLabelText('Gas limit')).toHaveValue('50000');
        expect(label).toHaveTextContent('Suggested gas limit: 21000 (not applied: your gas limit is used)');
        expect(label).not.toHaveTextContent('21000 (applied)');
    });

    it('still says applied after the gas field is cleared, since submit falls back to the suggestion', async () => {
        const utils = await renderWithSuggestion();
        const label = await suggest(utils);
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '' } });
            await drain();
        });
        expect(label).toHaveTextContent('Suggested gas limit: 21000 (applied)');
    });
});
