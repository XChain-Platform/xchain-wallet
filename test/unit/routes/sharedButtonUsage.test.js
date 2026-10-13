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

const styleGuideRoutes = [
    'BetFeedDetail',
    'CoSignerAccountList',
    'CoinpayForm',
    'ComposeMessage',
    'DeployContractForm',
    'DispenserExplorer',
    'DispensersList',
    'GovernancePolls',
];

const nativeRowButtonRoutes = new Set([
    'CoSignerAccountList',
    'CoinpayForm',
    'GovernancePolls',
]);

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

    it.each(styleGuideRoutes)('%s uses kit controls except documented row buttons', (routeName) => {
        const source = readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );

        expect(source).not.toMatch(/<(?:input|select|textarea)\b/);
        const nativeButtons = source.match(/<button\b/g) || [];
        if (nativeRowButtonRoutes.has(routeName)) {
            expect(nativeButtons).toHaveLength(1);
            expect(source).toMatch(/native row button keeps the whole .* card as one target/);
        } else {
            expect(nativeButtons).toHaveLength(0);
        }
    });
});
