// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8');

const files = {
    tokenSource: 'packages/core/src/shared/routes/TokenPicker.jsx',
    balanceSource: 'packages/core/src/shared/components/BalanceList.jsx',
    balance: 'packages/core/src/shared/components/BalanceList.module.css',
    networkSource: 'packages/core/src/ui/NetworkPicker.jsx',
    listRow: 'packages/core/src/ui/ListRow.module.css',
    rowStates: 'packages/core/src/ui/Card.module.css',
    contacts: 'packages/core/src/shared/components/ContactsPickerScreen.module.css',
    address: 'packages/core/src/ui/AddressCombobox.module.css',
    dropdown: 'packages/core/src/ui/IconSelect.module.css',
};

function hoverRules(css) {
    return [...css.matchAll(/[^{}]*:hover[^{}]*\{[^}]*\}/g)].map((match) => match[0]);
}

describe('picker option state colors', () => {
    it('pins token and network rows to the side-menu hover and active tokens', () => {
        const tokenSource = read(files.tokenSource);
        const balanceSource = read(files.balanceSource);
        const balance = read(files.balance);
        const networkSource = read(files.networkSource);
        const listRow = read(files.listRow);
        const rowStates = read(files.rowStates);

        expect(tokenSource).toContain('<BalanceList');
        expect(balanceSource).toMatch(/data-xc-row-state=\{clickable \? '' : undefined\}/);
        expect(balanceSource).toMatch(/data-selected=\{selected \? 'true' : undefined\}/);
        expect(balance).toMatch(/\.row\.row\[data-xc-row-state\]:hover\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\)/s);
        expect(balance).toMatch(/\.row\.row\[data-xc-row-state\]:active\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\)/s);
        expect(balance).toMatch(/\.row\.row > \.rowContent\.rowContent:is\([\s\S]*?:hover,[\s\S]*?:active,[\s\S]*?\)\s*\{[^}]*background:\s*transparent/s);
        expect(rowStates).toMatch(/\[data-xc-row-state\][^{]*:hover\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\)/s);
        expect(rowStates).toMatch(/\[data-selected='true'\][^)]*\)\s*\{[^}]*background:\s*var\(--xc-row-active-bg\)/s);

        expect(networkSource).toMatch(/aria-current=\{selected \? 'true' : undefined\}/);
        expect(networkSource).toContain('data-network-option=""');
        expect(listRow).toMatch(/\.interactive:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\)/s);
        expect(listRow).toMatch(/\.interactive:is\([^}]*background:\s*var\(--xc-row-active-bg\)/s);
    });

    it('uses the same hover token for contact and list picker rows', () => {
        const contacts = read(files.contacts);
        expect(contacts).toMatch(/\.abRow:hover\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\)/s);
    });

    it('separates hover and current states in contact suggestions and themed dropdowns', () => {
        const address = read(files.address);
        const dropdown = read(files.dropdown);

        expect(address).toMatch(/\.option:hover\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\)/s);
        expect(address).toMatch(/\.option\[aria-selected="true"\]\s*\{[^}]*background:\s*var\(--xc-row-active-bg\)/s);
        expect(dropdown).toMatch(/\.item:hover\s*\{[^}]*background:\s*var\(--xc-row-hover-bg\)/s);
        expect(dropdown).toMatch(/\.itemActive\s*\{[^}]*background:\s*var\(--xc-row-active-bg\)/s);
    });

    it('never paints a picker hover with the solid accent fill', () => {
        for (const file of [files.balance, files.listRow, files.rowStates, files.contacts, files.address, files.dropdown]) {
            for (const rule of hoverRules(read(file))) {
                expect(rule, file).not.toMatch(/background(?:-color)?:\s*var\(--xc-accent-primary\)/);
                expect(rule, file).not.toContain('var(--xc-on-accent)');
            }
        }
        for (const file of [files.listRow, files.rowStates, files.address, files.dropdown]) {
            expect(read(file), file).not.toContain('var(--xc-on-accent)');
        }
    });
});
