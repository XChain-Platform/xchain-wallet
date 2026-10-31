// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as spec from '../../../../packages/bridge-spec/src/index.ts';
import * as runtime from '../../../../packages/bridge-spec/src/runtime.js';
import { BUNDLED_DESCRIPTORS } from '../../../../packages/core/src/registry/index.js';
import { resolveAutoApproveScope } from '../../../../packages/core/src/shared/utils/originAutoApprove.js';
import { EXAMPLE_CONNECT_OPTS } from '../../../../packages/test-dapp/src/example.ts';
import { MockXChainProvider } from '../../../../packages/test-dapp/src/mock-provider.ts';

const messaging = vi.hoisted(() => ({
    getSettings: vi.fn(async () => ({})),
    resolveApproval: vi.fn(async () => ({ approved: true })),
}));
vi.mock('../../../../packages/extension/src/approval/messaging.js', () => messaging);

const { ConnectApproval } = await import(
    '../../../../packages/extension/src/approval/kinds/ConnectApproval.jsx'
);

const bridgeSpecSource = readFileSync(
    join(process.cwd(), 'packages/bridge-spec/src/index.ts'),
    'utf8',
);
const injectSource = readFileSync(
    join(process.cwd(), 'packages/extension/src/inject/xchainProvider.js'),
    'utf8',
);

function interfaceMembers() {
    const match = bridgeSpecSource.match(/export interface XChainProvider \{([\s\S]*?)\n\}/);
    expect(match, 'XChainProvider interface is present').not.toBeNull();
    const lines = match[1].split('\n');
    const properties = lines
        .map((line) => /^ {4}readonly\s+(\w+)/.exec(line)?.[1])
        .filter(Boolean);
    const methods = lines
        .map((line) => /^ {4}(\w+)(?:<.*>)?\s*\(/.exec(line)?.[1])
        .filter(Boolean);
    return { properties, methods };
}

function literal(name) {
    const match = injectSource.match(new RegExp(`const ${name} = '([^']+)';`));
    expect(match, `inject provider declares ${name}`).not.toBeNull();
    return match[1];
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    messaging.getSettings.mockResolvedValue({});
    messaging.resolveApproval.mockResolvedValue({ approved: true });
});

describe('provider interface conformance', () => {
    it('implements every declared provider member in the mock and inject script', () => {
        const { properties, methods } = interfaceMembers();
        expect(properties).toEqual(['version', 'isXChainWallet']);
        expect(methods).toContain('connect');
        expect(methods).toContain('coSign');
        expect(methods.length).toBeGreaterThanOrEqual(15);

        const mock = new MockXChainProvider();
        for (const property of properties) expect(property in mock, property).toBe(true);
        for (const method of methods) {
            expect(typeof MockXChainProvider.prototype[method], method).toBe('function');
            expect(injectSource, method).toMatch(new RegExp(`\\b${method}\\s*\\(`));
        }
    });

    it('serves approved and rejected coSign results from the mock', async () => {
        const provider = new MockXChainProvider();
        await provider.connect(EXAMPLE_CONNECT_OPTS);
        const params = {
            chainId: 'bitcoin-regtest',
            aggregateAddress: 'aggregate-address',
            psbtHex: '70736274ff',
            agentPublicNonce: 'agent-nonce',
        };
        await expect(provider.coSign(params)).resolves.toMatchObject({
            ok: true,
            approved: true,
            action: 'SEND',
        });

        const rejecting = new MockXChainProvider({ rejectAll: true });
        await rejecting.connect(EXAMPLE_CONNECT_OPTS);
        await expect(rejecting.coSign(params)).resolves.toEqual({
            ok: false,
            error: 'USER_REJECTED',
        });
    });
});

describe('reference dApp chain ids', () => {
    it('offers, preselects, and grants the example requested chain', async () => {
        const chainId = EXAMPLE_CONNECT_OPTS.requestedChains[0];
        const descriptor = BUNDLED_DESCRIPTORS.find(({ id }) => id === chainId);
        expect(descriptor, 'example requests a bundled chain id').toBeTruthy();
        const close = vi.spyOn(window, 'close').mockImplementation(() => {});

        render(<ConnectApproval
            id="example-connect"
            payload={{
                origin: 'https://example.invalid',
                ...EXAMPLE_CONNECT_OPTS,
                accountOptions: [{ id: 'acct-1', name: 'Primary' }],
            }}
            onReject={() => {}}
        />);
        const checkbox = screen.getByLabelText(
            `Allow ${descriptor.displayName} ${descriptor.networkKind}`,
        );
        expect(checkbox.checked).toBe(true);
        expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled();
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })));

        expect(messaging.resolveApproval).toHaveBeenCalledWith(
            'example-connect',
            expect.objectContaining({ chains: [chainId] }),
        );
        close.mockRestore();
    });

    it('uses the same chain ids in auto-approve and the reference mock', async () => {
        const requestedChains = EXAMPLE_CONNECT_OPTS.requestedChains;
        expect(resolveAutoApproveScope({
            requestedChains,
            activeChainIds: requestedChains,
            accountIds: ['acct-1'],
        })).toEqual({ chains: requestedChains, accounts: ['acct-1'] });

        const provider = new MockXChainProvider();
        await expect(provider.connect(EXAMPLE_CONNECT_OPTS)).resolves.toMatchObject({
            ok: true,
            chains: requestedChains,
            permissions: { chains: requestedChains },
        });
        await expect(provider.connect({ requestedChains: ['bitcoin'] })).resolves.toEqual({
            ok: false,
            error: 'USER_REJECTED',
        });
    });
});

describe('single-source bridge runtime', () => {
    it('shares reference-client implementations between typed and runtime exports', () => {
        const names = [
            'PROVIDER_READY_EVENT',
            'isXChainAvailable',
            'getProvider',
            'generateNonce',
            'makeSignInParams',
            'validateSignInChallenge',
        ];
        for (const name of names) expect(spec[name], name).toBe(runtime[name]);
    });

    it('pins inject literals to the published bridge constants', () => {
        expect(literal('VERSION')).toBe(runtime.BRIDGE_SPEC_VERSION);
        expect(literal('READY_EVENT')).toBe(runtime.PROVIDER_READY_EVENT);
        expect(runtime.BRIDGE_SUPPORTED_VERSIONS).toContain(runtime.BRIDGE_SPEC_VERSION);
    });
});
