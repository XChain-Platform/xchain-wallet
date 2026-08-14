// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Resuming a stored confirm (§5.4).
//
// A stored session has to be finishable WITHOUT its originating form, so what
// it carries is a messaging METHOD NAME plus the request body that method
// takes. That is a name crossing a trust boundary into a call, so it is
// allow-listed here rather than dispatched on trust - the same rule
// `action.vote.composeForConfirm` follows for its builder name.
//
// Two properties this module exists to hold:
//
//   1. **No credential is ever stored.** The session carries the composed PSBT
//      and how to submit it; the password (or the device) is collected fresh on
//      the resume screen, by the same <SignCredentials> every other confirm
//      uses. `assertNoCredentials` is what keeps a future opt-in from putting
//      one in the `base` by accident.
//
//   2. **A form's post-broadcast bookkeeping travels with it.** AirdropForm
//      writes its pending-airdrop record in the flow that FOLLOWS Approve, so
//      resuming its LIST leg without that write would broadcast the list and
//      orphan the airdrop mid-flight. `after` carries that call, with the
//      broadcast txid injected at `txidPath`, and `returnTo` names where the
//      user should land so the form picks the flow back up. A form whose
//      Approve cannot be completed this way simply does not opt in, and keeps
//      today's re-entry cost.

/**
 * Messaging methods a stored confirm may dispatch. Every entry is a submit
 * route that takes `prebuiltPsbt`, so a resumed approve signs the byte-
 * identical PSBT the user previewed (§5.3) rather than composing a new one.
 *
 * Adding a name here is a deliberate act: it says this route completes the
 * action by itself, or that the opting-in form declared an `after`.
 */
export const RESUMABLE_DISPATCH_METHODS = Object.freeze([
    'sendToken', 'sendAssetHw',
    'createList', 'createListHw',
    'airdropAction', 'airdropActionHw',
]);

/** Follow-up calls an `after` descriptor may make. Bookkeeping only: none of
 *  these sign, broadcast, or move value. */
export const RESUMABLE_AFTER_METHODS = Object.freeze([
    'savePendingAirdrop',
]);

/** Fields that must never appear in a stored request body. */
const CREDENTIAL_KEYS = Object.freeze(['password', 'mnemonic', 'passphrase', 'bip39Passphrase', 'privateKey', 'wif']);

/**
 * Sessions older than this are not offered. A confirm the user walked away
 * from an hour ago is one whose fee rate, balances and utxo set have all moved
 * on; the input-liveness gate would usually catch it, but not offering a
 * clearly-abandoned confirm is cheaper than proving each one dead.
 */
export const RESUME_TTL_MS = 60 * 60 * 1000;

/**
 * @param {object} base
 * @throws {Error} when a credential rode along in a stored body
 */
export function assertNoCredentials(base) {
    if (!base || typeof base !== 'object') return;
    for (const key of CREDENTIAL_KEYS) {
        if (base[key] != null) {
            throw new Error(`confirmResume: "${key}" must never be stored in a confirm session`);
        }
    }
}

/**
 * Is this stored session structurally safe to offer?
 *
 * @param {any} session
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isResumable(session, nowMs) {
    if (!session || typeof session !== 'object') return false;
    if (typeof session.id !== 'string' || !session.id) return false;
    if (!session.composed || typeof session.composed.psbt !== 'string' || !session.composed.psbt) return false;
    const d = session.dispatch;
    if (!d || typeof d !== 'object') return false;
    if (!RESUMABLE_DISPATCH_METHODS.includes(d.software)) return false;
    if (d.hardware != null && !RESUMABLE_DISPATCH_METHODS.includes(d.hardware)) return false;
    if (d.after && !RESUMABLE_AFTER_METHODS.includes(d.after.method)) return false;
    try { assertNoCredentials(d.base); } catch { return false; }
    const createdAt = Number(session.createdAt);
    if (!Number.isFinite(createdAt)) return false;
    if (nowMs - createdAt > RESUME_TTL_MS) return false;
    return true;
}

/**
 * Which method a resumed approve dispatches, and with what body. The caller
 * adds the credential (`password`) or the `signerId`, never this module.
 *
 * @param {any} session
 * @param {{ isHw?: boolean }} [opts]
 * @returns {{ method: string, base: object }}
 */
export function resumeDispatch(session, { isHw = false } = {}) {
    if (!isResumable(session, Date.now())) {
        throw new Error('confirmResume: session is not resumable');
    }
    const d = session.dispatch;
    const method = isHw ? d.hardware : d.software;
    if (!method) {
        throw new Error('confirmResume: this confirm has no hardware lane');
    }
    if (!RESUMABLE_DISPATCH_METHODS.includes(method)) {
        throw new Error(`confirmResume: "${method}" is not an allow-listed dispatch`);
    }
    return { method, base: { ...(d.base || {}) } };
}

/**
 * The form's own post-broadcast call, with the txid it could not know until
 * the broadcast returned written into `txidPath`.
 *
 * @param {any} session
 * @param {string} txid
 * @returns {{ method: string, body: object } | null}
 */
export function resumeAfter(session, txid) {
    const after = session?.dispatch?.after;
    if (!after || !RESUMABLE_AFTER_METHODS.includes(after.method)) return null;
    const body = structuredCloneish(after.base || {});
    const path = Array.isArray(after.txidPath) ? after.txidPath : null;
    if (path && path.length > 0 && txid) {
        let cursor = body;
        for (let i = 0; i < path.length - 1; i += 1) {
            const key = path[i];
            // Guard against a malicious/corrupted `txidPath` walking into
            // Object.prototype (js/prototype-polluting-assignment): each
            // segment is checked immediately before it is used as a key.
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') { cursor = null; break; }
            if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {};
            cursor = cursor[key];
        }
        const lastKey = path[path.length - 1];
        if (cursor && lastKey !== '__proto__' && lastKey !== 'constructor' && lastKey !== 'prototype') {
            cursor[lastKey] = txid;
        }
    }
    return { method: after.method, body };
}

/**
 * One-line description of a stored confirm for the Home card. Reads the
 * COMPOSED action string, never the caller's request, for the same reason the
 * confirm surface itself does (§1): the string is what will broadcast.
 *
 * @param {any} session
 * @returns {{ id: string, chainId: string|null, action: string, label: string, ageMs: number }}
 */
export function describeResumeSession(session, nowMs = Date.now()) {
    const composed = session?.composed || {};
    const actionString = typeof composed.actionString === 'string' ? composed.actionString : '';
    const action = actionString.split('|')[0] || composed.action || 'action';
    return {
        id: session?.id,
        chainId: composed.chainId || session?.request?.chainId || null,
        action,
        label: session?.dispatch?.label || action,
        ageMs: Math.max(0, nowMs - Number(session?.createdAt || nowMs)),
    };
}

/**
 * Only the sessions worth offering, newest first.
 *
 * @param {any[]} sessions
 * @param {number} [nowMs]
 */
export function resumableSessions(sessions, nowMs = Date.now()) {
    return (Array.isArray(sessions) ? sessions : [])
        .filter((s) => isResumable(s, nowMs))
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
}

// structuredClone is not available in every shell/test environment this runs
// in, and the bodies here are plain JSON already.
function structuredCloneish(value) {
    return JSON.parse(JSON.stringify(value));
}
