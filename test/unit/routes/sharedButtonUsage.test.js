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

    it('uses style guide controls in the market, contact, preference, and token lists', () => {
        const readRoute = (routeName) => readFileSync(
            resolve(process.cwd(), `packages/core/src/shared/routes/${routeName}.jsx`),
            'utf8',
        );
        const markets = readRoute('MarketsList');
        const contacts = readRoute('ContactsList');
        const preferences = readRoute('AddressPreferencesForm');
        const tokens = readRoute('MyTokens');

        expect(markets).toMatch(/<Input\b/);
        expect(markets).toMatch(/<Button\b/);
        expect(markets.match(/<button\b/g)).toHaveLength(1);
        expect(markets).toMatch(/<button[\s\S]*?role="tab"/);

        for (const component of ['AddressField', 'Input', 'Select', 'Textarea', 'Button', 'EmptyState', 'SectionHeader']) {
            expect(contacts).toContain(`<${component}`);
        }
        expect(contacts).not.toMatch(/<(?:button|input|select|textarea)\b/);

        expect(preferences).toMatch(/<FormSection\b/);
        expect(preferences).toMatch(/<FeeSelector\b/);
        expect(preferences).not.toMatch(/<(?:button|select|textarea)\b/);
        expect(preferences.match(/<input\b/g)).toHaveLength(5);
        expect(preferences.match(/type="(?:radio|checkbox)"/g)).toHaveLength(5);

        expect(tokens).toMatch(/<Input\b/);
        expect(tokens).toMatch(/<Button\b/);
        expect(tokens).toMatch(/<EmptyState\b/);
        expect(tokens.match(/<button\b/g)).toHaveLength(2);
        expect(tokens.match(/role="radio"/g)).toHaveLength(2);
    });
});
