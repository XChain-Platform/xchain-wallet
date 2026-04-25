// signMultisigLocally — §22.3 local-cosigner contribution flow.
// Phase 4 Step 21 of 23.
//
// Wraps the unlock + signer-dispatch + contribute-via-Step-19-API
// dance for "I want to sign with my own key on this multisig
// session." Routes by `(scheme, status)`:
//
//   taproot-musig2 + collecting-nonces  → signMusig2Round1 → contributeMultisigNonce
//   taproot-musig2 + collecting-sigs    → signMusig2Round2 → contributeMultisigSignature (32-byte partial)
//   p2sh / p2wsh   + collecting-sigs    → signMultisigClassical → contributeMultisigSignature (DER ECDSA)
//
// The local cosigner is identified by the wallet's `MultisigConfig`
// — exactly one cosigner is expected to have `origin === 'local'`
// and a `localSignerId`; that cosigner's `derivationPath` is what we
// hand to the signer.
//
// Hardware signers throw a clear "Update firmware to use MuSig2 on
// this device" error per §22.3 — the flow surfaces that to the
// caller verbatim so the sign screen can show it.

import { unlockWallet } from './unlockWallet.js';
import { fingerprintSessionRef } from '../uri/multisigPsbtEnvelope.js';

/**
 * @typedef {Object} SignMultisigLocallyOpts
 * @property {import('../storage/Vault.js').Vault} vault
 * @property {import('../registry/index.js').ChainRegistry} chainRegistry
 * @property {import('../sdk/SDKRegistry.js').SDKRegistry} sdkRegistry
 * @property {string} sessionId
 * @property {string} password                soft-signer unlock; ignored when the local cosigner is HW-backed
 * @property {string} [bip39Passphrase]
 */

/**
 * @typedef {Object} SignMultisigLocallyResult
 * @property {string} pubkey
 * @property {'round-1-nonce' | 'round-2-partial' | 'classical-signature'} contributionKind
 * @property {string} contributionHex
 * @property {object} session                 the updated session record post-contribute
 */

/**
 * @param {SignMultisigLocallyOpts} opts
 * @returns {Promise<SignMultisigLocallyResult>}
 */
export async function signMultisigLocally(opts) {
    if (!opts) throw new Error('signMultisigLocally: opts is required');
    if (!opts.vault) throw new Error('signMultisigLocally: vault is required');
    if (!opts.chainRegistry) throw new Error('signMultisigLocally: chainRegistry is required');
    if (!opts.sdkRegistry) throw new Error('signMultisigLocally: sdkRegistry is required');
    if (typeof opts.sessionId !== 'string' || opts.sessionId.length === 0) {
        throw new Error('signMultisigLocally: sessionId is required');
    }
    if (typeof opts.password !== 'string' || opts.password.length === 0) {
        throw new Error('signMultisigLocally: password is required (HW signer support is forthcoming)');
    }

    const session = await opts.vault.multisigSigningSessions.get(opts.sessionId);
    if (!session) {
        throw new Error(`signMultisigLocally: session "${opts.sessionId}" not found`);
    }
    if (['cancelled', 'broadcast', 'finalized', 'ready-to-finalize'].includes(session.status)) {
        throw new Error(
            `signMultisigLocally: session is in status "${session.status}"; nothing to contribute`,
        );
    }

    const wallet = await opts.vault.wallets.get(session.walletId);
    if (!wallet) {
        throw new Error(`signMultisigLocally: wallet "${session.walletId}" not found`);
    }
    // Match the session's cosigner pubkey list against the wallet's
    // multisigs[] (Step 4 schema migration). The session record
    // snapshots `cosignerPubkeys` at start time, so picking the
    // matching config by pubkey-set equality is robust to wallets
    // that carry multiple configs.
    const configs = Array.isArray(wallet.multisigs) ? wallet.multisigs : [];
    const sessionPubkeys = new Set(session.cosignerPubkeys.map((p) => p.toLowerCase()));
    const config = configs.find((c) => {
        if (!c || !Array.isArray(c.cosigners)) return false;
        if (c.cosigners.length !== sessionPubkeys.size) return false;
        return c.cosigners.every((cs) => sessionPubkeys.has(cs.pubkey.toLowerCase()));
    });
    if (!config) {
        throw new Error(
            `signMultisigLocally: wallet "${session.walletId}" has no MultisigConfig matching this session's cosigners — coordinator wallet must own the same config the session was started against`,
        );
    }
    const localCosigner = config.cosigners.find((c) => c.origin === 'local');
    if (!localCosigner) {
        throw new Error(
            'signMultisigLocally: this wallet has no local cosigner on the persisted MultisigConfig; nothing to sign with',
        );
    }
    const lowerLocalPubkey = String(localCosigner.pubkey).toLowerCase();

    // Round-appropriate duplicate check: don't unlock the wallet just
    // to fail on the contribute step.
    if (session.scheme === 'taproot-musig2') {
        if (session.status === 'collecting-nonces'
            && session.nonces.some((n) => n.pubkey === lowerLocalPubkey)) {
            throw new Error(
                'signMultisigLocally: local cosigner has already contributed a nonce for this session',
            );
        }
        if (session.status === 'collecting-sigs') {
            if (!session.aggNonce) {
                throw new Error(
                    'signMultisigLocally: round 2 cannot start until aggNonce is set — coordinator must run aggregateMultisigSession first',
                );
            }
            if (session.partialSigs.some((s) => s.pubkey === lowerLocalPubkey)) {
                throw new Error(
                    'signMultisigLocally: local cosigner has already contributed a partial sig for this session',
                );
            }
        }
    } else if (session.signatures.some((s) => s.pubkey === lowerLocalPubkey)) {
        throw new Error(
            'signMultisigLocally: local cosigner has already contributed a classical signature for this session',
        );
    }

    const sessionRef = {
        scheme: session.scheme,
        threshold: session.threshold,
        cosignerPubkeys: session.cosignerPubkeys,
        msgHash: session.msgHash,
        psbtHex: session.psbtHex,
    };
    const fingerprint = fingerprintSessionRef(sessionRef);
    const signerSessionRef = {
        ...sessionRef,
        fingerprint,
    };

    const signer = await unlockWallet({
        vault:         opts.vault,
        walletId:      session.walletId,
        password:      opts.password,
        bip39Passphrase: opts.bip39Passphrase,
        chainRegistry: opts.chainRegistry,
        sdkRegistry:   opts.sdkRegistry,
    });

    try {
        if (session.scheme === 'taproot-musig2' && session.status === 'collecting-nonces') {
            const { publicNonce } = await signer.signMusig2Round1({
                chainId:    session.chainId,
                path:       localCosigner.derivationPath,
                sessionRef: signerSessionRef,
            });
            const updated = await contributeMultisigNonceLocal({
                vault:           opts.vault,
                sessionId:       session.id,
                pubkey:          lowerLocalPubkey,
                publicNonceHex:  publicNonce,
            });
            return {
                pubkey:           lowerLocalPubkey,
                contributionKind: 'round-1-nonce',
                contributionHex:  publicNonce,
                session:          updated,
            };
        }

        if (session.scheme === 'taproot-musig2' && session.status === 'collecting-sigs') {
            const { partialSig } = await signer.signMusig2Round2({
                chainId:     session.chainId,
                path:        localCosigner.derivationPath,
                sessionRef:  signerSessionRef,
                aggNonceHex: session.aggNonce,
            });
            const updated = await contributeMultisigSignatureLocal({
                vault:        opts.vault,
                sessionId:    session.id,
                pubkey:       lowerLocalPubkey,
                signatureHex: partialSig,
            });
            return {
                pubkey:           lowerLocalPubkey,
                contributionKind: 'round-2-partial',
                contributionHex:  partialSig,
                session:          updated,
            };
        }

        // P2SH / P2WSH single round.
        const { sig } = await signer.signMultisigClassical({
            chainId:  session.chainId,
            path:     localCosigner.derivationPath,
            msgHash:  session.msgHash,
        });
        const updated = await contributeMultisigSignatureLocal({
            vault:        opts.vault,
            sessionId:    session.id,
            pubkey:       lowerLocalPubkey,
            signatureHex: sig,
        });
        return {
            pubkey:           lowerLocalPubkey,
            contributionKind: 'classical-signature',
            contributionHex:  sig,
            session:          updated,
        };
    } finally {
        if (typeof signer.lock === 'function') {
            signer.lock();
        }
    }
}

// Local-only thin wrappers that re-import via dynamic require to
// avoid an import cycle with multisigSigning.js (which itself
// imports from this file's siblings). Pulled out as a separate
// helper so the dispatch logic above stays linear.

async function contributeMultisigNonceLocal({ vault, sessionId, pubkey, publicNonceHex }) {
    const { contributeMultisigNonce } = await import('./multisigSigning.js');
    return contributeMultisigNonce({ vault, sessionId, pubkey, publicNonceHex });
}

async function contributeMultisigSignatureLocal({ vault, sessionId, pubkey, signatureHex }) {
    const { contributeMultisigSignature } = await import('./multisigSigning.js');
    return contributeMultisigSignature({ vault, sessionId, pubkey, signatureHex });
}
