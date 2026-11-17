// @vitest-environment jsdom
// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash, randomBytes } from 'node:crypto';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const formHooks = vi.hoisted(() => ({
    start: vi.fn(),
    multipart: {
        options: {
            taproot: { reason: null, cap: 67_108_864, multipart: true, pending: false, summary: '2 parts, 7 transactions', fee: 100 },
            standard: { reason: 'tooLarge', cap: 259_648, multipart: false, pending: false, summary: null, fee: null },
        },
        reasons: { taproot: null, standard: 'tooLarge' },
        ready: true,
        error: null,
        loading: false,
    },
}));

vi.mock('../../../packages/core/src/flows/gatedStoredBytes.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, encryptGatedStoredBytes: vi.fn(actual.encryptGatedStoredBytes) };
});

vi.mock('@noble/hashes/sha2', async () => {
    const { createHash: nodeHash } = await import('node:crypto');
    return {
        sha256: (bytes) => Uint8Array.from(nodeHash('sha256').update(bytes).digest()),
    };
});

vi.mock('../../../packages/core/src/shared/hooks/useMultipartUploadMethod.js', () => ({
    useMultipartUploadMethod: vi.fn(() => formHooks.multipart),
}));

vi.mock('../../../packages/core/src/shared/hooks/useMultipartUploadPanel.js', () => ({
    useMultipartUploadPanel: vi.fn(() => ({
        start: formHooks.start,
        result: null,
        running: false,
        panelProps: null,
        fileInput: null,
        resumeReason: null,
        error: null,
        listError: null,
    })),
}));

import { gatedPublishMultipartStart } from '../../../packages/core/src/flows/gatedPublishAction.js';
import { planMultipartFile } from '../../../packages/core/src/flows/multipartFilePlan.js';
import { gatedManifestActionData } from '../../../packages/core/src/flows/gatedMultipartManifest.js';
import { encryptGatedStoredBytes } from '../../../packages/core/src/flows/gatedStoredBytes.js';
import { MessagingProvider } from '../../../packages/core/src/shared/MessagingProvider.jsx';
import { GatedPublishForm } from '../../../packages/core/src/shared/routes/GatedPublishForm.jsx';

const KEY = new Uint8Array(32).fill(7);
const KEY_HASH = createHash('sha256').update(KEY).digest('hex');
const IV = new Uint8Array(12).fill(3);
const FROM = Object.freeze({
    id: 'issuer', address: 'bcrt1qissuer', publicKey: `02${'ab'.repeat(32)}`,
    addressType: 'p2wpkh', source: 'hd', signerId: 'signer-1',
});
const META = Object.freeze({
    name: 'members.bin', type: 'application/octet-stream', title: 'Members', memo: '',
});
const SUPPORT = Object.freeze({ supported: true, lane: 'envelope', buildMode: 'one_call' });

function multipartBytes() {
    const blockBytes = 20_000;
    const blocks = 23;
    const bytes = new Uint8Array(blockBytes * blocks * 2);
    for (let index = 0; index < blocks; index += 1) {
        const block = new Uint8Array(randomBytes(blockBytes));
        const offset = index * blockBytes * 2;
        bytes.set(block, offset);
        bytes.set(block, offset + blockBytes);
    }
    return bytes;
}

function start(bytes, overrides = {}) {
    return gatedPublishMultipartStart({
        walletId: 'wallet-1', chainId: 'bitcoin-regtest', from: FROM,
        bytes, meta: META, singleTransactionCap: 300_000, support: SUPPORT,
        gate: { ticker: 'GATE', minAmount: '2.5' }, rate: 2,
        ...overrides,
    });
}

function manifestSdk() {
    return {
        gatedFile: { serializeKeyPayload: vi.fn(() => Buffer.from([1, ...KEY])) },
        messaging: { eciesEncryptBytes: vi.fn(() => ({ ciphertext: 'key-ciphertext' })) },
    };
}

function formMessaging() {
    return {
        getAddressesByChain: vi.fn().mockResolvedValue({ 'bitcoin-regtest': [FROM] }),
        getOwnedTokens: vi.fn().mockResolvedValue([{ tick: 'GATE' }]),
        getSettings: vi.fn().mockResolvedValue({ walletMode: 'full' }),
        signerReady: vi.fn().mockResolvedValue({ ready: true }),
        getSignerStatus: vi.fn().mockResolvedValue({ status: 'unlocked' }),
        listGatedKeys: vi.fn().mockResolvedValue([]),
        getTokenInfo: vi.fn().mockResolvedValue({ creator: FROM.address, divisibility: 8 }),
        composeGatedPublishForConfirm: vi.fn(),
    };
}

function mountForm(messaging) {
    const form = React.createElement(GatedPublishForm, {
        walletId: 'wallet-1',
        chainId: 'bitcoin-regtest',
        tick: 'GATE',
        issuerAddress: FROM.address,
        onBack: () => {},
    });
    render(React.createElement(
        MessagingProvider,
        { shell: 'web', messaging },
        form,
    ));
}

afterEach(() => {
    cleanup();
    formHooks.start.mockReset();
});

describe('gated publish multipart path selection', () => {
    it('keeps a file within the selected carrier cap on the single path', () => {
        expect(start(new Uint8Array(1_000))).toEqual({
            path: 'single', maxBytes: 67_108_864,
        });
    });

    it('builds a key-free background request above the selected carrier cap', () => {
        const bytes = multipartBytes();
        const result = start(bytes, { existingKeyHash: KEY_HASH });
        expect(result).toMatchObject({
            path: 'multipart', lane: 'envelope', buildMode: 'one_call',
            request: {
                gate: { ticker: 'GATE', minAmount: '2.5' },
                existingKeyHash: KEY_HASH, rawData: expect.any(String),
            },
        });
        expect(result.request.rawData).toHaveLength(bytes.length);
        expect(JSON.stringify(result.request)).not.toContain('keyHex');
        expect(result.request.gate).not.toHaveProperty('key');
    });

    it('refuses to enter the gated path without a gate', () => {
        expect(() => start(multipartBytes(), { gate: null })).toThrow(
            expect.objectContaining({ code: 'GATED_MULTIPART_GATE_REQUIRED' }),
        );
    });
});

describe('gated publish form multipart wiring', () => {
    it('routes an oversized picked file through the gated upload panel', async () => {
        const messaging = formMessaging();
        const reply = { txid: 'multipart-tx', upload: { keyHash: KEY_HASH } };
        formHooks.start.mockResolvedValue(reply);
        mountForm(messaging);
        await waitFor(() => expect(screen.getByRole('button', { name: /^Token: GATE/ })).toBeEnabled());

        const bytes = multipartBytes();
        fireEvent.change(screen.getByLabelText('File to publish'), {
            target: { files: [new File([bytes], META.name, { type: META.type })] },
        });
        await screen.findByText((text) => text.startsWith(META.name));
        fireEvent.click(screen.getByRole('checkbox', { name: /forever|permanent/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Publish file' }));

        await waitFor(() => expect(formHooks.start).toHaveBeenCalledOnce());
        const [request, match] = formHooks.start.mock.calls[0];
        expect(request).toMatchObject({
            walletId: 'wallet-1', chainId: 'bitcoin-regtest',
            gate: { ticker: 'GATE', minAmount: '' }, rawData: expect.any(String),
        });
        expect(match.originalSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(messaging.composeGatedPublishForConfirm).not.toHaveBeenCalled();
    });
});

describe('gated publish multipart stored bytes', () => {
    it('compresses, encrypts once, and plans parts from the ciphertext', async () => {
        vi.mocked(encryptGatedStoredBytes).mockClear();
        const bytes = multipartBytes();
        const plan = await planMultipartFile(bytes, META, {
            carrier: 'envelope',
            gate: { ticker: 'GATE', minAmount: '2.5', key: KEY, iv: IV },
        });
        expect(encryptGatedStoredBytes).toHaveBeenCalledOnce();
        expect(plan).toMatchObject({
            compressed: true, compression: '1', encryptionMethod: 1,
            keyHash: KEY_HASH, totalParts: 2,
        });
        expect(plan.totalBytes).toBe(plan.storedBytes.length);
        expect(Buffer.concat(plan.parts.map(({ rawData }) => Buffer.from(rawData))))
            .toEqual(Buffer.from(plan.storedBytes));
        expect(plan.storedBytes.subarray(0, 12)).toEqual(IV);
        expect(plan.storedBytes).not.toEqual(bytes);
    });
});

describe('gated publish multipart manifest', () => {
    it('sends FILE version 1 and the MESSAGE version 2 key commit in one BATCH', async () => {
        const plan = await planMultipartFile(multipartBytes(), META, {
            carrier: 'envelope', gate: { ticker: 'GATE', key: KEY, iv: IV },
        });
        const sdk = manifestSdk();
        const buildManifest = gatedManifestActionData({
            sdk, key: KEY, publicKey: FROM.publicKey,
            coin: 'BTC', sourceAddress: FROM.address,
        });
        const action = buildManifest(plan.manifestParams);
        expect(action).toMatchObject({ action: 'BATCH', params: { VERSION: '0' } });
        expect(action.params.COMMAND).toContain(`FILE|1|${plan.fileHash}|2|`);
        expect(action.params.COMMAND).toContain(`|GATE|1|${KEY_HASH}||1;MESSAGE|2|BTC|`);
        expect(sdk.gatedFile.serializeKeyPayload).toHaveBeenCalledOnce();
        expect(sdk.messaging.eciesEncryptBytes).toHaveBeenCalledOnce();
    });
});
