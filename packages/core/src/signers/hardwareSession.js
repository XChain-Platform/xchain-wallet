// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Hardware signing session: a tiny in-memory event store that the renderer
// signer bridge writes around signPsbt and signMessage, and that the sign
// page reads. It exists so the page can show device progress (connected,
// unlocked, confirm, signed), so Try again can re-run a failed op, and so
// Back can reject an op in flight with HW_SIGN_BACK. Never used for status
// polls.
//
// A bridge either drives the store by hand (begin, step, fail, end) or wraps
// the device call in runSignOp, which does all of it: a failed attempt stays
// on the sign page until the user picks Try again (run `ensure`, then the
// attempt again) or Back (reject with HW_SIGN_BACK).

import { checkLedgerIdentity, isLedgerIdentity } from './ledgerIdentity.js';

/**
 * @typedef {'connected'|'unlocked'|'confirm'|'signed'} HwStep
 * @typedef {'unplugged'|'rejected'|'timeout'|'wrong-app'|'other'} HwFailureKind
 * @typedef {{kind: HwFailureKind}} HwFailure
 * @typedef {{opId: string, signerId: string, vendor: string, model: string,
 *   op: string, chainId: string|null, steps: HwStep[], failure: HwFailure|null,
 *   ended: boolean}} HwOp
 * @typedef {{type: 'begin'|'step'|'fail'|'retry'|'end', op: HwOp}} HwEvent
 */

/** The only ops the sign page is shown for. */
export const SIGN_OPS = Object.freeze(['signPsbt', 'signMessage']);

/** The four steps in the order the sign page draws them. */
export const HW_STEPS = Object.freeze(['connected', 'unlocked', 'confirm', 'signed']);

export const HW_SIGN_BACK = 'HW_SIGN_BACK';

/** @type {Map<string, HwOp>} */
const ops = new Map();
/** @type {Map<string, (err: Error) => void>} */
const rejecters = new Map();
/** @type {Map<string, () => void>} */
const retriers = new Map();
/** @type {Set<(event: HwEvent) => void>} */
const listeners = new Set();
let counter = 0;

function copy(op) {
    return { ...op, steps: [...op.steps], failure: op.failure ? { ...op.failure } : null };
}

function emit(type, op) {
    const event = { type, op: copy(op) };
    for (const fn of [...listeners]) {
        try { fn(event); } catch { /* one listener cannot stop the others */ }
    }
}

/**
 * Start tracking a sign op.
 * @param {{signerId: string, vendor: string, model: string, op: string,
 *   chainId?: string|null, reject?: (err: Error) => void, retry?: () => void}} input
 *   chainId is the chain being signed on, when the caller knows it (the sign
 *   page words a Ledger's regtest display from it); reject is called by
 *   cancel(); retry is called by retry().
 * @returns {string} opId
 */
export function begin({ signerId, vendor, model, op, chainId, reject, retry }) {
    counter += 1;
    const opId = `hwop-${counter}`;
    const entry = {
        opId,
        signerId,
        vendor,
        model,
        op,
        chainId: typeof chainId === 'string' && chainId ? chainId : null,
        steps: [],
        failure: null,
        ended: false,
    };
    ops.set(opId, entry);
    if (typeof reject === 'function') rejecters.set(opId, reject);
    if (typeof retry === 'function') retriers.set(opId, retry);
    emit('begin', entry);
    return opId;
}

/**
 * Record a device step. A step already recorded is not recorded twice.
 * @param {string} opId
 * @param {HwStep} name
 */
export function step(opId, name) {
    const entry = ops.get(opId);
    if (!entry || entry.ended || entry.steps.includes(name)) return;
    entry.steps.push(name);
    emit('step', entry);
}

/**
 * Record a failure on the op. The op stays open: the sign page shows Try
 * again until retry() or cancel().
 * @param {string} opId
 * @param {HwFailure} failure
 */
export function fail(opId, failure) {
    const entry = ops.get(opId);
    if (!entry || entry.ended) return;
    entry.failure = failure;
    emit('fail', entry);
}

/**
 * Try again from the sign page: clear the failure and the steps, then hand
 * control back to whoever began the op.
 * @param {string} opId
 */
export function retry(opId) {
    const entry = ops.get(opId);
    if (!entry || entry.ended) return;
    entry.failure = null;
    entry.steps = [];
    emit('retry', entry);
    retriers.get(opId)?.();
}

/**
 * Finish the op and forget it.
 * @param {string} opId
 */
export function end(opId) {
    const entry = ops.get(opId);
    if (!entry) return;
    entry.ended = true;
    ops.delete(opId);
    rejecters.delete(opId);
    retriers.delete(opId);
    emit('end', entry);
}

/**
 * Watch every session event.
 * @param {(event: HwEvent) => void} fn
 * @returns {() => void} unsubscribe
 */
export function subscribe(fn) {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}

/**
 * The newest open sign op, for a page that mounts after it began.
 * @returns {HwOp|null}
 */
export function current() {
    let latest = null;
    for (const entry of ops.values()) {
        if (SIGN_OPS.includes(entry.op)) latest = entry;
    }
    return latest ? copy(latest) : null;
}

/**
 * The error Back rejects an op with. The code rides in the message too,
 * because the signer port between the renderer and the background carries
 * only an error's name and message.
 * @returns {Error & {code: string}}
 */
export function hwSignBackError() {
    const err = /** @type {Error & {code: string}} */ (
        new Error(`Signing stopped from the hardware wallet page (${HW_SIGN_BACK}).`)
    );
    err.name = 'HardwareSignBackError';
    err.code = HW_SIGN_BACK;
    return err;
}

/**
 * True when an error is Back on the sign page, wherever it surfaced: the
 * renderer bridge, the background host or a form's submit call.
 * @param {any} err
 * @returns {boolean}
 */
export function isHwSignBack(err) {
    if (!err) return false;
    if (err.code === HW_SIGN_BACK || err.reason === HW_SIGN_BACK) return true;
    if (err.name === 'HardwareSignBackError') return true;
    return String(err.message || '').includes(HW_SIGN_BACK)
        || (err.cause ? isHwSignBack(err.cause) : false);
}

/**
 * Back from the sign page: reject the op with code HW_SIGN_BACK.
 * @param {string} opId
 */
export function cancel(opId) {
    const reject = rejecters.get(opId);
    if (reject) reject(hwSignBackError());
    end(opId);
}

function errorText(err) {
    return [err?.code, err?.name, err?.status, err?.message]
        .filter((v) => v !== undefined && v !== null)
        .join(' ');
}

// The open Ledger app is not the one the chain needs: the typed code and
// status, the signer's plain message (all a signer port carries across), or
// the raw APDU refusals a path outside the open app's coin type draws.
const WRONG_APP_RE = /HW_WRONG_APP|wrong[- ]app|0x6a82|0x6e00|0x6d00|0x6511|cla_not_supported|ins_not_supported/i;

/**
 * True when a device error means another app is open than the chain needs.
 * @param {any} err
 * @returns {boolean}
 */
export function isWrongAppError(err) {
    return Boolean(err) && WRONG_APP_RE.test(errorText(err));
}

/**
 * Sort a device error into the kinds the sign page words.
 * @param {any} err
 * @returns {HwFailureKind}
 */
export function failureKind(err) {
    const text = errorText(err);
    if (/time[d ]?\s?out/i.test(text)) return 'timeout';
    if (WRONG_APP_RE.test(text)) return 'wrong-app';
    if (/HW_NOT_CONNECTED|HW_DEVICE_NOT_FOUND|not connected|disconnected|unplugged|no (?:compatible )?device|device.*not found|not found.*device|transport.*(?:closed|unavailable|missing)|SignerNotRegistered/i.test(text)) {
        return 'unplugged';
    }
    if (/reject|denied|declined|cancel|0x6985|Failure_ActionCancelled/i.test(text)) return 'rejected';
    return 'other';
}

/**
 * Run one device sign op under the session. A non-sign op runs straight
 * through. A failure stays on the sign page until the user picks Try again
 * (which runs `ensure`, then `attempt` again) or Back (which rejects with
 * HW_SIGN_BACK). With no sign page listening, a failure rejects at once,
 * so a shell without the page never hangs.
 *
 * @template T
 * @param {{signerId: string, vendor: string, model?: string, op: string, chainId?: string}} info
 * @param {(ctx: {opId: string|null, step: (name: HwStep) => void}) => Promise<T>} attempt
 * @param {{ensure?: (ctx: {opId: string}) => Promise<void>}} [opts]
 *   ensure reconnects the device before a retry (ensureLive plus the
 *   bridge's own registration).
 * @returns {Promise<T>}
 */
export function runSignOp(info, attempt, { ensure } = {}) {
    if (!SIGN_OPS.includes(info?.op)) {
        return Promise.resolve().then(() => attempt({ opId: null, step: () => {} }));
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        /** @type {null | (() => void)} */
        let wake = null;
        const settle = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };
        const opId = begin({
            signerId: info.signerId,
            vendor: info.vendor,
            model: info.model || '',
            op: info.op,
            chainId: info.chainId,
            reject: (err) => {
                settle(reject, err);
                const w = wake;
                wake = null;
                w?.();
            },
            retry: () => {
                const w = wake;
                wake = null;
                w?.();
            },
        });
        const ctx = { opId, step: (name) => step(opId, name) };
        (async () => {
            let reconnect = false;
            for (;;) {
                try {
                    if (reconnect && typeof ensure === 'function') await ensure({ opId });
                    const result = await attempt(ctx);
                    if (settled) return;
                    step(opId, 'signed');
                    settle(resolve, result);
                    end(opId);
                    return;
                } catch (err) {
                    if (settled) return;
                    if (isHwSignBack(err) || listeners.size === 0) {
                        settle(reject, err);
                        end(opId);
                        return;
                    }
                    fail(opId, { kind: failureKind(err) });
                    await new Promise((r) => { wake = r; });
                    if (settled) return;
                    reconnect = true;
                }
            }
        })();
    });
}

function wrongDeviceError() {
    const err = /** @type {Error & {code: string}} */ (
        new Error('This is a different hardware wallet. Connect the one this wallet uses.')
    );
    err.code = 'HW_WRONG_DEVICE';
    return err;
}

/**
 * Whether the open Ledger app serves the operation's chain while the record
 * holds no identity for it: the only unconfirmed case a read may pass.
 * @param {{identities?: Record<string, unknown>}} record
 * @param {{pairingInfo?: {chainIds?: string[]}}} live
 * @param {string | undefined} chainId
 */
function servesUnreadChain(record, live, chainId) {
    if (typeof chainId !== 'string' || !chainId) return false;
    const served = Array.isArray(live?.pairingInfo?.chainIds) ? live.pairingInfo.chainIds : [];
    if (!served.includes(chainId)) return false;
    const identities = record?.identities && typeof record.identities === 'object' ? record.identities : {};
    return !isLedgerIdentity(identities[chainId]);
}

/**
 * The code a sign gets when the open Ledger app serves the operation's chain
 * but the record holds no identity for that chain yet: the right app is open,
 * the network was never read from it. The cure is the add-network read
 * (record the identity, then sign), never "open another app".
 */
export const HW_NETWORK_UNREAD = 'HW_NETWORK_UNREAD';

/**
 * The code rides in the message too: the signer port carries only an error's
 * name and message. The words avoid every wrong-app token on purpose.
 * @returns {Error & {code: string}}
 */
function networkUnreadError() {
    const err = /** @type {Error & {code: string}} */ (new Error(
        `This network has not been read from your Ledger for this wallet yet (${HW_NETWORK_UNREAD}).`,
    ));
    err.code = HW_NETWORK_UNREAD;
    return err;
}

/**
 * True when an error is the no-identity-yet refusal, wherever it surfaced.
 * @param {any} err
 * @returns {boolean}
 */
export function isNetworkUnreadError(err) {
    if (!err) return false;
    return err.code === HW_NETWORK_UNREAD || String(err.message || '').includes(HW_NETWORK_UNREAD);
}

/**
 * Make sure the device for a signer record is live: run the vendor factory
 * and check the device it found is the one the record was paired with.
 *
 * A Trezor reports one device id whatever coin is in use. A Ledger does not:
 * each coin app answers only its own coin type, so the check runs through
 * the app that is open, against the record's identity for a chain that app
 * serves (the operation's chain first). See ledgerIdentity.js.
 *
 * A network the record has no identity for yet, read through an app that
 * serves it, cannot be checked: the device never answered in that app. A
 * read (`read: true`) is accepted there, the same way the connect flow
 * accepts it, and its caller records the identity it reads; a sign is
 * refused with HW_NETWORK_UNREAD, so it can take that read first. Every
 * later read and sign on the network checks the recorded identity.
 *
 * @param {{vendor?: string, deviceIdentifier?: string,
 *   identities?: Record<string, {path: string, fingerprint: string}>}} record
 * @param {Record<string, (() => Promise<{signer: any, pairingInfo: {deviceIdentifier?: string}}>) | null | undefined>} factories
 *   keyed by vendor, the shell's pairTrezor and pairLedger.
 * @param {{chainId?: string, read?: boolean}} [opts]  the chain of the
 *   operation the device is opened for, and whether it only reads
 * @returns {Promise<{signer: any, pairingInfo: object, firstRead?: boolean}>}
 *   firstRead: the device was taken unchecked for a read on a network the
 *   record has no identity for
 */
export async function ensureLive(record, factories, { chainId, read = false } = {}) {
    const factory = factories?.[record?.vendor];
    if (typeof factory !== 'function') {
        const err = /** @type {Error & {code: string}} */ (
            new Error('This hardware wallet cannot connect in this app.')
        );
        err.code = 'HW_NOT_CONNECTED';
        throw err;
    }
    const live = await factory();
    if (record.vendor === 'ledger') {
        const { verdict } = await checkLedgerIdentity(record, live, { chainId });
        if (verdict === 'different') throw wrongDeviceError();
        if (verdict === 'unconfirmed') {
            if (servesUnreadChain(record, live, chainId)) {
                if (read) return { signer: live?.signer, pairingInfo: live?.pairingInfo || {}, firstRead: true };
                throw networkUnreadError();
            }
            const app = live?.pairingInfo?.appName;
            // "wrong app" stays in the words: across the signer port only the
            // message survives, and isWrongAppError reads it.
            const err = /** @type {Error & {code: string}} */ (new Error(
                `${app ? `The wrong app is open: the ${app} app can't confirm this is the Ledger this wallet uses. ` : 'The wrong app is open on your Ledger. '}`
                + 'Open the app for the network you are signing on, then try again.',
            ));
            err.code = 'HW_WRONG_APP';
            throw err;
        }
        return { signer: live?.signer, pairingInfo: live?.pairingInfo || {} };
    }
    const found = live?.pairingInfo?.deviceIdentifier;
    if (record.deviceIdentifier && found !== record.deviceIdentifier) throw wrongDeviceError();
    return { signer: live?.signer, pairingInfo: live?.pairingInfo || {} };
}
