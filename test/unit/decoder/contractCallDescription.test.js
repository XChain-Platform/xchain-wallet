// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { describe, expect, it } from 'vitest';
import { withContractCallDescriptions } from '../../../packages/core/src/decoder/contract_call_description.js';
import { revealHiddenText } from '../../../packages/core/src/shared/utils/textHardening.js';

const ZWSP = String.fromCharCode(0x200B);
const RLO = String.fromCharCode(0x202E);

// The SDK's own wording for these actions, as it describes them today.
const sdkExecute = (joined) => ({
    summary: 'Call flags() on contract #12',
    details: [
        { label: 'Contract', value: '#12' },
        { label: 'Method', value: 'flags' },
        { label: 'Arguments', value: joined },
    ],
    warnings: ['Gas is charged even if the contract call fails at runtime.'],
});

const sdkDeploy = () => ({
    summary: 'Deploy smart contract',
    details: [
        { label: 'Code size (base64)', value: '264' },
        { label: 'Gas limit', value: '200000' },
        { label: 'Cooldown blocks', value: '10' },
    ],
    warnings: ['Deployed contract code is immutable and its constructor runs once at deploy.'],
});

describe('withContractCallDescriptions EXECUTE', () => {
    it('lists each argument on its own row, so one argument containing a comma is one row', () => {
        const parsed = { action: 'EXECUTE', params: { PARAMS: ['true', 'x, y', 'a,b'] } };
        const out = withContractCallDescriptions(sdkExecute('true, x, y, a,b'), parsed);
        expect(out.details).toEqual([
            { label: 'Contract', value: '#12' },
            { label: 'Method', value: 'flags' },
            { label: 'Argument 1', value: 'true' },
            { label: 'Argument 2', value: 'x, y' },
            { label: 'Argument 3', value: 'a,b' },
        ]);
    });

    it('spells out an invisible character, a bidi override and a doubled space', () => {
        const parsed = { action: 'EXECUTE', params: { PARAMS: [`x${ZWSP}y`, `abc${RLO}def`, 'a  b'] } };
        const values = withContractCallDescriptions(sdkExecute(''), parsed).details
            .filter((row) => row.label.startsWith('Argument'))
            .map((row) => row.value);
        expect(values).toEqual(['x[U+200B]y', 'abc[U+202E]def', 'a[U+0020][U+0020]b']);
    });

    it('keeps the SDK description for a call with no arguments', () => {
        const decoded = sdkExecute('');
        decoded.details.pop();
        expect(withContractCallDescriptions(decoded, { action: 'EXECUTE', params: {} })).toBe(decoded);
    });

    it('replaces the arguments of an EXECUTE step inside a batch', () => {
        const decoded = {
            summary: 'Batch of 2 actions',
            details: [
                { label: 'Step 1', value: 'Deposit 1.5 XCHAIN into contract #12' },
                { label: '  Contract', value: '#12' },
                { label: 'Step 2', value: 'Call numAmt() on contract #12' },
                { label: '  Method', value: 'numAmt' },
                { label: '  Arguments', value: '1, x, y' },
            ],
            warnings: [],
        };
        const parsed = {
            action: 'BATCH',
            commands: [
                { ok: true, action: 'DEPOSIT', params: {} },
                { ok: true, action: 'EXECUTE', params: { PARAMS: ['1', 'x, y'] } },
            ],
        };
        expect(withContractCallDescriptions(decoded, parsed).details.slice(3)).toEqual([
            { label: '  Method', value: 'numAmt' },
            { label: '  Argument 1', value: '1' },
            { label: '  Argument 2', value: 'x, y' },
        ]);
    });
});

describe('withContractCallDescriptions DEPLOY', () => {
    it('adds each constructor argument after the gas limit', () => {
        const parsed = { action: 'DEPLOY', params: { CONSTRUCTOR_PARAMS: ['alpha', 'beta'] } };
        expect(withContractCallDescriptions(sdkDeploy(), parsed).details).toEqual([
            { label: 'Code size (base64)', value: '264' },
            { label: 'Gas limit', value: '200000' },
            { label: 'Constructor argument 1', value: 'alpha' },
            { label: 'Constructor argument 2', value: 'beta' },
            { label: 'Cooldown blocks', value: '10' },
        ]);
    });

    it('describes the single constructor argument of a stakeable deploy', () => {
        const parsed = { action: 'DEPLOY', params: { CONSTRUCTOR_PARAMS: 'x' } };
        const rows = withContractCallDescriptions(sdkDeploy(), parsed).details;
        expect(rows).toContainEqual({ label: 'Constructor argument 1', value: 'x' });
    });

    it('leaves a deploy without constructor arguments as the SDK described it', () => {
        const decoded = sdkDeploy();
        expect(withContractCallDescriptions(decoded, { action: 'DEPLOY', params: {} })).toBe(decoded);
    });
});

describe('withContractCallDescriptions other actions', () => {
    it('returns anything else untouched', () => {
        const decoded = { summary: 's', details: [{ label: 'Arguments', value: 'a, b' }], warnings: [] };
        expect(withContractCallDescriptions(decoded, { action: 'SEND', params: {} })).toBe(decoded);
        expect(withContractCallDescriptions(null, { action: 'EXECUTE' })).toBe(null);
        expect(withContractCallDescriptions(decoded, null)).toBe(decoded);
    });
});

describe('revealHiddenText', () => {
    it('leaves ordinary text, one interior space and unicode alone', () => {
        expect(revealHiddenText('héllo 🌍 world')).toBe('héllo 🌍 world');
        expect(revealHiddenText(null)).toBe('');
    });

    it('spells out controls, no-break spaces and edge spaces', () => {
        expect(revealHiddenText(`a\tb`)).toBe('a[U+0009]b');
        expect(revealHiddenText(['a', 'b'].join(String.fromCharCode(0xA0)))).toBe('a[U+00A0]b');
        expect(revealHiddenText(' a ')).toBe('[U+0020]a[U+0020]');
    });
});
