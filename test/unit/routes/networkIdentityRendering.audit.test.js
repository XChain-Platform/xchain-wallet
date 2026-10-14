// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROUTES = [
    'DelegateVoteForm.jsx',
    'DelegationActionForm.jsx',
    'DeployContractForm.jsx',
    'DestroyForm.jsx',
    'DispenserDetail.jsx',
    'DispenserExplorer.jsx',
    'DispenserForm.jsx',
    'DispensersList.jsx',
    'DividendForm.jsx',
    'ExecuteContractForm.jsx',
    'GatedPublishForm.jsx',
    'ImportWallet.jsx',
    'IssueTokenForm.jsx',
];

function routeSource(file) {
    return readFileSync(join(
        process.cwd(),
        'packages/core/src/shared/routes',
        file,
    ), 'utf8');
}

describe('route network identity rendering', () => {
    it.each(ROUTES)('%s does not render network-kind text', (file) => {
        const source = routeSource(file);

        expect(source).not.toContain('<NetworkField');
        expect(source).not.toContain('showNetworkKind');
        expect(source).not.toMatch(/\$\{[^}\n]*networkKind/);
        expect(source).not.toMatch(/\(\{(?:descriptor|d)\.networkKind\}\)/);
        expect(source).not.toMatch(/['"`](?:regtest|testnet|signet|Not mainnet)['"`]/i);
    });

    it.each(ROUTES)('%s does not render coin names or raw chain ids as badges', (file) => {
        const source = routeSource(file);

        expect(source).not.toMatch(/descriptor\??\.displayName/);
        expect(source).not.toMatch(/<ChainBadge[^>]*\/>\s*:\s*(?:chainId|row\.chainId|<span>\{cid\}<\/span>)/);
        for (const [badge] of source.matchAll(/<ChainBadge\b[^>]*\/>/g)) {
            expect(badge).not.toContain('showNetworkKind');
        }
    });
});
