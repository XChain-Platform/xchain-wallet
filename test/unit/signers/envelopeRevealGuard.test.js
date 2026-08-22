// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The envelope-reveal backstop, across every Signer implementation that
// cannot serve it.
//
// The defect: `submitWithSigner` dispatches `envelopeReveal: true` for the
// Taproot envelope reveal (a BIP341 script-path spend), and only
// RemoteSigner.signPsbt inspected it. The shells register the CONCRETE
// LedgerSigner/TrezorSigner as the live signer, so on desktop and in the
// popup the transport shim is not in the path at all: the device signers took
// the flag, ignored it, and failed several layers down with `unsupported
// input scriptType "p2tr"` or `input has only a witnessUtxo`. Fail-closed by
// accident, in the wrong words, in one of three implementations.
//
// NOT covered here, deliberately: the P2SH/P2WSH `reveal: true` flag. It is
// the other half of the original item and it is NOT guarded, because the two
// flags sit on opposite sides of the first broadcast. `envelopeReveal` is
// dispatched while nothing is on chain (submitWithSigner step 3b, before the
// commit), so a refusal costs an error; `reveal` is dispatched AFTER phase 1
// has been broadcast, so a refusal there completes the commit and never the
// reveal, which is a stranded-funds event. The negative case below pins that
// asymmetry so a later "let's guard both for symmetry" edit fails here first.

import { describe, it, expect, vi } from 'vitest';
import { assertCannotSignEnvelopeReveal, SignerStatusError }
    from '../../../packages/core/src/signers/Signer.js';
import { RemoteSigner } from '../../../packages/core/src/signers/RemoteSigner.js';
import { LedgerSigner } from '../../../packages/signers-ledger/src/LedgerSigner.js';
import { TrezorSigner } from '../../../packages/signers-trezor/src/TrezorSigner.js';

const PSBT = '70736274ff01' + '00'.repeat(8);

describe('assertCannotSignEnvelopeReveal', () => {
    it('throws a SignerStatusError when envelopeReveal is set', () => {
        expect(() => assertCannotSignEnvelopeReveal('sig-1', { envelopeReveal: true }))
            .toThrow(SignerStatusError);
        expect(() => assertCannotSignEnvelopeReveal('sig-1', { envelopeReveal: true }))
            .toThrow(/cannot sign a Taproot envelope reveal/);
    });

    it('passes an ordinary signPsbt param bag', () => {
        expect(() => assertCannotSignEnvelopeReveal('sig-1', { psbtHex: PSBT })).not.toThrow();
        expect(() => assertCannotSignEnvelopeReveal('sig-1', null)).not.toThrow();
        expect(() => assertCannotSignEnvelopeReveal('sig-1', undefined)).not.toThrow();
    });

    // The asymmetry is the point, not an oversight: see the file header.
    it('does NOT refuse the post-broadcast P2SH/P2WSH reveal flag', () => {
        expect(() => assertCannotSignEnvelopeReveal('sig-1', { reveal: true })).not.toThrow();
    });
});

describe('RemoteSigner refuses an envelope reveal before it reaches the transport', () => {
    it('throws without dispatching', async () => {
        const transport = vi.fn();
        const signer = new RemoteSigner({
            id: 'sig-1', displayName: 'My Ledger', kind: 'ledger', transport,
        });
        await expect(signer.signPsbt({ psbtHex: PSBT, chainId: 'bitcoin-mainnet', envelopeReveal: true }))
            .rejects.toThrow(/cannot sign a Taproot envelope reveal/);
        expect(transport).not.toHaveBeenCalled();
    });
});

describe('LedgerSigner refuses an envelope reveal before any device work', () => {
    const makeSigner = () => new LedgerSigner({
        id: 'ledger-test',
        displayName: 'Ledger (nanoX)',
        model: 'nanoX',
        deviceIdentifier: 'abcdef01',
        app: { createPaymentTransaction: vi.fn(), splitTransaction: vi.fn() },
        transport: { send: vi.fn() },
    });

    it('throws the capability message, not a PSBT-shape error', async () => {
        await expect(makeSigner().signPsbt({
            psbtHex: PSBT, chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/86'/0'/0'/0/0" }],
            envelopeReveal: true,
        })).rejects.toThrow(/cannot sign a Taproot envelope reveal/);
    });

    // The signer is built with no sdkRegistry, so an unguarded call reports
    // that instead. Asserting the DIFFERENT error on the same instance is what
    // proves the guard runs first, ahead of every other check in signPsbt.
    it('runs the guard ahead of the signer\'s own preconditions', async () => {
        await expect(makeSigner().signPsbt({
            psbtHex: PSBT, chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/86'/0'/0'/0/0" }],
        })).rejects.toThrow(/sdkRegistry/);
    });
});

describe('TrezorSigner refuses an envelope reveal before any device work', () => {
    const makeSigner = () => new TrezorSigner({
        id: 'trezor-test',
        displayName: 'Trezor (T2T1)',
        model: 'T2T1',
        deviceIdentifier: 'DEVICE_ID_MOCK',
        connect: { signTransaction: vi.fn() },
    });

    it('throws the capability message, not a scriptType error', async () => {
        await expect(makeSigner().signPsbt({
            psbtHex: PSBT, chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/86'/0'/0'/0/0" }],
            envelopeReveal: true,
        })).rejects.toThrow(/cannot sign a Taproot envelope reveal/);
    });

    it('runs the guard ahead of the signer\'s own preconditions', async () => {
        await expect(makeSigner().signPsbt({
            psbtHex: PSBT, chainId: 'bitcoin-mainnet',
            signingPaths: [{ inputIndex: 0, path: "m/86'/0'/0'/0/0" }],
        })).rejects.toThrow(/sdkRegistry/);
    });
});
