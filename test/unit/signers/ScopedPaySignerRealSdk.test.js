/** @vitest-environment node */

// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

// PC-16 Phase B against the real SDK, offline. A real bitcoinjs PSBT carries a
// real XChain OP_RETURN (MAGIC + compiled action string, AES-128-CTR keyed by
// the first input's txid, as the encoder writes it), so the ScopedPaySigner
// checks run on the real decomposePsbt and the real co-signer decoder, and the
// signature is a real one from a sealed key. The full lane also runs the real
// coinpayAction -> submitAction -> submitWithSigner path with ADS donations
// and change rotation switched ON in settings, stubbing only the network edges
// (explorer reads, the encoder's create_tx and broadcast). The key is derived
// from the public BIP39 test phrase and is never printed.

import { createRequire } from 'node:module';
import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import bitcoin from 'bitcoinjs-lib';
import { AutopaySession } from '../../../packages/core/src/market/autopaySession.js';
import { coinpayAction } from '../../../packages/core/src/flows/coinpayAction.js';
import { defaultRegistry } from '../../../packages/core/src/registry/index.js';
import { bip39MnemonicToSeedSync } from '../../../packages/core/src/crypto/mnemonic.js';
import { derive, hdKeyFromSeed, zeroDerivedKey } from '../../../packages/core/src/crypto/hd.js';
import { encodeWif } from '../../../packages/core/src/crypto/wif.js';

const require = createRequire(import.meta.url);
const { XChainSDK } = require('xchain-sdk');
const sdk = new XChainSDK({ network: 'bitcoin-regtest', preflight: false, compactTickers: false, compactAddresses: false });

const NET = bitcoin.networks.regtest;
const CHAIN = 'bitcoin-regtest';
const registry = defaultRegistry();
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PATH = "m/84'/1'/0'/0/0";

const root = hdKeyFromSeed(bip39MnemonicToSeedSync(PHRASE));
const dk = derive(root, PATH);
const PUBKEY = Buffer.from(dk.publicKeyHex, 'hex');
const WIF = encodeWif(dk.privateKey, registry.get(CHAIN).wifVersionByte, true);
zeroDerivedKey(dk);

const SOURCE = bitcoin.payments.p2wpkh({ pubkey: PUBKEY, network: NET }).address;
const LEGACY_SOURCE = bitcoin.payments.p2pkh({ pubkey: PUBKEY, network: NET }).address;
const PAYEE = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 7), network: NET }).address;
const NOW = 1_800_000_000_000;

function carrierScript(actionString, firstInputTxid) {
    const plain = Buffer.concat([
        Buffer.from('XCHN'),
        bitcoin.script.compile([Buffer.from(actionString, 'utf8')]),
    ]);
    const cipher = createCipheriv('aes-128-ctr', firstInputTxid.substr(0, 16), firstInputTxid.substr(16, 16));
    const payload = Buffer.concat([cipher.update(plain), cipher.final()]);
    return bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, payload]);
}

/** Build the PSBT the encoder would answer for a COINPAY. */
function buildPsbt({ actionString = 'COINPAY|0|900', legacy = false, payee = PAYEE, amount = 500000, extra = null, change = 495000 } = {}) {
    const psbt = new bitcoin.Psbt({ network: NET });
    let txid;
    if (legacy) {
        const prev = new bitcoin.Transaction();
        prev.addInput(randomBytes(32), 0);
        prev.addOutput(bitcoin.payments.p2pkh({ pubkey: PUBKEY, network: NET }).output, 1_000_000);
        txid = prev.getId();
        psbt.addInput({ hash: txid, index: 0, nonWitnessUtxo: prev.toBuffer() });
    } else {
        txid = randomBytes(32).toString('hex');
        psbt.addInput({
            hash: txid, index: 0,
            witnessUtxo: { script: bitcoin.payments.p2wpkh({ pubkey: PUBKEY, network: NET }).output, value: 1_000_000 },
        });
    }
    psbt.addOutput({ address: payee, value: amount });
    psbt.addOutput({ script: carrierScript(actionString, txid), value: 0 });
    psbt.addOutput({ address: legacy ? LEGACY_SOURCE : SOURCE, value: change });
    if (extra) psbt.addOutput(extra);
    return psbt.toHex();
}

function fakeVault(source = SOURCE) {
    const consent = {
        schemaVersion: 1, id: `${CHAIN}::aa`, walletId: 'w1', chainId: CHAIN, sourceAddress: source,
        txid: 'aa', orderActionIndex: '500', giveCoinAmount: '0.05', getTick: 'PEPE', getAmount: '1000',
        autopay: true, payments: [], createdAt: new Date(0).toISOString(),
    };
    return {
        autopayOrders: { list: async () => [consent], get: async () => consent, put: async () => {} },
        addresses: { list: async () => [{ id: 'a1', chain: 'bitcoin', network: 'regtest', address: source, publicKey: PUBKEY.toString('hex'), derivationPath: PATH }] },
        close: vi.fn(),
    };
}

async function boundSigner({ source = SOURCE, sdkForSession = sdk } = {}) {
    const ended = [];
    const session = await AutopaySession.capture({
        vault: fakeVault(source),
        signerPool: { get: () => ({ kind: 'software', exportWifForPath: () => WIF, exportWifForAddressId: () => WIF }) },
        chainRegistry: registry,
        sdkRegistry: { get: () => sdkForSession },
        now: () => NOW,
        onEnd: (reason) => ended.push(reason),
    });
    const signer = session.signerForPayment({
        walletId: 'w1', consentId: `${CHAIN}::aa`, chainId: CHAIN, payeeAddress: PAYEE,
        amountBase: '500000', matchIndex: '900', deadlineSeconds: NOW / 1000 + 3600,
    });
    return { session, signer, ended };
}

describe('ScopedPaySigner on the real SDK', () => {
    it('the real decoder reads the COINPAY match and the signer signs a segwit payment', async () => {
        const psbtHex = buildPsbt();
        const decoded = sdk.decoder.decodeActionFromPsbt(psbtHex);
        expect(decoded).toMatchObject({ ok: true, action: 'COINPAY' });
        expect(String(decoded.params.ORDER_MATCH_ACTION_INDEX)).toBe('900');
        const { session, signer, ended } = await boundSigner();
        const out = await signer.signPsbt({ psbtHex, chainId: CHAIN });
        expect(typeof out.txHex).toBe('string');
        const tx = bitcoin.Transaction.fromHex(out.txHex);
        expect(tx.ins[0].witness.length).toBe(2);
        expect(tx.outs).toHaveLength(3);
        expect(ended).toEqual([]);
        await session.end('quit');
    });

    it('a legacy (nonWitnessUtxo) input decomposes with its address and value, and signs', async () => {
        const psbtHex = buildPsbt({ legacy: true });
        const input = sdk.wallet.decomposePsbt(psbtHex).inputs[0];
        expect(input.address).toBe(LEGACY_SOURCE);
        expect(Number(input.value)).toBe(1_000_000);
        const { session, signer } = await boundSigner({ source: LEGACY_SOURCE });
        const out = await signer.signPsbt({ psbtHex, chainId: CHAIN });
        expect(bitcoin.Transaction.fromHex(out.txHex).ins[0].script.length).toBeGreaterThan(0);
        await session.end('quit');
    });

    it('a real PSBT with a donation output or another match is refused and ends the session', async () => {
        const donation = { address: bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 9), network: NET }).address, value: 1000 };
        for (const psbtHex of [buildPsbt({ extra: donation, change: 494000 }), buildPsbt({ actionString: 'COINPAY|0|901' })]) {
            const { signer, ended, session } = await boundSigner();
            await expect(signer.signPsbt({ psbtHex, chainId: CHAIN })).rejects.toMatchObject({ name: 'ScopedPayRefusalError' });
            await vi.waitFor(() => expect(ended).toEqual(['signer-refused']));
            expect(session.ended).toBe(true);
        }
    });

    it('the real coinpayAction lane builds, checks, signs and broadcasts with ADS and change rotation on', async () => {
        let built = null;
        const broadcast = vi.fn(async () => ({ txid: 'broadcast-txid' }));
        // The real SDK for actions, wallet and decoder; only the network edges are stubbed.
        const laneSdk = Object.create(sdk);
        laneSdk.encoder = {
            createTx: vi.fn(async (opts) => {
                built = opts;
                return { psbt: buildPsbt({ actionString: opts.data }), encoding: 'OP_RETURN' };
            }),
            broadcastTx: broadcast,
        };
        laneSdk.getCoinpayObligations = vi.fn(async () => ({ data: [{
            action_index: '900', payer_address: SOURCE, payee_address: PAYEE, coin_amount: '0.005',
            coinpay_status: 'pending_coinpay', expiration: NOW / 1000 + 3600, block_index: 100,
        }] }));
        // Not the batch shape: the reader falls back to the per-address read above.
        laneSdk.getCoinpayObligationsBatch = vi.fn(async () => []);
        laneSdk.getAction = vi.fn(async () => null);
        laneSdk.getStatus = vi.fn(async () => ({ last_block: { RBTC: 101 } }));
        const { session, signer } = await boundSigner({ sdkForSession: laneSdk });
        const settings = {
            ads: { enabled: true, perChain: { [CHAIN]: true } },
            // On, so a lane that did rotate would call signer.getAddresses,
            // which the scoped signer refuses (ending the session).
            privacy: { changeAddressRotation: true },
        };
        const vault = {
            settings: { get: async () => settings, put: async () => {} },
            pendingTxs: { list: async () => [], put: async () => {}, get: async () => null },
            addresses: { list: async () => [] },
            accounts: { findBy: async () => [] },
        };
        const result = await coinpayAction({
            vault,
            walletId: 'w1',
            signer,
            scopedPayment: true,
            chainRegistry: registry,
            sdkRegistry: { get: () => laneSdk },
            chainId: CHAIN,
            from: { address: SOURCE, publicKey: PUBKEY.toString('hex'), derivationPath: PATH },
            orderMatchActionIndex: '900',
            payeeAddress: PAYEE,
            coinAmount: '500000',
            trackPendingTx: false,
        });
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(result).toBeTruthy();
        // No donation output was requested and change stayed on the source.
        expect(built.customOutputs).toEqual([{ address: PAYEE, value: 500000 }]);
        expect(built.change).toBe(SOURCE);
        expect(session.ended).toBe(false);
        await session.end('quit');
    });
});
