// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// PC-16 Phase B: the locked auto pay signer signs one COINPAY payment and
// refuses everything else. Every refusal is reported to the session (which
// ends locked auto pay) and throws. No real keys: the sealed-key signer is a
// stub that records the input indices it was asked to sign.

import { describe, expect, it, vi } from 'vitest';
import {
    ScopedPaySigner,
    ScopedPayRefusalError,
    SCOPED_PAY_SIGNER_KIND,
    checkScopedPayment,
} from '../../../packages/core/src/signers/ScopedPaySigner.js';

const NOW_MS = 1_800_000_000_000;
const NOW_S = NOW_MS / 1000;

const BINDING = Object.freeze({
    walletId: 'w1',
    chainId: 'bitcoin-regtest',
    sourceAddress: 'addr-payer',
    payeeAddress: 'addr-seller',
    amountBase: '500000',
    matchIndex: '900',
    deadlineSeconds: NOW_S + 3600,
    feeRatePerByteCeiling: 48,
});

const OP_RETURN = { address: null, scriptPubKeyHex: '6a0b434f494e504159', scriptType: 'unknown', value: 0 };

function goodTx(over = {}) {
    return {
        inputs: [{ address: 'addr-payer', value: 1_000_000 }],
        outputs: [
            { address: 'addr-seller', scriptPubKeyHex: '0014aa', scriptType: 'p2wpkh', value: 500000 },
            OP_RETURN,
            { address: 'addr-payer', scriptPubKeyHex: '0014bb', scriptType: 'p2wpkh', value: 495000 },
        ],
        ...over,
    };
}

const COINPAY_900 = { ok: true, action: 'COINPAY', version: 0, params: { VERSION: '0', ORDER_MATCH_ACTION_INDEX: '900' } };

function makeSigner({ tx = goodTx(), decoded = COINPAY_900, binding = BINDING, paid = false } = {}) {
    const sdk = {
        wallet: { decomposePsbt: vi.fn(() => tx) },
        decoder: { decodeActionFromPsbt: vi.fn(() => decoded) },
    };
    const signWithSealedKey = vi.fn(async () => ({ signedPsbtHex: 'signed', txHex: 'txhex', txid: 'paytx' }));
    const onRefusal = vi.fn();
    const signer = new ScopedPaySigner({
        binding,
        sdkRegistry: { get: () => sdk },
        signWithSealedKey,
        isPaid: () => paid,
        onRefusal,
        now: () => NOW_MS,
    });
    return { signer, signWithSealedKey, onRefusal, sdk };
}

async function expectRefusal(opts, reason, call) {
    const parts = makeSigner(opts);
    const run = call ? call(parts.signer) : parts.signer.signPsbt({ psbtHex: 'psbt', chainId: 'bitcoin-regtest' });
    await expect(run).rejects.toMatchObject({ name: 'ScopedPayRefusalError', reason });
    expect(parts.onRefusal).toHaveBeenCalledWith(reason);
    expect(parts.signWithSealedKey).not.toHaveBeenCalled();
}

describe('ScopedPaySigner signs the bound payment', () => {
    it('signs payee + COINPAY carrier + change, every input, once', async () => {
        const { signer, signWithSealedKey, onRefusal } = makeSigner({
            tx: goodTx({ inputs: [{ address: 'addr-payer', value: 600_000 }, { address: 'addr-payer', value: 400_000 }] }),
        });
        expect(signer.kind).toBe(SCOPED_PAY_SIGNER_KIND);
        const out = await signer.signPsbt({
            psbtHex: 'psbt',
            chainId: 'bitcoin-regtest',
            // The caller's paths are ignored: the key is the sealed source key.
            signingPaths: [{ inputIndex: 0, path: "m/84'/1'/0'/0/99" }],
        });
        expect(out.txid).toBe('paytx');
        expect(signWithSealedKey).toHaveBeenCalledWith(expect.objectContaining({ inputIndices: [0, 1], psbtHex: 'psbt' }));
        expect(onRefusal).not.toHaveBeenCalled();
        await expect(signer.signPsbt({ psbtHex: 'psbt', chainId: 'bitcoin-regtest' }))
            .rejects.toMatchObject({ reason: 'already-used' });
    });

    it('accepts a payment with no change output', () => {
        const tx = goodTx({ outputs: goodTx().outputs.slice(0, 2), inputs: [{ address: 'addr-payer', value: 503_000 }] });
        expect(checkScopedPayment({ decomposed: tx, decodedAction: COINPAY_900, binding: BINDING, nowSeconds: NOW_S, alreadyPaid: false }))
            .toEqual({ ok: true });
    });
});

describe('ScopedPaySigner refuses and reports', () => {
    it('wrong payee', async () => {
        const tx = goodTx();
        tx.outputs[0] = { ...tx.outputs[0], address: 'addr-attacker' };
        await expectRefusal({ tx }, 'wrong-payee');
    });

    it('wrong amount', async () => {
        const tx = goodTx();
        tx.outputs[0] = { ...tx.outputs[0], value: 500001 };
        await expectRefusal({ tx }, 'wrong-amount');
    });

    it('payee missing entirely', async () => {
        const tx = goodTx({ outputs: [OP_RETURN, goodTx().outputs[2]] });
        await expectRefusal({ tx }, 'wrong-payee');
    });

    it('extra output', async () => {
        const tx = goodTx();
        tx.outputs.push({ address: 'addr-donation', scriptPubKeyHex: '0014cc', scriptType: 'p2wpkh', value: 1000 });
        await expectRefusal({ tx }, 'extra-output');
    });

    it('a second change output', async () => {
        const tx = goodTx();
        tx.outputs.push({ ...tx.outputs[2], value: 1 });
        await expectRefusal({ tx }, 'extra-output');
    });

    it('a second payee output', async () => {
        const tx = goodTx();
        tx.outputs.push({ ...tx.outputs[0] });
        await expectRefusal({ tx }, 'wrong-amount');
    });

    it('foreign input', async () => {
        const tx = goodTx({ inputs: [{ address: 'addr-payer', value: 900_000 }, { address: 'addr-other', value: 100_000 }] });
        await expectRefusal({ tx }, 'foreign-input');
    });

    it('input whose script decodes to no address', async () => {
        const tx = goodTx({ inputs: [{ address: null, value: 1_000_000 }] });
        await expectRefusal({ tx }, 'foreign-input');
    });

    it('input with no value', async () => {
        const tx = goodTx({ inputs: [{ address: 'addr-payer', value: null }] });
        await expectRefusal({ tx }, 'input-value-unknown');
    });

    it('non-COINPAY OP_RETURN', async () => {
        await expectRefusal({ decoded: { ok: true, action: 'SEND', version: 0, params: {} } }, 'not-coinpay');
    });

    it('COINPAY for a different match', async () => {
        await expectRefusal({ decoded: { ...COINPAY_900, params: { ORDER_MATCH_ACTION_INDEX: '901' } } }, 'wrong-match');
    });

    it('an undecodable carrier', async () => {
        await expectRefusal({ decoded: { ok: false, reason: 'NO_OP_RETURN' } }, 'carrier-undecodable');
    });

    it('no carrier, and two carriers', async () => {
        await expectRefusal({ tx: goodTx({ outputs: [goodTx().outputs[0], goodTx().outputs[2]] }) }, 'no-carrier');
        const two = goodTx();
        two.outputs.push(OP_RETURN);
        await expectRefusal({ tx: two }, 'extra-carrier');
    });

    it('fee over the ceiling', async () => {
        // 48 base units/byte x (12 + 150 + 3*45) bytes = 14,256 ceiling.
        const tx = goodTx();
        tx.outputs[2] = { ...tx.outputs[2], value: 1_000_000 - 500_000 - 14_257 };
        await expectRefusal({ tx }, 'fee-over-ceiling');
        const atCeiling = goodTx();
        atCeiling.outputs[2] = { ...atCeiling.outputs[2], value: 1_000_000 - 500_000 - 14_256 };
        expect(checkScopedPayment({ decomposed: atCeiling, decodedAction: COINPAY_900, binding: BINDING, nowSeconds: NOW_S, alreadyPaid: false }).ok).toBe(true);
    });

    it('past the deadline', async () => {
        await expectRefusal({ binding: { ...BINDING, deadlineSeconds: NOW_S } }, 'past-deadline');
        await expectRefusal({ binding: { ...BINDING, deadlineSeconds: Number.NaN } }, 'past-deadline');
    });

    it('a match already paid', async () => {
        await expectRefusal({ paid: true }, 'repeat-match');
    });

    it('a reveal or envelope reveal', async () => {
        await expectRefusal({}, 'not-op-return', (s) => s.signPsbt({ psbtHex: 'p', chainId: 'bitcoin-regtest', reveal: true }));
        await expectRefusal({}, 'not-op-return', (s) => s.signPsbt({ psbtHex: 'p', chainId: 'bitcoin-regtest', envelopeReveal: true }));
    });

    it('another chain', async () => {
        await expectRefusal({}, 'wrong-chain', (s) => s.signPsbt({ psbtHex: 'p', chainId: 'litecoin-regtest' }));
    });

    it('an unbound signer', async () => {
        await expectRefusal({ binding: null }, 'unbound');
    });

    it('message signing, key export, derivation and multisig', async () => {
        await expectRefusal({}, 'message-signing', (s) => s.signMessage({ message: 'hi', chainId: 'bitcoin-regtest' }));
        await expectRefusal({}, 'derivation', (s) => s.getAddresses({}));
        await expectRefusal({}, 'derivation', (s) => s.getPublicKey({}));
        await expectRefusal({}, 'multisig', (s) => s.signMultisigPsbt({}));
        for (const method of ['getMasterKey', 'exportWifForPath', 'exportWifForAddressId', 'addImportedWif']) {
            const { signer, onRefusal } = makeSigner();
            expect(() => signer[method]({})).toThrow(ScopedPayRefusalError);
            expect(onRefusal).toHaveBeenCalledTimes(1);
        }
    });
});
