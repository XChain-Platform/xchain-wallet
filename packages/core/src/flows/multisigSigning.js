// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// multisigSigning: §22.3 partial-signature tracking flows. Phase 4
// Step 19 of 23.
//
// State machine + persistence for multisig sign rounds. Step 19 owns
// session lifecycle (start / contribute / aggregate / cancel /
// finalize-stub); Step 20 wires QR transport on top; Step 21 wires HW
// signers. The local-cosigner contribution path is also out of scope
// for Step 19. Once Step 20's QR transport lands we'll know which
// signature primitive (PSBT-input vs. raw msgHash) the local key
// produces, and the corresponding contribute helper can be wired up
// without churning the persistence layer.
//
// Schemes diverge at round count:
//   - p2sh-multisig / p2wsh-multisig: one round, classical ECDSA.
//   - taproot-musig2: two rounds (collect public nonces per BIP327
//     round 1), aggregate them, collect partial sigs (round 2),
//     aggregate into a single 64-byte Schnorr signature.
//
// The flow's job is to keep the persistent record in sync with what
// the cosigners have submitted and to drive transitions between
// statuses. Cryptographic aggregation is delegated to `sdk.musig2.*`.

import { secp256k1 } from '@noble/curves/secp256k1';
import {
    createMultisigSigningSession,
    pendingCosignerPubkeys,
} from '../schemas/multisigSigningSession.js';
import { assertSigningAllowed } from './panicMode.js';
import { assertBroadcastSignaturesVerify } from '../signers/verifyTxSignatures.js';
import { isAlreadyOnNetworkRejection } from './broadcastPermanence.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/multisig.js';

export const MULTISIG_SIGNATURE_INVALID = 'MULTISIG_SIGNATURE_INVALID';

// A classical reply counts toward the threshold only when it is a low-S DER
// signature of the session's msgHash by the cosigner it names. Shape checks
// alone let a corrupted or forged reply mark the session ready to finalize,
// and nothing after that point can tell which reply was bad. The check is
// pure math, so it holds while the explorer or encoder is unreachable.
function isClassicalSignatureOf(derHex, msgHash, pubkey) {
    try {
        const signature = secp256k1.Signature.fromDER(derHex);
        return secp256k1.verify(signature, msgHash, pubkey, { lowS: true });
    } catch {
        return false;
    }
}

function signatureInvalidError() {
    const err = /** @type {Error & { code?: string }} */ (new Error(t('multisig.reply.signatureInvalid')));
    err.code = MULTISIG_SIGNATURE_INVALID;
    return err;
}

const HEX_RE = /^[0-9a-f]+$/;
const TXID_RE = /^[0-9a-fA-F]{64}$/;
const isHexLength = (v, byteLen) =>
    typeof v === 'string' && HEX_RE.test(v.toLowerCase()) && v.length === byteLen * 2;

function lowerHex(v) {
    if (typeof v !== 'string') return '';
    return v.toLowerCase();
}

function ensureSession(session, sessionId) {
    if (!session) {
        throw new Error(`multisigSigning: session "${sessionId}" not found`);
    }
    return session;
}

function assertCosigner(session, pubkey) {
    const lower = lowerHex(pubkey);
    if (!session.cosignerPubkeys.includes(lower)) {
        throw new Error(
            `multisigSigning: pubkey "${pubkey}" is not a cosigner of this session`,
        );
    }
    return lower;
}

function assertStatus(session, ...allowed) {
    if (!allowed.includes(session.status)) {
        throw new Error(
            `multisigSigning: session is in status "${session.status}"; expected one of ${allowed.join(' / ')}`,
        );
    }
}

function hexToBytes(hex) {
    const clean = hex.toLowerCase();
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i += 1) {
        out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Every change to a session reads the record, edits it and writes it back
// through an asynchronous vault. Two changes in flight on one session (two
// windows, two quick replies, a double click) would each write over the other,
// dropping a signature, reviving a cancelled session or broadcasting twice.
// Changes to one session therefore run one at a time: in this context through a
// promise chain, and across tabs through the Web Locks API where it exists.
const sessionTails = new Map();

function withSessionLock(sessionId, work) {
    const key = String(sessionId);
    const previous = sessionTails.get(key) || Promise.resolve();
    const run = previous.then(() => {
        const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
        return locks && typeof locks.request === 'function'
            ? locks.request(`xchain-multisig-session:${key}`, work)
            : work();
    });
    const tail = run.then(() => undefined, () => undefined);
    sessionTails.set(key, tail);
    tail.then(() => {
        if (sessionTails.get(key) === tail) sessionTails.delete(key);
    });
    return run;
}

async function persist(vault, session) {
    const next = { ...session, updatedAt: new Date().toISOString() };
    await vault.multisigSigningSessions.put(next);
    return next;
}

// ─── Lifecycle ────────────────────────────────────────────────────

/**
 * Start a multisig signing session for the wallet's persisted
 * MultisigConfig. Snapshots scheme/threshold/cosigner pubkey list onto
 * the session so later contributions don't depend on the (mutable)
 * config record.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.walletId
 * @param {string} opts.chainId
 * @param {string} opts.msgHash         32-byte hex; sighash being signed
 * @param {string} opts.psbtHex         opaque transport payload (Step 20 fills the bytes; passing '' is fine for Step 19 testing)
 * @param {string} [opts.actionSummary]
 */
export async function startMultisigSigningSession(opts) {
    if (!opts) throw new Error('startMultisigSigningSession: opts is required');
    if (!opts.vault) throw new Error('startMultisigSigningSession: vault is required');
    if (typeof opts.walletId !== 'string' || opts.walletId.length === 0) {
        throw new Error('startMultisigSigningSession: walletId is required');
    }
    if (typeof opts.chainId !== 'string' || opts.chainId.length === 0) {
        throw new Error('startMultisigSigningSession: chainId is required');
    }
    if (!isHexLength(opts.msgHash, 32)) {
        throw new Error('startMultisigSigningSession: msgHash must be 32-byte hex');
    }

    const wallet = await opts.vault.wallets.get(opts.walletId);
    if (!wallet) {
        throw new Error(`startMultisigSigningSession: wallet "${opts.walletId}" not found`);
    }
    const configs = Array.isArray(wallet.multisigs) ? wallet.multisigs : [];
    let config;
    if (typeof opts.multisigConfigId === 'string' && opts.multisigConfigId.length > 0) {
        config = configs.find((c) => c.id === opts.multisigConfigId);
        if (!config) {
            throw new Error(
                `startMultisigSigningSession: wallet "${opts.walletId}" has no multisig config with id "${opts.multisigConfigId}"`,
            );
        }
    } else {
        config = configs[0];
    }
    if (!config) {
        throw new Error(
            `startMultisigSigningSession: wallet "${opts.walletId}" has no multisig configuration`,
        );
    }

    const session = createMultisigSigningSession({
        walletId: opts.walletId,
        chainId: opts.chainId,
        scheme: config.scheme,
        threshold: config.threshold,
        cosignerPubkeys: config.cosigners.map((c) => c.pubkey),
        msgHash: opts.msgHash,
        psbtHex: typeof opts.psbtHex === 'string' ? opts.psbtHex : '',
        actionSummary: opts.actionSummary || '',
    });
    await opts.vault.multisigSigningSessions.put(session);
    return session;
}

/** @param {{ vault: any, sessionId: string }} opts */
export async function getMultisigSigningSession({ vault, sessionId }) {
    if (!vault) throw new Error('getMultisigSigningSession: vault is required');
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('getMultisigSigningSession: sessionId is required');
    }
    return vault.multisigSigningSessions.get(sessionId);
}

/** @param {{ vault: any, walletId: string }} opts */
export async function listMultisigSigningSessions({ vault, walletId }) {
    if (!vault) throw new Error('listMultisigSigningSessions: vault is required');
    if (typeof walletId !== 'string' || walletId.length === 0) {
        throw new Error('listMultisigSigningSessions: walletId is required');
    }
    const all = await vault.multisigSigningSessions.list();
    return all.filter((s) => s.walletId === walletId);
}

/**
 * Move a non-terminal session to `cancelled`. Idempotent for sessions
 * already in a terminal state (returns the unchanged record).
 *
 * @param {{ vault: any, sessionId: string }} opts
 */
async function cancelMultisigSigningSessionLocked({ vault, sessionId }) {
    const session = ensureSession(
        await vault.multisigSigningSessions.get(sessionId),
        sessionId,
    );
    if (['cancelled', 'broadcast'].includes(session.status)) return session;
    return persist(vault, { ...session, status: 'cancelled' });
}

// ─── Contributions ────────────────────────────────────────────────

/**
 * MuSig2 round 1: append a cosigner's 66-byte publicNonce. Validates
 * shape only here; cryptographic aggregation happens in
 * `aggregateMultisigSession` once threshold is met.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.sessionId
 * @param {string} opts.pubkey            66-char compressed pubkey hex
 * @param {string} opts.publicNonceHex    132-char (66-byte) hex
 */
async function contributeMultisigNonceLocked({ vault, sessionId, pubkey, publicNonceHex }) {
    if (!vault) throw new Error('contributeMultisigNonce: vault is required');
    if (typeof sessionId !== 'string') throw new Error('contributeMultisigNonce: sessionId is required');
    if (!isHexLength(publicNonceHex, 66)) {
        throw new Error('contributeMultisigNonce: publicNonceHex must be 66-byte hex');
    }
    const session = ensureSession(await vault.multisigSigningSessions.get(sessionId), sessionId);
    if (session.scheme !== 'taproot-musig2') {
        throw new Error(
            `contributeMultisigNonce: scheme "${session.scheme}" does not collect nonces`,
        );
    }
    assertStatus(session, 'collecting-nonces');
    const lowerPubkey = assertCosigner(session, pubkey);
    if (session.nonces.some((n) => n.pubkey === lowerPubkey)) {
        throw new Error(
            `contributeMultisigNonce: cosigner "${lowerPubkey}" already contributed a nonce`,
        );
    }
    const nonces = [
        ...session.nonces,
        {
            pubkey: lowerPubkey,
            publicNonce: lowerHex(publicNonceHex),
            contributedAt: new Date().toISOString(),
        },
    ];
    return persist(vault, { ...session, nonces });
}

/**
 * Single-round (P2SH/P2WSH) classical signature contribution OR
 * MuSig2 round 2 partial-sig contribution. The schema discriminates
 * by `session.scheme`.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {string} opts.sessionId
 * @param {string} opts.pubkey
 * @param {string} opts.signatureHex      DER-encoded ECDSA hex (P2SH/P2WSH) or 32-byte hex (MuSig2 partial)
 */
async function contributeMultisigSignatureLocked({ vault, sessionId, pubkey, signatureHex }) {
    if (!vault) throw new Error('contributeMultisigSignature: vault is required');
    if (typeof sessionId !== 'string') throw new Error('contributeMultisigSignature: sessionId is required');
    if (typeof signatureHex !== 'string' || signatureHex.length === 0
        || signatureHex.length % 2 !== 0 || !HEX_RE.test(signatureHex.toLowerCase())) {
        throw new Error('contributeMultisigSignature: signatureHex must be hex');
    }
    const session = ensureSession(await vault.multisigSigningSessions.get(sessionId), sessionId);
    assertStatus(session, 'collecting-sigs');
    const lowerPubkey = assertCosigner(session, pubkey);
    const lowerSig = lowerHex(signatureHex);

    if (session.scheme === 'taproot-musig2') {
        if (lowerSig.length !== 64) {
            throw new Error(
                'contributeMultisigSignature: MuSig2 partial sig must be 32-byte (64-char) hex',
            );
        }
        if (session.partialSigs.some((s) => s.pubkey === lowerPubkey)) {
            throw new Error(
                `contributeMultisigSignature: cosigner "${lowerPubkey}" already contributed a partial sig`,
            );
        }
        const partialSigs = [
            ...session.partialSigs,
            {
                pubkey: lowerPubkey,
                sig: lowerSig,
                contributedAt: new Date().toISOString(),
            },
        ];
        return persist(vault, { ...session, partialSigs });
    }

    // P2SH/P2WSH: DER-encoded ECDSA. Length is variable (typically
    // 70-72 bytes; 140-144 hex chars). Validate range loosely; the
    // PSBT finalizer rejects malformed sigs in any case.
    if (lowerSig.length < 16 || lowerSig.length > 200) {
        throw new Error(
            'contributeMultisigSignature: ECDSA DER signature length out of expected range',
        );
    }
    if (session.signatures.some((s) => s.pubkey === lowerPubkey)) {
        throw new Error(
            `contributeMultisigSignature: cosigner "${lowerPubkey}" already contributed a signature`,
        );
    }
    if (!isClassicalSignatureOf(lowerSig, session.msgHash, lowerPubkey)) {
        throw signatureInvalidError();
    }
    const signatures = [
        ...session.signatures,
        {
            pubkey: lowerPubkey,
            sig: lowerSig,
            contributedAt: new Date().toISOString(),
        },
    ];
    let nextStatus = session.status;
    if (signatures.length >= session.threshold) {
        nextStatus = 'ready-to-finalize';
    }
    return persist(vault, { ...session, signatures, status: nextStatus });
}

// ─── Aggregation (MuSig2 only) ────────────────────────────────────

/**
 * Drive MuSig2 transitions. Two work items:
 *   1. If `status='collecting-nonces'` and threshold nonces are
 *      present, run `sdk.musig2.aggregateNonces` and advance to
 *      `'collecting-sigs'`. The aggNonce is persisted on the session
 *      so cosigners can fetch it for their round-2 partialSign call.
 *   2. If `status='collecting-sigs'` and threshold partial sigs are
 *      present, run `sdk.musig2.startSession` + `aggregateSignatures`
 *      and advance to `'ready-to-finalize'`. The 64-byte Schnorr sig
 *      is persisted on `aggregatedSchnorrSig`.
 *
 * Idempotent: calling with an already-advanced session is a no-op.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} opts.sdkRegistry
 * @param {string} opts.sessionId
 */
async function aggregateMultisigSessionLocked({ vault, sdkRegistry, sessionId }) {
    if (!vault) throw new Error('aggregateMultisigSession: vault is required');
    if (!sdkRegistry) throw new Error('aggregateMultisigSession: sdkRegistry is required');
    if (typeof sessionId !== 'string') throw new Error('aggregateMultisigSession: sessionId is required');
    let session = ensureSession(await vault.multisigSigningSessions.get(sessionId), sessionId);
    if (session.scheme !== 'taproot-musig2') {
        throw new Error('aggregateMultisigSession: only valid for taproot-musig2 sessions');
    }
    const sdk = sdkRegistry.get(session.chainId);
    if (!sdk) {
        throw new Error(`aggregateMultisigSession: no SDK registered for chainId "${session.chainId}"`);
    }
    if (!sdk.musig2) {
        throw new Error('aggregateMultisigSession: sdk.musig2 unavailable; bump xchain-sdk to 1.10+');
    }

    // Round-1 → round-2 transition.
    if (session.status === 'collecting-nonces' && session.nonces.length >= session.threshold) {
        const orderedNonces = session.cosignerPubkeys
            .map((pk) => session.nonces.find((n) => n.pubkey === pk))
            .filter(Boolean)
            .slice(0, session.threshold)
            .map((n) => hexToBytes(n.publicNonce));
        const aggNonce = sdk.musig2.aggregateNonces(orderedNonces);
        session = await persist(vault, {
            ...session,
            aggNonce: bytesToHex(aggNonce),
            status: 'collecting-sigs',
        });
    }

    // Round-2 → ready-to-finalize transition.
    if (session.status === 'collecting-sigs' && session.partialSigs.length >= session.threshold) {
        if (!session.aggNonce) {
            throw new Error(
                'aggregateMultisigSession: cannot aggregate sigs without aggNonce (round 1 not completed)',
            );
        }
        const aggNonceBytes = hexToBytes(session.aggNonce);
        const msgBytes = hexToBytes(session.msgHash);
        const pubkeyBytes = session.cosignerPubkeys.map(hexToBytes);
        const sessionKey = sdk.musig2.startSession(aggNonceBytes, msgBytes, pubkeyBytes);
        const orderedSigs = session.cosignerPubkeys
            .map((pk) => session.partialSigs.find((s) => s.pubkey === pk))
            .filter(Boolean)
            .slice(0, session.threshold)
            .map((s) => hexToBytes(s.sig));
        const schnorr = sdk.musig2.aggregateSignatures(orderedSigs, sessionKey);
        session = await persist(vault, {
            ...session,
            aggregatedSchnorrSig: bytesToHex(schnorr),
            status: 'ready-to-finalize',
        });
    }

    return session;
}

// Finalization and broadcast

/**
 * Finalize the session PSBT through its chain SDK, or broadcast an already
 * finalized session. Callers may supply finalized bytes when another wallet
 * performs finalization.
 *
 * @param {object} opts
 * @param {import('../storage/Vault.js').Vault} opts.vault
 * @param {import('../sdk/SDKRegistry.js').SDKRegistry} [opts.sdkRegistry]
 * @param {string} opts.sessionId
 * @param {string} [opts.finalizedTxHex] hex-encoded raw tx
 * @param {string} [opts.txid]
 * @param {boolean} [opts.broadcast]
 */
async function finalizeMultisigSigningSessionLocked({
    vault,
    sdkRegistry,
    sessionId,
    finalizedTxHex,
    txid,
    broadcast = false,
}) {
    if (!vault) throw new Error('finalizeMultisigSigningSession: vault is required');
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('finalizeMultisigSigningSession: sessionId is required');
    }
    const session = ensureSession(await vault.multisigSigningSessions.get(sessionId), sessionId);

    if (broadcast) {
        if (session.status === 'broadcast') return session;
        assertStatus(session, 'finalized');
        if (!sdkRegistry) throw new Error('finalizeMultisigSigningSession: sdkRegistry is required to broadcast');
        const sdk = sdkRegistry.get(session.chainId);
        if (!sdk) {
            throw new Error(`finalizeMultisigSigningSession: no SDK registered for chainId "${session.chainId}"`);
        }
        if (typeof sdk.encoder?.broadcastTx !== 'function') {
            throw new Error('finalizeMultisigSigningSession: sdk.encoder.broadcastTx is unavailable');
        }
        // Panic-mode freeze: pushing the finalized bytes is the irreversible
        // step, so it is refused like every other broadcast route. The session
        // stays 'finalized' and can be broadcast once the freeze ends.
        assertSigningAllowed();
        // The finalized bytes carry cosigner signatures, or came whole from
        // another coordinator, so none of them is this wallet's own signer's
        // output: verify every input's signature against the session PSBT's
        // prevouts (the UTXO tracker's when the PSBT does not decompose) before
        // anything is sent. A refusal leaves the session finalized.
        await assertBroadcastSignaturesVerify({
            sdk,
            txHex: session.finalizedTxHex,
            psbtHex: session.psbtHex,
            signerId: `multisig:${session.id}`,
        });
        let result;
        try {
            result = await sdk.encoder.broadcastTx(session.finalizedTxHex);
        } catch (err) {
            // When the node takes the transaction but its reply is lost (a 500, a
            // dropped connection, a timeout), the retry meets "already known" for
            // these same bytes. The node holding the session's own finalized
            // transaction is the broadcast having happened, so the session records
            // it instead of offering a retry that can never succeed.
            if (isAlreadyOnNetworkRejection(err)) {
                return persist(vault, { ...session, status: 'broadcast' });
            }
            throw err;
        }
        const broadcastTxid = typeof result === 'string' ? result : result?.txid;
        // 'broadcast' is terminal and hides the retry, so only a real txid for
        // this transaction moves the session there. Any other reply leaves it
        // finalized: retrying the same bytes is safe, and a node that did take
        // them answers "already known", which the branch above records.
        if (typeof broadcastTxid !== 'string' || !TXID_RE.test(broadcastTxid)) {
            throw new Error('finalizeMultisigSigningSession: broadcast returned no txid');
        }
        if (typeof session.txid === 'string' && TXID_RE.test(session.txid)
            && broadcastTxid.toLowerCase() !== session.txid.toLowerCase()) {
            throw new Error('finalizeMultisigSigningSession: broadcast returned a txid for a different transaction');
        }
        return persist(vault, { ...session, txid: broadcastTxid.toLowerCase(), status: 'broadcast' });
    }

    assertStatus(session, 'ready-to-finalize', 'finalized');
    if (finalizedTxHex !== undefined) {
        if (typeof finalizedTxHex !== 'string' || finalizedTxHex.length === 0
            || finalizedTxHex.length % 2 !== 0 || !HEX_RE.test(finalizedTxHex.toLowerCase())) {
            throw new Error('finalizeMultisigSigningSession: finalizedTxHex must be hex');
        }
        return persist(vault, {
            ...session,
            finalizedTxHex: lowerHex(finalizedTxHex),
            txid: typeof txid === 'string' && txid.length > 0 ? txid : session.txid,
            status: session.status === 'ready-to-finalize' ? 'finalized' : session.status,
        });
    }
    if (session.status === 'finalized') return session;
    if (!sdkRegistry) throw new Error('finalizeMultisigSigningSession: sdkRegistry is required to finalize');
    const sdk = sdkRegistry.get(session.chainId);
    if (!sdk) {
        throw new Error(`finalizeMultisigSigningSession: no SDK registered for chainId "${session.chainId}"`);
    }
    if (typeof sdk.wallet?.finalizeMultisigPsbt !== 'function') {
        throw new Error('finalizeMultisigSigningSession: sdk.wallet.finalizeMultisigPsbt is unavailable');
    }
    const finalized = await sdk.wallet.finalizeMultisigPsbt(session.psbtHex);
    if (typeof finalized?.txHex !== 'string' || finalized.txHex.length === 0
        || finalized.txHex.length % 2 !== 0 || !HEX_RE.test(finalized.txHex.toLowerCase())) {
        throw new Error('finalizeMultisigSigningSession: SDK returned invalid transaction hex');
    }
    return persist(vault, {
        ...session,
        finalizedTxHex: lowerHex(finalized.txHex),
        txid: typeof finalized.txid === 'string' && finalized.txid.length > 0
            ? finalized.txid
            : session.txid,
        status: 'finalized',
    });
}

// Public entry points: each change to one session waits for the one before it.
/** @param {any} opts */
export function cancelMultisigSigningSession(opts) {
    return withSessionLock(opts?.sessionId, () => cancelMultisigSigningSessionLocked(opts));
}

/** @param {any} opts */
export function contributeMultisigNonce(opts) {
    return withSessionLock(opts?.sessionId, () => contributeMultisigNonceLocked(opts));
}

/** @param {any} opts */
export function contributeMultisigSignature(opts) {
    return withSessionLock(opts?.sessionId, () => contributeMultisigSignatureLocked(opts));
}

/** @param {any} opts */
export function aggregateMultisigSession(opts) {
    return withSessionLock(opts?.sessionId, () => aggregateMultisigSessionLocked(opts));
}

/** @param {any} opts */
export function finalizeMultisigSigningSession(opts) {
    return withSessionLock(opts?.sessionId, () => finalizeMultisigSigningSessionLocked(opts));
}

// Surface the helper from the schema layer so UI callers don't have
// to dig past this module.
export { pendingCosignerPubkeys };
