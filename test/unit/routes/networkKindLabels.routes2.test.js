// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routes = [
    'CoSignerProvision',
    'CoinpayForm',
    'ComposeMessage',
    'ContactsList',
    'ContractDetail',
    'ContractFundsForm',
    'ContractStakeForm',
    'ContractsList',
    'ControllerBindForm',
    'CreateOrderForm',
    'CreatePollForm',
    'CrossChainOrderForm',
    'CrossChainSwapForm',
];

function routeSource(route) {
    return readFileSync(
        resolve(process.cwd(), `packages/core/src/shared/routes/${route}.jsx`),
        'utf8',
    );
}

function withoutComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

describe.each(routes)('%s network label rendering', (route) => {
    it('does not render network-kind copy or a raw chain id beside a chain icon', () => {
        const source = withoutComments(routeSource(route));
        const routeOwnedRender = source
            .split('\n')
            // Validation messages may name the chain; they are not rendered labels.
            .filter((line) => !line.includes('chainLabel=') && !line.includes('aria-label=') && !line.includes('setFormError('))
            .join('\n');

        expect(source).not.toMatch(/['"`]([^'"`]*(?:regtest|testnet|not mainnet)[^'"`]*)['"`]/i);
        expect(source).not.toMatch(
            /<ChainBadge\b[^>]*\/>\s*:\s*(?:<span[^>]*>)?\s*\{?(?:[\w?.]+chainId|cid)\b/i,
        );
        expect(routeOwnedRender).not.toMatch(/\b(?:descriptor|giveDescriptor|getDescriptor)\?*\.displayName\b/);
    });
});

describe('redundant chain badges', () => {
    it('keeps the co-signer picker as the only network control', () => {
        expect(routeSource('CoSignerProvision')).not.toContain('<ChainBadge');
    });

    it('does not repeat the contract chain in the detail header', () => {
        expect(routeSource('ContractDetail')).not.toContain('<ChainBadge');
    });
});
