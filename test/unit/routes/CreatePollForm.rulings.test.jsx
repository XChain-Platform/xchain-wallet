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
        // From is the standard FromSection; its address help is addressHelp.
        expect(source).toMatch(/<FromSection[\s\S]*?addressHelp="The address that creates and pays for this poll\./);
        expect(source).toMatch(/label=\{`Option \$\{i \+ 1\}`\}[\s\S]*?help="A choice voters can select\. Option labels cannot contain commas\."/);
        expect(source).toContain('label="Extra arguments" help=');
        expect(source).not.toContain('hint=\'A JSON list appended after the poll result');
        expect(source).not.toContain('A binding poll doesn&rsquo;t just record an opinion');
        expect(source).toMatch(/label="Contract to call"\s+help="The contract's number,[\s\S]*?leave it blank to keep the poll advisory\."/);
    });

    it('uses Optional pills and the SDK question limit without label suffixes', () => {
        expect(source).not.toContain('(optional)');
        // The Optional pill now sits on the closed section that holds these
        // fields, so the fields drop their own tags; Question is required.
        for (const [title, id] of [
            ['Rules to Pass', 'rules'],
            ['Deposit', 'deposit'],
            ['Run a Contract When It Ends', 'contract'],
        ]) {
            expect(source).toMatch(new RegExp(`id="${id}"\\s+title="${title}"\\s+icon=\\{[^}]+\\}\\s+optional`));
        }
        for (const label of [
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
            expect(source).toMatch(new RegExp(`label="${label}"`));
            expect(source).not.toMatch(new RegExp(`label="${label}"[^>]*optional`));
        }
        expect(source).not.toMatch(/label="Question"[^>]*optional/);
    });

    // The wallet caps Question at 250 and each option at 100, shown as a
    // count on the label line; the protocol bounds QUESTION only by the
    // message size limit and options not at all.
    it('caps Question at 250 and each option at 100, with their counts', () => {
        expect(source).toMatch(/label="Question"[\s\S]{0,200}maxLength=\{250\}/);
        expect(source).toMatch(/label=\{`Option \$\{i \+ 1\}`\}[\s\S]{0,200}maxLength=\{100\}/);
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
        expect(source).toMatch(/<FormAction\s+icon=\{<Icon\.PlusIcon \/>\}[\s\S]*?Create Poll\s+<\/FormAction>/);
        expect(source).toContain('<Button type="button" variant="ghost" onClick={addOption}>{t(\'governance.action.addOption\')}</Button>');
        expect(source).toContain('<Button type="button" variant="ghost" onClick={() => removeOption(i)}>Remove</Button>');
        expect(source).not.toContain("{singleEncode ? 'Create poll' : 'Preview'}");
        expect(source).not.toContain('>Back</Button>');
        expect(source).toContain('<Button variant="success" icon={<Icon.CheckIcon />} onClick={onCreated || onBack}>Done</Button>');
    });
});
