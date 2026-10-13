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
