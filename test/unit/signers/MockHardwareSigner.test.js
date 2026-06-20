// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Vitest unit suite for the MockHardwareSigner test scaffolding (G162).
//
// Asserts the mock satisfies the abstract Signer contract enough that
// any test wiring it through `submitWithSigner` / `signPsbtFlow` /
// `useSignerInfo` would not hit AbstractMethodError. Also verifies the
// status-transition path (driven by `setStatus`) fires listener events.

import { describe, expect, it, vi } from 'vitest';
import {
    MockHardwareSigner,
    makeMockTrezorSigner,
    makeMockLedgerSigner,
} from './MockHardwareSigner.js';
import { Signer } from '../../../packages/core/src/signers/Signer.js';

describe('MockHardwareSigner', () => {
    it('extends the abstract Signer base', () => {
        const signer = new MockHardwareSigner();
        expect(signer).toBeInstanceOf(Signer);
    });

    it('exposes a stable id, displayName, kind, vendor, model, firmware', () => {
        const signer = new MockHardwareSigner({
            vendor: 'trezor',
            id: 'mock-trezor-test',
            model: 'Model T',
            firmwareVersion: '2.6.0',
        });
        expect(signer.id).toBe('mock-trezor-test');
        expect(signer.displayName).toMatch(/Trezor/);
        expect(signer.kind).toBe('trezor');
        expect(signer.vendor).toBe('trezor');
        expect(signer.model).toBe('Model T');
        expect(signer.firmwareVersion).toBe('2.6.0');
    });

    it('the trezor + ledger factories default the vendor', () => {
        expect(makeMockTrezorSigner().vendor).toBe('trezor');
        expect(makeMockLedgerSigner().vendor).toBe('ledger');
    });

    it('getStatus returns the configured status and increments the call counter', async () => {
        const signer = new MockHardwareSigner({ status: 'available' });
        expect(await signer.getStatus()).toBe('available');
        expect(await signer.getStatus()).toBe('available');
        expect(signer.calls.getStatus).toBe(2);
    });

    it('setStatus drives transitions and notifies subscribers', async () => {
        const signer = new MockHardwareSigner();
        const listener = vi.fn();
        const unsubscribe = signer.subscribe(listener);
        signer.setStatus('disconnected', 'unplugged');
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenLastCalledWith('disconnected', 'unplugged');
        expect(await signer.getStatus()).toBe('disconnected');
        unsubscribe();
        signer.setStatus('available');
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('getAddresses synthesizes deterministic rows when no override is supplied', async () => {
        const signer = new MockHardwareSigner({ vendor: 'ledger' });
        const rows = await signer.getAddresses({
            chainId: 'bitcoin-mainnet',
            accountIndex: 0,
            change: 0,
            startIndex: 5,
            count: 3,
        });
        expect(rows).toHaveLength(3);
        expect(rows[0].index).toBe(5);
        expect(rows[2].index).toBe(7);
        expect(rows[0].address).toContain('mock-ledger-addr');
        expect(rows[0].path).toMatch(/^m\/84'\/0'\//);
        expect(signer.calls.getAddresses).toBe(1);
    });

    it('getAddresses honours a caller-supplied override fn', async () => {
        const override = vi.fn(() => [
            { index: 0, address: 'bc1q-custom', publicKey: '02aa', path: "m/0'/0/0" },
        ]);
        const signer = new MockHardwareSigner({ getAddresses: override });
        const rows = await signer.getAddresses({ count: 1 });
        expect(rows[0].address).toBe('bc1q-custom');
        expect(override).toHaveBeenCalledWith({ count: 1 });
    });

    it('signPsbt returns the canned envelope shape and counts calls', async () => {
        const signer = new MockHardwareSigner();
        const result = await signer.signPsbt({
            psbtHex: '70736274ff',
            chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/84'/0'/0'/0/0" }],
        });
        expect(result).toMatchObject({
            signedPsbtHex: expect.any(String),
            txHex: expect.any(String),
            txid: expect.any(String),
        });
        expect(result.txid).toHaveLength(64);
        expect(signer.calls.signPsbt).toBe(1);
    });

    it('signPsbt routes through a caller-supplied result fn when provided', async () => {
        const result = { signedPsbtHex: 'cafe', txHex: 'beef', txid: 'a'.repeat(64) };
        const signer = new MockHardwareSigner({ signPsbtResult: () => result });
        await expect(signer.signPsbt({})).resolves.toEqual(result);
    });

    it('signMessage returns canned signature hex', async () => {
        const signer = new MockHardwareSigner();
        const out = await signer.signMessage({
            message: 'hi',
            chainId: 'bitcoin-mainnet',
            path: "m/84'/0'/0'/0/0",
        });
        expect(out.signature).toMatch(/^[0-9a-f]+$/);
        expect(signer.calls.signMessage).toBe(1);
    });

    it('getPublicKey returns canned triple', async () => {
        const signer = new MockHardwareSigner();
        const out = await signer.getPublicKey({
            chainId: 'bitcoin-mainnet',
            path: "m/84'/0'/0'/0/0",
        });
        expect(out).toMatchObject({
            publicKey: expect.any(String),
            chainCode: expect.any(String),
            fingerprint: expect.any(String),
        });
        expect(out.publicKey).toHaveLength(66);
        expect(signer.calls.getPublicKey).toBe(1);
    });

    it('requiresPhysicalConfirmation defaults to true (HW-style behaviour)', () => {
        expect(new MockHardwareSigner().requiresPhysicalConfirmation).toBe(true);
        expect(new MockHardwareSigner({ requiresPhysicalConfirmation: false })
            .requiresPhysicalConfirmation).toBe(false);
    });
});
