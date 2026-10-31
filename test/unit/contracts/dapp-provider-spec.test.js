// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import specSource from '../../../packages/bridge-spec/src/index.ts?raw';
import { MockXChainProvider } from '../../../packages/test-dapp/src/mock-provider.ts';

function interfaceBody(name) {
    const start = `export interface ${name}`;
    const tail = specSource.split(start)[1];
    expect(tail, `${name} exists`).toBeTruthy();
    return tail.slice(tail.indexOf('{') + 1, tail.indexOf('\n}'));
}

describe('dApp provider type contract', () => {
    it('uses ChainId for connect requests and grants', () => {
        expect(interfaceBody('SitePermissions')).toMatch(/^\s+chains: ChainId\[\];/m);
        expect(interfaceBody('ConnectOpts')).toMatch(/^\s+requestedChains\?: ChainId\[\];/m);
        expect(interfaceBody('ConnectSuccess')).toMatch(/^\s+chains: ChainId\[\];/m);
    });

    it('marks every signPsbt field required by the handler as required', () => {
        const body = interfaceBody('SignPsbtParams');
        for (const field of ['chainId', 'psbtHex', 'signingPaths']) {
            expect(body, `${field} must not be optional`)
                .toMatch(new RegExp(`^\\s+${field}:`, 'm'));
        }
    });

    it('exposes every XChainProvider method on the reference mock', () => {
        const methods = [...interfaceBody('XChainProvider').matchAll(
            /^ {4}([A-Za-z]\w*)(?:<.*>)?\(/gm,
        )].map((match) => match[1]);
        const mockMethods = new Set(Object.getOwnPropertyNames(MockXChainProvider.prototype));

        expect(methods).toContain('coSign');
        expect(methods.length).toBeGreaterThan(10);
        expect(methods.filter((method) => !mockMethods.has(method))).toEqual([]);
    });
});
