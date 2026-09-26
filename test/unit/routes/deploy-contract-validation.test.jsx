// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, it, expect } from 'vitest';
import { render, act as domAct, fireEvent } from '@testing-library/react';
import React from 'react';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { DeployContractForm } from '../../../packages/core/src/shared/routes/DeployContractForm.jsx';

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

function messagingWithValidation(result) {
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
    };
    return new Proxy(target, {
        get(object, property) {
            return property in object ? object[property] : fallback;
        },
    });
}

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
});
