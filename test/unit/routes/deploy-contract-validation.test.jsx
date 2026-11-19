// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, act as domAct, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { publishWalletModes, resetWalletModes } from '../../../packages/core/src/shared/hooks/useWalletMode.js';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';
import contractStyles from '../../../packages/core/src/shared/routes/ContractScreens.module.css';

const CHAIN = 'bitcoin-mainnet';
const WATCHER_HINT = 'Another phone signs for this wallet: this prepares the transaction for it. Sign it there, then bring the signed transaction to a wallet that can broadcast it.';
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

// `walletMode` among the overrides is the mode of wallet `w`, published the way
// the shell does from the wallet list; every other override is a messaging method.
function messagingWithValidation(result, { walletMode = 'full', ...overrides } = {}) {
    const fallback = () => Promise.resolve({});
    publishWalletModes({ wallets: [{ id: 'w', walletMode }], activeWalletId: 'w' });
    const target = {
        getAddressesByChain: () => Promise.resolve({ [CHAIN]: [ADDRESS] }),
        getActiveAddresses: () => Promise.resolve({}),
        getSettings: () => Promise.resolve({}),
        listWallets: () => Promise.resolve([{ id: 'w', name: 'W', walletMode }]),
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

afterEach(() => { cleanup(); resetWalletModes(); vi.useRealTimers(); });

async function drain(rounds = 16) {
    for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

// The form checks the source by itself once typing pauses for 500 ms; the
// tests that read a check's answer run on fake timers and step past it.
async function pauseTyping(ms = 500) {
    await domAct(async () => {
        await vi.advanceTimersByTimeAsync(ms);
        await drain();
    });
}

async function renderAndType(messaging, source = SOURCE) {
    vi.useFakeTimers();
    let utils;
    await domAct(async () => {
        utils = render(
            <MessagingProvider shell="web" messaging={messaging}>
                <DeployContractForm walletId="w" onBack={() => {}} />
            </MessagingProvider>,
        );
        await drain();
    });
    await domAct(async () => {
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: source } });
        await drain();
    });
    return utils;
}

async function renderAndValidate(result, overrides) {
    const utils = await renderAndType(messagingWithValidation(result, overrides));
    await pauseTyping();
    return utils;
}

/** The one status line under Code source, its glyph (✓ or !) included. */
function statusText(utils) {
    return utils.getByTestId('deploy-code-status').textContent;
}

/** SOURCE is 51 UTF-8 bytes; the Proxy answers checkContractCodeSize with {}, so the form's own count shows.
 * Sizes read in KB, never bytes, and a size rounds up (the shared formatBytes). */
const SOURCE_SIZE = '0.1 KB';

describe('DeployContractForm validation diagnostics', () => {
    it.each([320, 360])('keeps the source box inside the %ipx form with no tool buttons under it', async (viewportWidth) => {
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
            expect(source).toHaveClass(contractStyles.codeSource);
            expect(source).toHaveAttribute('wrap', 'off');
            expect(utils.queryByRole('button', { name: 'Validate Code' })).toBeNull();
            expect(utils.queryByRole('button', { name: 'Estimate Size' })).toBeNull();
            expect(utils.queryByRole('button', { name: 'Suggest Gas' })).toBeNull();
            // Nothing to restore before a suggestion exists.
            expect(utils.getByRole('button', { name: 'Use Suggested Gas' })).toBeDisabled();
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

        expect(statusText(utils)).toBe(`✓Valid, ${SOURCE_SIZE} of 64 KB (2 warnings)`);
        expect(utils.getByText('Decimal literal can produce a non-deterministic result.')).toBeTruthy();
        expect(utils.getByText(/Line 3.*Rule float-literal/)).toBeTruthy();
        expect(utils.getByText('Guard this state lookup before dereferencing it.')).toBeTruthy();
        expect(utils.getByText(/Line 4.*Column 5.*Code state-null-guard/)).toBeTruthy();

        const textarea = utils.getByLabelText('Code source');
        fireEvent.click(utils.getByRole('button', { name: /Decimal literal/ }));
        expect(textarea.selectionStart).toBe(SOURCE.indexOf('    return 0.5;'));

        fireEvent.change(textarea, { target: { value: `${SOURCE}\n` } });
        expect(utils.queryByTestId('deploy-code-status')).toBeNull();
        expect(utils.queryByText(/Decimal literal/)).toBeNull();
    });

    it('shows nothing until typing pauses, then the Valid status with the size in the line and the header', async () => {
        const utils = await renderAndType(messagingWithValidation({ valid: true }, {
            checkContractCodeSize: () => Promise.resolve({ bytes: 2458, withinLimit: true, limit: 65536 }),
        }));
        // The header counts the source live, before any check has run.
        expect(utils.getByText(`${SOURCE_SIZE} / 64 KB`)).toBeInTheDocument();

        await pauseTyping(499);
        expect(utils.queryByTestId('deploy-code-status')).toBeNull();

        await pauseTyping(1);
        // 2,458 bytes is 2.40 KB; a size rounds up to the next tenth.
        expect(statusText(utils)).toBe('✓Valid, 2.5 KB of 64 KB');
        expect(utils.getByText('2.5 KB / 64 KB')).toBeInTheDocument();
    });

    it('shows nothing under an empty code box', async () => {
        const utils = await renderAndType(messagingWithValidation({ valid: true }), '');
        await pauseTyping();
        expect(utils.queryByTestId('deploy-code-status')).toBeNull();
        expect(utils.queryByText(/\/ 64 KB/)).toBeNull();
    });

    it('drops a check that was still waiting when the code changed', async () => {
        const validateContractCode = vi.fn(() => Promise.resolve({ valid: true }));
        const utils = await renderAndType(messagingWithValidation({ valid: true }, { validateContractCode }));
        await pauseTyping(300);
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: `${SOURCE}\n` } });
            await drain();
        });
        await pauseTyping(300);
        expect(validateContractCode).not.toHaveBeenCalled();
        await pauseTyping(200);
        expect(validateContractCode).toHaveBeenCalledTimes(1);
        expect(validateContractCode).toHaveBeenCalledWith({ chainId: CHAIN, code: `${SOURCE}\n` });
    });

    it('shows invalid code as its first error with the line, and the line link moves the cursor there', async () => {
        const utils = await renderAndValidate({
            valid: false,
            errors: [{ message: 'Unexpected token.', line: 3, column: 4 }],
        });

        expect(statusText(utils)).toBe('!Line 3: Unexpected token.');
        fireEvent.click(utils.getByRole('button', { name: 'Line 3: Unexpected token.' }));
        expect(utils.getByLabelText('Code source').selectionStart).toBe(SOURCE.indexOf('    return 0.5;'));
    });

    it('blocks Publish on invalid code and routes the refusal to the Contract section', async () => {
        const utils = await renderAndValidate({ valid: false, errors: [{ message: 'Unexpected token.', line: 3 }] });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '100000' } });
        fireEvent.click(utils.getByRole('button', { name: 'Publish Contract' }));
        expect(utils.getByText('Fix the code error shown under Code source before publishing.')).toBeInTheDocument();
    });

    it('shows a source over the size limit as too large and blocks Publish', async () => {
        const utils = await renderAndValidate({ valid: true }, {
            checkContractCodeSize: () => Promise.resolve({ bytes: 70000, withinLimit: false, limit: 65536 }),
        });
        expect(statusText(utils)).toBe('!Too large, 68.4 KB of 64 KB');

        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '100000' } });
        fireEvent.click(utils.getByRole('button', { name: 'Publish Contract' }));
        expect(utils.getByText('Contract source is 68.4 KB, over the 64 KB limit. Shorten it before publishing.'))
            .toBeInTheDocument();
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

        // One status line: the first error with its line, and how many more.
        expect(statusText(utils))
            .toBe('!Line 2: The name __gas is reserved. (1 more error)');
        expect(utils.queryByText(/Unexpected token at line 5/)).toBeNull();
    });

    it('uses singular wording for one legacy warning', async () => {
        const utils = await renderAndValidate({
            valid: true,
            warnings: ['Decimal number literal detected at line 3.'],
        });

        expect(statusText(utils)).toBe(`✓Valid, ${SOURCE_SIZE} of 64 KB (1 warning)`);
        expect(utils.queryByText(/warning\(s\)/)).toBeNull();
        expect(utils.getByText('Decimal number literal detected at line 3.')).toBeTruthy();
    });

    it('shows the legacy singular error with its location', async () => {
        const utils = await renderAndValidate({
            valid: false,
            error: 'unsupported syntax (ES2020 maximum): Unexpected token (3:9)',
        });

        expect(statusText(utils))
            .toBe('!Line 3: Contracts must use ES2020 JavaScript or older, and this source uses '
                + 'something newer. The parser stopped at: Unexpected token (3:9)');
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
        fireEvent.change(utils.getByLabelText('Constructor params'), { target: { value: 'first|second' } });
        fireEvent.change(utils.getByLabelText('Cooldown blocks'), { target: { value: '10' } });
        fireEvent.click(utils.getByRole('button', { name: 'Publish Contract' }));

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
        fireEvent.click(utils.getByRole('button', { name: 'Publish Contract' }));

        expect(await utils.findByRole('alert')).toHaveTextContent('Gas limit must be a positive whole number.');
    });

    it('draws every template name with the contract icon, never an icon picked from the word', async () => {
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
        // "validation" would pick the check icon from its label and read as
        // chosen; both templates carry the same contract icon instead.
        const chip = utils.getByRole('button', { name: 'validation' });
        const escrowIcon = utils.getByRole('button', { name: 'escrow' }).querySelector('svg');
        expect(chip.querySelector('svg')).not.toBeNull();
        expect(escrowIcon).not.toBeNull();
        expect(chip.querySelector('svg').innerHTML).toBe(escrowIcon.innerHTML);
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

        const submit = utils.getByRole('button', { name: 'Publish Contract' });
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
        fireEvent.change(utils.getByLabelText('Cooldown blocks'), { target: { value: '10' } });
        fireEvent.change(utils.getByLabelText('Slash destination'), {
            target: { value: 'not-an-address' },
        });
        fireEvent.click(utils.getByRole('button', { name: 'Publish Contract' }));

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
                        walletMode: 'watcher',
                    })}
                >
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '100000' } });
        fireEvent.change(utils.getByLabelText('Constructor params'), {
            target: { value: 'first|second' },
        });
        fireEvent.click(utils.getByRole('button', { name: 'Publish Contract' }));

        expect(await utils.findByRole('heading', { name: 'Confirm' })).toBeInTheDocument();
        expect(utils.getByText(WATCHER_HINT)).toBeInTheDocument();
        const constructorRow = utils.getByText('Constructor').nextElementSibling;
        expect(constructorRow).toHaveTextContent('first, second');

        fireEvent.click(utils.getByRole('button', { name: 'Reject' }));
        expect(await utils.findByLabelText('Constructor params')).toHaveValue('first|second');
        expect(utils.getByLabelText('Gas limit')).toHaveValue('100000');
    });

    it('renders hostile constructor text plainly and preserves exact values in review', async () => {
        let utils;
        await domAct(async () => {
            utils = render(
                <MessagingProvider
                    shell="web"
                    messaging={messagingWithValidation({ valid: true }, {
                        walletMode: 'watcher',
                    })}
                >
                    <DeployContractForm walletId="w" onBack={() => {}} />
                </MessagingProvider>,
            );
            await drain();
        });
        fireEvent.change(utils.getByLabelText('Code source'), { target: { value: SOURCE } });
        fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value: '9007199254740993' } });
        fireEvent.change(utils.getByLabelText('Constructor params'), {
            target: { value: '<img src=x>⚡|9007199254740993' },
        });
        fireEvent.click(utils.getByRole('button', { name: 'Publish Contract' }));

        expect(await utils.findByRole('heading', { name: 'Confirm' })).toBeInTheDocument();
        const constructorRow = utils.getByText('Constructor').nextElementSibling;
        expect(constructorRow).toHaveTextContent('<img src=x>⚡, 9007199254740993');
        expect(constructorRow.querySelector('img')).toBeNull();
        expect(utils.getByText('Gas limit').nextElementSibling).toHaveTextContent('9007199254740993');
    });

});

describe('DeployContractForm automatic gas', () => {
    // The label must follow the gas value that is submitted: the trimmed
    // field, or the suggestion when the field is empty.
    function gasMessaging(result = { valid: true }, suggestContractGasLimit = vi.fn(
        () => Promise.resolve({ suggested: 21000, rationale: null }),
    )) {
        return { messaging: messagingWithValidation(result, { suggestContractGasLimit }), suggestContractGasLimit };
    }

    async function typeGas(utils, value) {
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Gas limit'), { target: { value } });
            await drain();
        });
    }

    it('fills an empty gas field with the suggestion once the code is valid, and says applied', async () => {
        const utils = await renderAndType(gasMessaging().messaging);
        expect(utils.getByLabelText('Gas limit')).toHaveValue('');
        await pauseTyping();
        expect(utils.getByLabelText('Gas limit')).toHaveValue('21000');
        expect(utils.getByText(/Suggested gas limit:/)).toHaveTextContent('Suggested gas limit: 21000 (applied)');
    });

    it('asks for no suggestion while the code is invalid', async () => {
        const { messaging, suggestContractGasLimit } = gasMessaging({ valid: false, errors: ['Unexpected token at line 5'] });
        const utils = await renderAndType(messaging);
        await pauseTyping();
        expect(suggestContractGasLimit).not.toHaveBeenCalled();
        expect(utils.getByLabelText('Gas limit')).toHaveValue('');
    });

    it('never overwrites a gas limit the user typed, and says not applied', async () => {
        const utils = await renderAndType(gasMessaging().messaging);
        await typeGas(utils, '50000');
        await pauseTyping();
        expect(utils.getByLabelText('Gas limit')).toHaveValue('50000');
        const label = utils.getByText(/Suggested gas limit:/);
        expect(label).toHaveTextContent('Suggested gas limit: 21000 (not applied: your gas limit is used)');
        expect(label).not.toHaveTextContent('21000 (applied)');
    });

    it('refreshes its own filled value when the code changes', async () => {
        const suggest = vi.fn()
            .mockResolvedValueOnce({ suggested: 21000, rationale: null })
            .mockResolvedValueOnce({ suggested: 34000, rationale: null });
        const utils = await renderAndType(gasMessaging({ valid: true }, suggest).messaging);
        await pauseTyping();
        expect(utils.getByLabelText('Gas limit')).toHaveValue('21000');
        await domAct(async () => {
            fireEvent.change(utils.getByLabelText('Code source'), { target: { value: `${SOURCE}\n` } });
            await drain();
        });
        await pauseTyping();
        expect(utils.getByLabelText('Gas limit')).toHaveValue('34000');
    });

    it('puts the suggestion back over a typed value from the icon in the Gas limit field', async () => {
        const utils = await renderAndType(gasMessaging().messaging);
        await typeGas(utils, '50000');
        await pauseTyping();
        expect(utils.getByLabelText('Gas limit')).toHaveValue('50000');

        const restore = utils.getByRole('button', { name: 'Use Suggested Gas' });
        expect(restore).toBeEnabled();
        fireEvent.click(restore);
        expect(utils.getByLabelText('Gas limit')).toHaveValue('21000');
        expect(utils.getByText(/Suggested gas limit:/)).toHaveTextContent('Suggested gas limit: 21000 (applied)');
    });

    it('still says applied after the gas field is cleared, since submit falls back to the suggestion', async () => {
        const utils = await renderAndType(gasMessaging().messaging);
        await pauseTyping();
        const label = utils.getByText(/Suggested gas limit:/);
        await typeGas(utils, '');
        expect(label).toHaveTextContent('Suggested gas limit: 21000 (applied)');
    });

    it('blocks Publish with no gas and no suggestion, naming the field icon', async () => {
        const utils = await renderAndType(messagingWithValidation({ valid: true }));
        fireEvent.click(utils.getByRole('button', { name: 'Publish Contract' }));
        expect(utils.getByText('Gas limit must be a positive whole number. Tap "Use Suggested Gas" in the field for an estimate.'))
            .toBeInTheDocument();
    });
});
