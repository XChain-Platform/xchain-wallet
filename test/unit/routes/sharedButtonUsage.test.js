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
    'MessagingInbox',
    'ParallelComposer',
    'PublishFileForm',
    'BatchComposerForm',
    'SwapForm',
];

const styleGuideRoutes = {
    AccountPicker: ['Button'],
    ControllerBindForm: ['Button', 'Input', 'Select'],
    ListCreateForm: ['Button', 'Input', 'Select', 'Textarea'],
    MarketActivity: ['Button'],
    MarketView: ['Button'],
    MultisigCreate: ['Button', 'Input', 'Select'],
    PairSignerForm: ['Button', 'Input'],
};

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

    it.each([
        'AirdropForm',
        'BatchComposerForm',
        'MessagingInbox',
        'ParallelComposer',
        'PublishFileForm',
    ])('%s uses kit controls instead of native buttons, selects, and textareas', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).not.toMatch(/<(?:button|select|textarea)\b/);
    });

    it('documents the native checkbox and radio exceptions', () => {
        const source = ['ParallelComposer', 'PublishFileForm']
            .map((routeName) => readFileSync(
                resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
                'utf8',
            ))
            .join('\n');
        const inputs = source.match(/<input\b/g) || [];
        const rationales = source.match(/The kit has no (?:checkbox|radio) primitive/g) || [];

        expect(inputs).toHaveLength(4);
        expect(rationales).toHaveLength(inputs.length);
    });

    it.each(Object.entries(styleGuideRoutes))('%s uses kit form and action controls', (routeName, controls) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        for (const control of controls) {
            expect(source).toMatch(new RegExp(`<${control}\\b`));
        }
        expect(source).not.toMatch(/<(?:select|textarea)\b/);
    });

    it('limits native controls in the adopted routes to documented semantic exceptions', () => {
        const expectedInputs = { ControllerBindForm: 1, ListCreateForm: 1, MultisigCreate: 1 };
        const expectedButtons = { AccountPicker: 1, MarketActivity: 1 };

        for (const routeName of Object.keys(styleGuideRoutes)) {
            const source = readFileSync(
                resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
                'utf8',
            );
            const nativeInputs = source.match(/<input\b/g) || [];
            const inputRationales = source.match(/The kit has no (?:checkbox|radio) primitive/g) || [];
            const nativeButtons = source.match(/<button\b/g) || [];
            const rowRationales = source.match(/Clickable list rows stay native buttons/g) || [];

            expect(nativeInputs, routeName).toHaveLength(expectedInputs[routeName] || 0);
            expect(inputRationales, routeName).toHaveLength(nativeInputs.length);
            expect(nativeButtons, routeName).toHaveLength(expectedButtons[routeName] || 0);
            expect(rowRationales, routeName).toHaveLength(nativeButtons.length);
        }
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
    it('uses style-guide controls throughout wallet setup routes', () => {
        const importSource = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/ImportWallet.jsx'),
            'utf8',
        );
        const createSource = readFileSync(
            resolve(process.cwd(), 'packages/core/src/shared/routes/CreateWallet.jsx'),
            'utf8',
        );

        expect(importSource).toMatch(/\bTextarea\b/);
        expect(importSource).toMatch(
            /import\s+\{\s*ClipboardPasteButton\s*\}\s+from\s+'\.\.\/\.\.\/ui\/ClipboardPasteButton\.jsx'/,
        );
        expect(importSource).not.toMatch(/<textarea\b|<select\b/);
        expect(importSource.match(/<button\b/g)).toHaveLength(3);
        expect(importSource.match(/role="tab"/g)).toHaveLength(3);
        expect(createSource).not.toMatch(/<button\b|<textarea\b|<select\b/);
    });
});
