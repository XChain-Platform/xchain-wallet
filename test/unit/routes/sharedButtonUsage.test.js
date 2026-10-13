// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migratedRoutes = [
    'ActionsMenu',
    'AirdropForm',
    'AlertsRoute',
    'BetFeedsList',
    'ContactsList',
    'ContractDetail',
    'ContractsList',
    'CreateOrderForm',
    'CreateWallet',
    'DeployContractForm',
    'DispenserExplorer',
    'DispenserForm',
    'DispensersList',
    'ListCreateForm',
    'SwapForm',
];

describe('shared route button usage', () => {
    it.each(migratedRoutes)('%s uses the shared Button component', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).toMatch(/import\s+\{[^}]*\bButton\b[^}]*\}\s+from\s+'@xchain-wallet\/core\/ui'/s);
        expect(source).toMatch(/<Button\b/);
        expect(source).not.toMatch(/<button\b/);
    });
});

describe('trade form style guide primitives', () => {
    const targets = [
        'packages/core/src/shared/routes/CreateOrderForm.jsx',
        'packages/core/src/shared/routes/DispenserForm.jsx',
        'packages/core/src/shared/routes/SwapForm.jsx',
        'packages/core/src/shared/components/PlaceOrderPanel.jsx',
    ];

    it.each(targets)('%s uses kit fields and documents native control exceptions', (file) => {
        const source = readFileSync(resolve(process.cwd(), file), 'utf8');
        const rawInputs = source.match(/<input\b[^>]*>/g) || [];

        expect(source).not.toMatch(/<select\b/);
        expect(source).not.toMatch(/<textarea\b/);
        expect(rawInputs.every((tag) => /type="(?:checkbox|radio)"/.test(tag))).toBe(true);
        for (const rawInput of rawInputs) {
            const offset = source.indexOf(rawInput);
            expect(source.slice(Math.max(0, offset - 180), offset)).toMatch(
                /Native (?:checkboxes|radios) preserve [^\n]+ because the kit has no (?:checkbox|radio) primitive\./,
            );
        }
    });

    it('uses page, empty-state, select, and address primitives for matching jobs', () => {
        const createOrder = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/CreateOrderForm.jsx',
        ), 'utf8');
        const dispenser = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/DispenserForm.jsx',
        ), 'utf8');
        const swap = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/routes/SwapForm.jsx',
        ), 'utf8');
        const placeOrder = readFileSync(resolve(
            process.cwd(),
            'packages/core/src/shared/components/PlaceOrderPanel.jsx',
        ), 'utf8');

        expect(createOrder).toMatch(/<AddressField\s+label="Receive at \(optional\)"/);
        expect(dispenser).toMatch(/<Select[\s\S]*label="Priced in fiat \(optional\)"/);
        expect(dispenser).toMatch(/<AddressField[\s\S]*id="dispenser-oracle"/);
        expect(swap).toMatch(/<AddressField\s+label="Receive at \(optional\)"/);
        expect(placeOrder).toMatch(/<FormPage\b/);
        expect(placeOrder).toMatch(/<EmptyState\b/);
        expect(placeOrder).toMatch(/<Select[\s\S]*label="Expiration"/);
        expect(placeOrder.match(/<button\b/g)).toHaveLength(2);
        expect(placeOrder.match(/Native buttons retain segmented-toggle pressed behavior/g)).toHaveLength(2);
    });
});
