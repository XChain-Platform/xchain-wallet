// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import React from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as spec from '../../../../packages/connect/src/index.ts';
import * as runtime from '../../../../packages/connect/src/runtime.js';
import { BUNDLED_DESCRIPTORS } from '../../../../packages/core/src/registry/index.js';
import { resolveAutoApproveScope } from '../../../../packages/core/src/shared/utils/originAutoApprove.js';
import { EXAMPLE_CONNECT_OPTS } from '../../../../packages/test-dapp/src/example.ts';
import { MockXChainProvider } from '../../../../packages/test-dapp/src/mock-provider.ts';
import {
    createBridgeEventBroadcaster,
    noopBridgeEvents,
} from '../../../../packages/extension/src/bridge/bridgeEvents.js';

const messaging = vi.hoisted(() => ({
    getSettings: vi.fn(async () => ({})),
    resolveApproval: vi.fn(async () => ({ approved: true })),
}));
vi.mock('../../../../packages/core/src/shared/approval/index.js', () => messaging);

const { ConnectApproval } = await import(
    '../../../../packages/core/src/shared/approval/ConnectApproval.jsx'
);

const bridgeSpecSource = readFileSync(
    join(process.cwd(), 'packages/connect/src/index.ts'),
    'utf8',
);
const injectSource = readFileSync(
    join(process.cwd(), 'packages/extension/src/inject/xchainProvider.js'),
    'utf8',
);
const contentSource = readFileSync(
    join(process.cwd(), 'packages/extension/src/content/contentScript.js'),
    'utf8',
);
const handlersSource = readFileSync(
    join(process.cwd(), 'packages/extension/src/bridge/handlers.js'),
    'utf8',
);
const platformSpecPath = [
    join(process.cwd(), '..', 'platform-root', 'claude', 'specs', 'living', 'XCHAIN_WALLET_SPEC.md'),
    join(process.cwd(), '..', 'claude', 'specs', 'living', 'XCHAIN_WALLET_SPEC.md'),
].find(existsSync);
const platformSpecSource = platformSpecPath ? readFileSync(platformSpecPath, 'utf8') : null;
if (!platformSpecSource) console.warn('SKIP: living wallet spec is absent from this checkout');

function interfaceFieldNames(name) {
    const match = bridgeSpecSource.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
    expect(match, `${name} interface is present`).not.toBeNull();
    return [...match[1].matchAll(/^ {4}(\w+)\??:/gm)].map((field) => field[1]).sort();
}

function functionBody(source, name) {
    const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n    \\}`));
    expect(match, `${name} function is present`).not.toBeNull();
    return match[1];
}

function comparedEventNames(source, pattern, description) {
    const names = [...source.matchAll(pattern)].map((match) => match[1]);
    expect(names.length, `${description} has event branches`).toBeGreaterThan(0);
    return [...new Set(names)].sort();
}

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

function specSection(start, end) {
    const from = platformSpecSource.indexOf(start);
    const to = platformSpecSource.indexOf(end, from + start.length);
    expect(from, `${start} exists`).toBeGreaterThanOrEqual(0);
    expect(to, `${end} follows ${start}`).toBeGreaterThan(from);
    return platformSpecSource.slice(from, to);
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

    it('pins every request-path method list to XChainProvider', () => {
        const expected = interfaceMembers().methods
            .filter((method) => method !== 'on' && method !== 'off')
            .sort();
        expect(expected.length).toBeGreaterThanOrEqual(13);
        // `login` is the named request-path alias of `signIn`.
        const expectedRequestPaths = [...expected, 'login'].sort();
        const inject = [...injectSource.matchAll(/\b(?:send|sendResult)\(\s*'bridge\.(\w+)'/g)]
            .map((match) => match[1]).sort();
        const publicBody = contentSource.match(/const PUBLIC_TYPES = new Set\(\[([\s\S]*?)\]\);/);
        expect(publicBody, 'content script declares PUBLIC_TYPES').not.toBeNull();
        const publicEntries = [...publicBody[1].matchAll(/'([^']+)'/g)]
            .map((match) => match[1]);
        expect(publicEntries.every((entry) => entry.startsWith('bridge.'))).toBe(true);
        const publicTypes = publicEntries.map((entry) => entry.slice('bridge.'.length)).sort();
        const registered = [...handlersSource.matchAll(/\bregister\(\s*'bridge\.(\w+)'/g)]
            .map((match) => match[1]).sort();
        expect([...new Set(inject)]).toEqual(expectedRequestPaths);
        expect([...new Set(publicTypes)]).toEqual(expectedRequestPaths);
        expect([...new Set(registered)]).toEqual(expectedRequestPaths);
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

    it('matches mock connect results to the published success shape', async () => {
        const result = await new MockXChainProvider().connect();
        expect(result.ok).toBe(true);
        expect(Object.keys(result).sort()).toEqual(interfaceFieldNames('ConnectSuccess'));
        expect(result.supportedVersions).toEqual(runtime.BRIDGE_SUPPORTED_VERSIONS);
        expect(result.supportedVersions).toContain(result.version);
    });

    it('matches wallet version negotiation on the reference mock', async () => {
        for (const range of ['^0.1.0', '0.1.0', '~0.1.0', '^9.8.7', 'garbage', '', undefined]) {
            const result = await new MockXChainProvider().connect({ requiredBridgeVersion: range });
            expect(result.ok, String(range)).toBe(runtime.isBridgeVersionSupported(range));
            if (!result.ok) expect(result.error).toBe('BRIDGE_VERSION_MISMATCH');
        }
        const refused = new MockXChainProvider();
        await expect(refused.connect({ requiredBridgeVersion: '^9.8.7' }))
            .resolves.toEqual({ ok: false, error: 'BRIDGE_VERSION_MISMATCH' });
        await expect(refused.getAccounts()).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
    });

    it('resolves unconnected result methods with NOT_CONNECTED', async () => {
        const provider = new MockXChainProvider({
            throttle: { retryAfterMs: 10 },
            rejectAll: true,
        });
        const calls = [
            () => provider.signMessage({ chainId: 'bitcoin-regtest', address: 'a', message: 'm' }),
            () => provider.signAction({ chainId: 'bitcoin-regtest', action: 'SEND', params: {} }),
            () => provider.signPsbt({ chainId: 'bitcoin-regtest', psbtHex: '00', signingPaths: [] }),
            () => provider.coSign({ chainId: 'bitcoin-regtest', aggregateAddress: 'a', psbtHex: '00' }),
            () => provider.signIn({ appId: 'app' }),
        ];
        for (const call of calls) {
            await expect(call()).resolves.toEqual({ ok: false, error: 'NOT_CONNECTED' });
        }
        await expect(provider.parallel([{ chainId: 'bitcoin-regtest', action: 'SEND', params: {} }]))
            .rejects.toMatchObject({ name: 'BridgeError', code: 'NOT_CONNECTED' });
    });

    it('rejects unconnected reads with a published code', async () => {
        const provider = new MockXChainProvider();
        const reads = [
            () => provider.getAccounts(),
            () => provider.getAddresses('bitcoin-regtest'),
            () => provider.getBalances('bitcoin-regtest', 'a'),
            () => provider.getActiveChains(),
        ];
        for (const read of reads) {
            await expect(read()).rejects.toMatchObject({ name: 'BridgeError', code: 'NOT_CONNECTED' });
        }
        await expect(provider.getSupportedChains()).resolves.toHaveLength(1);
    });

    it('matches mock sign-in filters to the published parameters', async () => {
        const chains = ['bitcoin-regtest', 'litecoin-regtest'];
        const descriptors = chains.map((id) => BUNDLED_DESCRIPTORS.find((item) => item.id === id));
        expect(descriptors.every(Boolean), 'mock chains have bundled descriptors').toBe(true);
        const provider = new MockXChainProvider({
            activeChains: chains,
            supportedChains: descriptors,
            addresses: {
                'bitcoin-regtest': [{ id: 'btc', accountId: null, chain: 'bitcoin', network: 'regtest', addressType: 'p2wpkh', address: 'btc-address', label: 'BTC' }],
                'litecoin-regtest': [{ id: 'ltc', accountId: null, chain: 'litecoin', network: 'regtest', addressType: 'p2wpkh', address: 'ltc-address', label: 'LTC' }],
            },
        });
        await provider.connect({ requestedChains: chains });

        expect(interfaceFieldNames('SignInParams')).toEqual(['appId', 'chainId', 'chains', 'expiresInMs', 'nonce']);
        await expect(provider.signIn({ appId: 'example', chainId: 'litecoin-regtest' }))
            .resolves.toMatchObject({ ok: true, address: 'ltc-address', chainId: 'litecoin-regtest' });
        await expect(provider.signIn({ appId: 'example', chains: ['litecoin'] }))
            .resolves.toMatchObject({ ok: true, address: 'ltc-address', chainId: 'litecoin-regtest' });
        await expect(provider.signIn({ appId: 'example', chainId: 'dogecoin-regtest' }))
            .resolves.toEqual({ ok: false, error: 'ADDRESS_NOT_AUTHORIZED' });
        await expect(provider.signIn({ appId: 'example' }))
            .resolves.toMatchObject({ ok: true, address: 'btc-address', chainId: 'bitcoin-regtest' });
    });

    it('pins the mock sign-in default expiry to the spec and refuses an invalid window', async () => {
        const descriptor = BUNDLED_DESCRIPTORS.find((item) => item.id === 'bitcoin-regtest');
        const provider = new MockXChainProvider({
            activeChains: ['bitcoin-regtest'],
            supportedChains: [descriptor],
            addresses: {
                'bitcoin-regtest': [{ id: 'btc', accountId: null, chain: 'bitcoin', network: 'regtest', addressType: 'p2wpkh', address: 'btc-address', label: 'BTC' }],
            },
        });
        await provider.connect({ requestedChains: ['bitcoin-regtest'] });

        const signed = await provider.signIn({ appId: 'example' });
        expect(signed.ok).toBe(true);
        expect(signed.challengeParts.expiresAt - signed.challengeParts.timestamp)
            .toBe(runtime.SIGN_IN_DEFAULT_EXPIRY_MS);
        for (const expiresInMs of [0, -1, Number.NaN, 'abc']) {
            await expect(provider.signIn({ appId: 'example', expiresInMs }))
                .resolves.toEqual({ ok: false, error: 'INVALID_PARAMS' });
        }
        for (const appId of [undefined, null, '', 5, true, {}, []]) {
            await expect(provider.signIn({ appId }))
                .resolves.toEqual({ ok: false, error: 'INVALID_PARAMS' });
        }
    });
});

describe.skipIf(!platformSpecSource)('living spec conformance', () => {
    it('keeps the provider surface and result summaries current', () => {
        const section = specSection('### 43.2', '### 43.3');
        const fence = section.match(/```ts\n([\s\S]*?)```/);
        expect(fence, 'section 43.2 has a TypeScript fence').not.toBeNull();
        const methods = [...fence[1].matchAll(/^\s{2}(\w+)(?:<.*>)?\s*\(/gm)]
            .map((match) => match[1]).sort();
        expect(methods).toEqual(interfaceMembers().methods.sort());
        expect(section).toMatch(/signMessage\(\{ chainId, address, message/);
        expect(section).toMatch(/actionIndex\?[^\n]*optional/);
        expect(section).toMatch(/signPsbt[^\n]*does not broadcast/);
        expect(section).toMatch(/supportedVersions[^\n]*permissions/);
    });

    it('names every SignInParams field in the signIn summary bullet', () => {
        const section = specSection('### 43.2', '### 43.3');
        const bullet = section.split('\n').find((line) => line.startsWith('- **`signIn('));
        expect(bullet, 'section 43.2 has a signIn bullet').toBeTruthy();
        const signature = bullet.match(/signIn\(\{([^}]*)\}\)/);
        expect(signature, 'signIn bullet lists its params').not.toBeNull();
        const listed = signature[1].split(',').map((field) => field.trim().replace(/\?$/, '')).sort();
        expect(listed).toEqual(interfaceFieldNames('SignInParams'));
    });

    it('keeps the sign-in challenge on the validated v2 format', () => {
        const section = specSection('### 43.6', '### 43.7');
        expect(section).toContain(runtime.SIGN_IN_CHALLENGE_PREFIX);
        expect(section).not.toMatch(/XChain Sign-In \|/);
        expect(section).toContain('validateSignInChallenge');
        expect(section).toMatch(/MUST[^\n]*origin/);
        for (const field of interfaceFieldNames('SignInSuccess')) {
            expect(section, `SignInSuccess.${field}`).toContain(field);
        }
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
        fireEvent.click(screen.getByRole('button', { name: /^Networks it can see/ }));
        const checkbox = screen.getByLabelText(
            `Allow ${descriptor.displayName}`,
        );
        expect(checkbox.checked).toBe(true);
        fireEvent.click(screen.getByRole('button', { name: 'Back to previous screen' }));
        expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled();
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve' })));

        expect(messaging.resolveApproval).toHaveBeenCalledWith(
            'example-connect',
            expect.objectContaining({ chains: expect.arrayContaining([chainId]) }),
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
            'validateSignInChallenge',
        ];
        for (const name of names) expect(spec[name], name).toBe(runtime[name]);
    });

    it('pins inject literals to the published bridge constants', () => {
        expect(literal('VERSION')).toBe(runtime.BRIDGE_SPEC_VERSION);
        expect(literal('READY_EVENT')).toBe(runtime.PROVIDER_READY_EVENT);
        expect(runtime.BRIDGE_SUPPORTED_VERSIONS).toContain(runtime.BRIDGE_SPEC_VERSION);
    });

    it('pins every event-name copy to BridgeEventMap', () => {
        const expected = interfaceFieldNames('BridgeEventMap');
        expect(expected).toContain('accountsChanged');
        const setBody = injectSource.match(/const EVENT_NAMES = new Set\(\[([^\]]+)\]\);/);
        expect(setBody, 'inject provider declares EVENT_NAMES').not.toBeNull();
        const injectNames = [...setBody[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
        const payloadNames = comparedEventNames(
            functionBody(injectSource, 'isEventPayload'),
            /event === '([^']+)'/g,
            'isEventPayload',
        );
        const relayNames = comparedEventNames(
            functionBody(contentSource, 'isBridgeEvent'),
            /message\.event === '([^']+)'/g,
            'isBridgeEvent',
        );
        const broadcasterNames = Object.keys(createBridgeEventBroadcaster({}));
        const noopNames = Object.keys(noopBridgeEvents);
        expect(broadcasterNames).toContain('walletSwitched');
        expect(noopNames).toContain('walletSwitched');
        expect(injectNames).toEqual(expected);
        expect(payloadNames).toEqual(expected);
        expect(relayNames).toEqual(expected);
        expect(broadcasterNames.filter((name) => name !== 'walletSwitched').sort()).toEqual(expected);
        expect(noopNames.filter((name) => name !== 'walletSwitched').sort()).toEqual(expected);
    });
});
