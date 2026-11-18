// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Hardware wallet reconnect: the renderer half that keeps a paired device
// usable after a lock, a wallet switch or a reload.
//
// A live TrezorSigner or LedgerSigner exists only while its transport is open,
// and a lock closes that transport. So each shell registers a session signer
// per SignerRecord instead of the live one: it opens the device on the first
// sign (silently, through the permission the browser already holds), forgets
// it whenever the transports are reset, and runs signPsbt and signMessage
// under hardwareSession.runSignOp so the sign page shows progress. When the
// silent open or the device fails, the op stays on the sign page: Back
// rejects it with HW_SIGN_BACK, and Try again (a click, which WebHID and the
// Trezor Connect popup need) runs ensureLive and the op again.

import { isDeviceSignerKind } from '../schemas/constants.js';
import * as hardwareSession from './hardwareSession.js';
import { isLedgerIdentity, ledgerIdentityFingerprint } from './ledgerIdentity.js';
import { isWebHidSupported } from '../shared/utils/webhidSupport.js';
import { isNativeShell } from '../shared/nativeShell.js';


/** @type {Record<string, Function | null | undefined>} vendor -> shell pair factory */
let shellFactories = {};
// Bumped by every transport reset; a live signer opened under an older value is stale.
let generation = 0;
/** @type {((signerId: string) => Promise<any>) | null} the host's current SignerRecord for an id */
let recordSource = null;

/**
 * Give the reconnect layer a way to read a SignerRecord fresh from the host
 * (the shell's signer list). A sign whose network the bridge's copy of the
 * record has no Ledger identity for re-reads the record before anything
 * else: the network was usually added after that copy was taken.
 * @param {((signerId: string) => Promise<any>) | null} fn
 */
export function setHardwareRecordSource(fn) {
    recordSource = typeof fn === 'function' ? fn : null;
}

/** Whether a record holds a Ledger identity for a chain. */
function hasIdentity(record, chainId) {
    return Boolean(chainId) && isLedgerIdentity(record?.identities?.[chainId]);
}

/** The key path a sign names: a message's path, or the first PSBT input's. */
function signingPathOf(payload) {
    if (typeof payload?.path === 'string' && payload.path.startsWith('m/')) return payload.path;
    const entries = Array.isArray(payload?.signingPaths) ? payload.signingPaths : [];
    const first = entries.find((entry) => typeof entry?.path === 'string' && entry.path.startsWith('m/'));
    return first ? first.path : null;
}

/**
 * Give the reconnect layer this shell's pair factories (vendor -> function
 * returning `{ signer, pairingInfo }`). A null factory means the vendor does
 * not work in this shell.
 * @param {Record<string, Function | null | undefined>} factories
 */
export function setHardwareFactories(factories) {
    shellFactories = { ...(factories || {}) };
}

/** @returns {Record<string, Function | null | undefined>} */
export function getHardwareFactories() {
    return shellFactories;
}

/**
 * The vendors whose factory can reach a device here: Ledger needs WebHID,
 * and the Trezor Connect popup does not run inside the native app.
 * @param {Record<string, Function | null | undefined>} [factories]
 * @param {{ webHid?: boolean, native?: boolean }} [env] injectable for tests
 * @returns {string[]}
 */
export function workingHardwareVendors(factories = shellFactories, env = {}) {
    const webHid = env.webHid ?? isWebHidSupported();
    const native = env.native ?? isNativeShell();
    const out = [];
    if (typeof factories?.trezor === 'function' && !native) out.push('trezor');
    if (typeof factories?.ledger === 'function' && webHid) out.push('ledger');
    return out;
}

/** Forget every opened device; the next sign reopens it. Called on each transport reset. */
export function invalidateLiveSigners() {
    generation += 1;
}

/**
 * Open the device a SignerRecord names through this shell's factory and
 * check it is the same device.
 * @param {{ vendor?: string, deviceIdentifier?: string, identities?: object }} record
 * @param {Record<string, Function | null | undefined>} [factories]
 * @param {{ chainId?: string, read?: boolean }} [opts]  the chain of the
 *   operation; a Ledger is checked through the app for that chain when it is
 *   open. read: the operation only reads (see hardwareSession.ensureLive)
 * @returns {Promise<any>} the live signer
 */
export async function openHardwareSigner(record, factories = shellFactories, opts = {}) {
    const { signer } = await hardwareSession.ensureLive(record, /** @type {any} */ (factories), opts);
    if (!signer) {
        const err = /** @type {Error & {code: string}} */ (new Error('Could not open the hardware wallet.'));
        err.code = 'HW_NOT_CONNECTED';
        throw err;
    }
    return signer;
}

/**
 * Build the signer a bridge registers for one SignerRecord. It satisfies the
 * Signer interface the bridges dispatch to, opens the device lazily, and
 * runs signPsbt and signMessage (only those) under hardwareSession.
 *
 * @param {{ id: string, vendor?: string, model?: string, deviceIdentifier?: string, identities?: object }} record
 * @param {{ live?: any, open?: (record: object, opts: { chainId?: string, read?: boolean }) => Promise<any> }} [opts]
 */
export function makeHardwareSessionSigner(record, opts = {}) {
    let current = { ...record };
    const open = opts.open || ((r, o) => openHardwareSigner(r, undefined, o));
    let live = opts.live || null;
    let liveGeneration = live ? generation : -1;
    // What the open device is trusted to sign for. `true`: it passed the full
    // check (or the pairing flow handed it over). A Set: it was taken
    // unchecked for a first read on a network the record had no Ledger
    // identity for, so it matched none of the record's identities; it may
    // serve reads, and signs only on the networks whose identity it just
    // defined. Any other sign reopens it under the full check.
    /** @type {true | Set<string>} */
    let liveTrust = true;
    /** @type {Promise<any> | null} */
    let opening = null;
    let openingVerified = true;

    function peek() {
        return live && liveGeneration === generation ? live : null;
    }

    function trusts(chainId) {
        return liveTrust === true || liveTrust.has(chainId);
    }

    // chainId: the operation's chain, so a Ledger is checked through the app
    // that chain needs (see hardwareSession.ensureLive). read: the operation
    // only reads, so a network with no identity yet may be read unchecked.
    function connect(chainId, { read = false } = {}) {
        const ready = peek();
        if (ready && (read || trusts(chainId))) return Promise.resolve(ready);
        if (opening && (read || openingVerified)) return opening;
        // A sign never joins a read's open: it waits for it, then opens checked.
        const before = opening;
        const verified = !(read && current.vendor === 'ledger' && !hasIdentity(current, chainId));
        const openedUnder = generation;
        const attempt = Promise.resolve(before ? before.catch(() => {}) : undefined)
            .then(() => open(current, read ? { chainId, read: true } : { chainId }))
            .then((signer) => {
                live = signer;
                liveGeneration = openedUnder;
                liveTrust = verified ? true : new Set();
                return signer;
            })
            .finally(() => {
                if (opening === attempt) opening = null;
            });
        opening = attempt;
        openingVerified = verified;
        return attempt;
    }

    function drop() {
        live = null;
        liveGeneration = -1;
    }

    // Keep an identity the current session recorded when a newer record from the
    // host does not carry it yet; the host's own entries win.
    function adoptRecord(next) {
        const identities = { ...(current.identities || {}), ...(next?.identities || {}) };
        current = { ...current, ...next, id: current.id };
        if (Object.keys(identities).length) current.identities = identities;
    }

    // The add-network read records the network's identity: the path the
    // device was read at and a hash of the key it gave there (no key kept).
    // From here on every read and sign on the network checks it.
    function recordIdentity(chainId, path, publicKey) {
        if (current.vendor !== 'ledger' || !chainId || hasIdentity(current, chainId)) return;
        let fingerprint;
        try {
            fingerprint = ledgerIdentityFingerprint(publicKey);
        } catch {
            return;
        }
        if (typeof path !== 'string' || !path.startsWith('m/')) return;
        current = { ...current, identities: { ...(current.identities || {}), [chainId]: { path, fingerprint } } };
        // The device open now is the one whose key was just recorded: trusted
        // for this network only, never for one it did not prove itself on.
        if (peek() && liveTrust !== true) liveTrust.add(chainId);
    }

    // Before a network with no identity is taken on trust, re-read the record:
    // the bridge's copy may predate the network, and the host may hold its
    // identity already.
    async function refreshRecord() {
        if (!recordSource) return;
        try {
            const fresh = await recordSource(current.id);
            if (fresh && typeof fresh === 'object') adoptRecord(fresh);
        } catch {
            // An unreadable list leaves the record as it was.
        }
    }

    // A read through the device. A device opened for an earlier op that now
    // answers wrong-app or unplugged (the Ledger re-enumerates when its app
    // changes) is reopened once, so Try again reaches the app open now.
    async function readThrough(chainId, call) {
        if (current.vendor === 'ledger' && chainId && !hasIdentity(current, chainId)) await refreshRecord();
        const cached = peek();
        const signer = await connect(chainId, { read: true });
        try {
            return await call(signer);
        } catch (err) {
            const kind = hardwareSession.failureKind(err);
            if (signer !== cached || (kind !== 'wrong-app' && kind !== 'unplugged')) throw err;
            drop();
            return call(await connect(chainId, { read: true }));
        }
    }

    // Open the device for a sign. A Ledger whose open app serves the sign's
    // network while the record has no identity for it is not a wrong app: the
    // network was never read here. Re-read the record (the network was usually
    // added after the bridge took its copy), and failing that take the
    // add-network read at the key the sign uses, record it, then sign.
    async function connectForSign(payload) {
        const chainId = payload?.chainId;
        try {
            return await connect(chainId);
        } catch (err) {
            if (current.vendor !== 'ledger' || !hardwareSession.isNetworkUnreadError(err)) throw err;
            if (recordSource) {
                await refreshRecord();
                if (hasIdentity(current, chainId)) return connect(chainId);
            }
            const path = signingPathOf(payload);
            if (!path) throw err;
            const signer = await connect(chainId, { read: true });
            const key = await signer.getPublicKey({ chainId, path });
            recordIdentity(chainId, path, key?.publicKey);
            if (!hasIdentity(current, chainId)) throw err;
            return signer;
        }
    }

    function sign(op, payload) {
        return hardwareSession.runSignOp(
            {
                signerId: current.id,
                vendor: current.vendor,
                model: current.model || '',
                op,
                chainId: payload?.chainId,
            },
            async ({ step }) => {
                const signer = await connectForSign(payload);
                step('connected');
                let status = null;
                try {
                    status = await signer.getStatus?.({ chainId: payload?.chainId });
                } catch {
                    // A status read that fails says nothing the sign call will not.
                }
                const statusText = typeof status === 'string' ? status : status?.status;
                const unlocked = statusText !== 'locked';
                if (unlocked) step('unlocked');
                step('confirm');
                const result = await signer[op](payload);
                if (!unlocked) step('unlocked');
                return result;
            },
            {
                // Try again: reopen the device inside the user's click.
                ensure: async () => {
                    drop();
                    await connectForSign(payload);
                },
            },
        );
    }

    return {
        isHardwareSessionSigner: true,
        get id() { return current.id; },
        get kind() { return current.vendor; },
        get vendor() { return current.vendor; },
        get model() { return current.model; },
        get deviceIdentifier() { return current.deviceIdentifier; },
        get record() { return { ...current }; },
        /** Take a signer the pairing flow just opened, or newer record fields. */
        adopt(next = {}) {
            if (next.record) adoptRecord(next.record);
            if (next.live) {
                live = next.live;
                liveGeneration = generation;
                liveTrust = true;
            }
        },
        isLive() {
            return Boolean(peek());
        },
        // A status poll never opens the device (that could prompt); until the
        // first sign opens it, the sign page owns the connection state.
        async getStatus(params) {
            const signer = peek();
            if (!signer) return 'available';
            return signer.getStatus(params);
        },
        // Reads may take a network the record has no identity for yet (the
        // add-network read); the first address read there records it.
        async getAddresses(params) {
            const chainId = params?.chainId;
            const derived = await readThrough(chainId, (signer) => signer.getAddresses(params));
            if (current.vendor === 'ledger' && !hasIdentity(current, chainId) && Array.isArray(derived)) {
                const first = [...derived]
                    .filter((entry) => entry && typeof entry.path === 'string')
                    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
                if (first) recordIdentity(chainId, first.path, first.publicKey);
            }
            return derived;
        },
        async getPublicKey(params) {
            return readThrough(params?.chainId, (signer) => signer.getPublicKey(params));
        },
        signPsbt(params) {
            return sign('signPsbt', params);
        },
        signMessage(params) {
            return sign('signMessage', params);
        },
    };
}

/**
 * The record fields a live signer carries, for a pairing that registers the
 * signer before the shell has read its SignerRecord.
 * @param {string} signerId
 * @param {any} signer
 */
export function recordFromLiveSigner(signerId, signer) {
    const vendor = isDeviceSignerKind(signer?.vendor) ? signer.vendor
        : isDeviceSignerKind(signer?.kind) ? signer.kind : null;
    return {
        id: signerId,
        vendor,
        model: signer?.model ?? null,
        deviceIdentifier: signer?.deviceIdentifier ?? null,
    };
}

/**
 * Whether a SignerRecord (or live signer) is a Trezor or Ledger the
 * reconnect layer should wrap.
 * @param {{ vendor?: string, kind?: string } | null | undefined} recordOrSigner
 */
export function isHardwareVendorRecord(recordOrSigner) {
    return isDeviceSignerKind(recordOrSigner?.vendor) || isDeviceSignerKind(recordOrSigner?.kind);
}

/**
 * What a bridge stores for a registration. A Trezor or Ledger is wrapped in a
 * session signer (reusing the one already registered for the id, so a lazy
 * registration made at unlock simply adopts the device a pairing opened);
 * any other signer is stored as given.
 * @param {any} existing  the bridge's current entry for signerId
 * @param {string} signerId
 * @param {any} signer
 */
export function sessionSignerFor(existing, signerId, signer) {
    if (signer?.isHardwareSessionSigner) return signer;
    if (!isHardwareVendorRecord(signer)) return signer;
    if (existing?.isHardwareSessionSigner) {
        existing.adopt({ live: signer });
        return existing;
    }
    return makeHardwareSessionSigner(recordFromLiveSigner(signerId, signer), { live: signer });
}

/**
 * What a bridge stores when the unlock pass registers a SignerRecord with no
 * device open yet.
 * @param {any} existing
 * @param {{ id: string, vendor?: string, model?: string, deviceIdentifier?: string }} record
 */
export function sessionSignerForRecord(existing, record) {
    if (existing?.isHardwareSessionSigner) {
        existing.adopt({ record });
        return existing;
    }
    return makeHardwareSessionSigner(record);
}

/**
 * What a connect flow hands the shell's `onSignerPaired` once the wallet is
 * saved: the open device inside a session signer built from the saved
 * SignerRecord, so the bridge holds the record's per-chain Ledger identities
 * from the first moment instead of waiting for the next signer list. Every
 * shell bridge stores a session signer as given (sessionSignerFor). A record
 * that is not a Trezor or Ledger, or no record, leaves the live signer as is.
 *
 * @param {{ id?: string, vendor?: string } | null | undefined} record  the saved SignerRecord
 * @param {any} live  the signer the pairing factory opened
 */
export function pairedSessionSigner(record, live) {
    if (!live || !record?.id || !isHardwareVendorRecord(record)) return live;
    return makeHardwareSessionSigner({ ...record }, { live });
}

/** Test hook: forget the factories and every opened device. */
export function _resetHardwareReconnectForTests() {
    shellFactories = {};
    recordSource = null;
    generation += 1;
}
