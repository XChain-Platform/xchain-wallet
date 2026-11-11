// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(
    here,
    '../../../packages/core/src/shared/routes/CreatePollForm.jsx',
), 'utf8');

describe('CreatePollForm UI rulings', () => {
    it('gives From and every poll option form-specific help', () => {
        expect(source).toMatch(/label="From"[\s\S]*?help="The address that creates and pays for this poll\./);
        expect(source).toMatch(/label=\{`Option \$\{i\}`\}[\s\S]*?help="A choice voters can select\. Option labels cannot contain commas\."/);
        expect(source).toContain('label="Extra arguments" optional help=');
        expect(source).not.toContain('hint=\'A JSON list appended after the poll result');
        expect(source).not.toContain('A binding poll doesn&rsquo;t just record an opinion');
        expect(source).toMatch(/label="Contract to call" optional[\s\S]*?help="The contract's number,[\s\S]*?leave it blank to keep the poll advisory\."/);
    });

    it('uses Optional pills and the SDK question limit without label suffixes', () => {
        expect(source).not.toContain('(optional)');
        for (const label of [
            'Question',
            'Quorum',
            'Minimum voters',
            'Minimum vote balance',
            'Early-decide threshold',
            'Creation deposit',
            'Contract to call',
            'Extra arguments',
            'Escrow to fund the call',
            'Delay before the call runs',
        ]) {
            expect(source).toMatch(new RegExp(`label="${label}"[^>]*optional`));
        }
        // The SDK's 1 MiB payload cap is not a form length limit, so Question shows no counter.
        expect(source).not.toMatch(/label="Question"[^>]*maxLength/);
    });

    it('uses shared XCHAIN AmountFields whose Max subtracts the other spend', () => {
        expect(source).toMatch(/<AmountField label="Creation deposit"[\s\S]*?tick="XCHAIN"[\s\S]*?onMax=\{maxDeposit/);
        expect(source).toMatch(/<AmountField label="Escrow to fund the call"[\s\S]*?tick="XCHAIN"[\s\S]*?onMax=\{maxGasEscrow/);
        expect(source).toContain('const maxDeposit = maxXchainAfter(gasEscrow);');
        expect(source).toContain('const maxGasEscrow = maxXchainAfter(deposit);');
        expect(source).toContain("return remaining !== null && compareDecimalStrings(remaining, '0') === -1 ? '0' : remaining;");
        expect(source).toContain('divisibility={xchainTokenInfo?.divisibility}');
    });

    it('pins the action names, icons, review navigation, and result action', () => {
        expect(source).toContain('icon={showBinding ? <Icon.EyeOffIcon /> : <Icon.ContractIcon />}');
        expect(source).toContain('<Button type="button" variant="ghost" onClick={addOption}>Add option</Button>');
        expect(source).toContain('<Button type="button" variant="ghost" onClick={() => removeOption(i)}>Remove</Button>');
        expect(source).not.toContain("{singleEncode ? 'Create poll' : 'Preview'}");
        expect(source).not.toContain('>Back</Button>');
        expect(source).toContain('<Button variant="success" icon={<Icon.CheckIcon />} onClick={onCreated || onBack}>Done</Button>');
    });
});
