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
    'DispensersList',
    'ListCreateForm',
    'MessagingInbox',
    'ParallelComposer',
    'PublishFileForm',
    'BatchComposerForm',
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
