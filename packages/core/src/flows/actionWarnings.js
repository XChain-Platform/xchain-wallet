// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// What a transaction does that cannot be taken back, said once on the confirm
// screen (operator ruling 2026-11-14: these warnings belong on the review, not
// on the form). One registry, keyed by action kind, holds the short lines;
// one classifier reads the PARSED COMPOSED action, so the warning describes
// the bytes being signed, never what a form believed it asked for.
//
// The classifier runs host-side in composeActionForConfirm, next to the parse
// it needs; the confirm screen receives only the ids and renders their lines
// in its short warning after the details.

import { irreversibleConfirmWord } from '../shared/utils/irreversibleActionGate.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/actionWarnings.js';

// One warning line: its `actionWarnings.*` locale key, as a catalogue row so
// the i18n key checks can read every key this registry renders.
const line = (labelKey) => Object.freeze({ labelKey });

/**
 * Warning lines per action kind (copy in i18n/locales/en/actionWarnings.js):
 * one short line each, under the kind's title below (G127 revised
 * 2026-11-16: a title plus one line, the most important fact). Order is
 * display order.
 */
export const ACTION_WARNINGS = Object.freeze({
    LIST_TRANSFER: Object.freeze([
        line('actionWarnings.listTransfer.newOwnerOnly'),
    ]),
    LIST_SHARE: Object.freeze([
        line('actionWarnings.listShare.permanent'),
    ]),
    TOKEN_OWNERSHIP_TRANSFER: Object.freeze([
        line('actionWarnings.tokenTransfer.newOwnerOnly'),
    ]),
    TOKEN_LOCK: Object.freeze([
        line('actionWarnings.tokenLock.permanent'),
    ]),
    DESTROY: Object.freeze([
        line('actionWarnings.destroy.permanent'),
    ]),
    ADDRESS_LOCK: Object.freeze([
        line('actionWarnings.addressLock.noEarlyWake'),
    ]),
    TOKEN_PAUSE: Object.freeze([
        line('actionWarnings.tokenPause.transfersRejected'),
    ]),
    SWEEP: Object.freeze([
        line('actionWarnings.sweep.everythingMoves'),
    ]),
    CONTROLLER_BIND: Object.freeze([
        line('actionWarnings.controllerBind.gates'),
    ]),
    CONTROLLER_UNBIND: Object.freeze([
        line('actionWarnings.controllerUnbind.cooldown'),
    ]),
    DISPENSER_CLOSE: Object.freeze([
        line('actionWarnings.dispenserClose.escrowReturns'),
    ]),
    DELEGATION_CLEAR: Object.freeze([
        line('actionWarnings.delegationClear.stops'),
    ]),
    CALLBACK: Object.freeze([
        line('actionWarnings.callback.recallsAll'),
    ]),
    // The title says the terms are final; the line says what only the
    // creator must still do.
    MARKET_CREATE: Object.freeze([
        line('actionWarnings.marketCreate.oracleDuty'),
    ]),
    MARKET_RESOLVE: Object.freeze([
        line('actionWarnings.marketResolve.paysOut'),
    ]),
    MARKET_CANCEL: Object.freeze([
        line('actionWarnings.marketCancel.refundsAll'),
    ]),
    BRIDGE_MOVE: Object.freeze([
        line('actionWarnings.bridgeMove.noUndo'),
    ]),
    ORDER_CANCEL: Object.freeze([
        line('actionWarnings.orderCancel.closes'),
    ]),
    SWAP_CANCEL: Object.freeze([
        line('actionWarnings.swapCancel.closes'),
    ]),
});

const NO_UNDO_TITLE = line('actionWarnings.noUndo.title');

/**
 * The notice's bold title per kind, so a kind says what it does in the title
 * and keeps its lines short. When one action carries several ids, the first
 * id's title is the notice's title and every id's lines follow it.
 */
export const ACTION_WARNING_TITLES = Object.freeze({
    LIST_TRANSFER: NO_UNDO_TITLE,
    LIST_SHARE: line('actionWarnings.listShare.title'),
    TOKEN_OWNERSHIP_TRANSFER: NO_UNDO_TITLE,
    TOKEN_LOCK: NO_UNDO_TITLE,
    DESTROY: NO_UNDO_TITLE,
    ADDRESS_LOCK: line('actionWarnings.addressLock.title'),
    TOKEN_PAUSE: line('actionWarnings.tokenPause.title'),
    SWEEP: NO_UNDO_TITLE,
    CONTROLLER_BIND: line('actionWarnings.controllerBind.title'),
    CONTROLLER_UNBIND: line('actionWarnings.controllerUnbind.title'),
    DISPENSER_CLOSE: line('actionWarnings.dispenserClose.title'),
    DELEGATION_CLEAR: line('actionWarnings.delegationClear.title'),
    CALLBACK: NO_UNDO_TITLE,
    MARKET_CREATE: line('actionWarnings.marketCreate.title'),
    MARKET_RESOLVE: NO_UNDO_TITLE,
    MARKET_CANCEL: NO_UNDO_TITLE,
    BRIDGE_MOVE: NO_UNDO_TITLE,
    ORDER_CANCEL: line('actionWarnings.orderCancel.title'),
    SWAP_CANCEL: line('actionWarnings.swapCancel.title'),
});

/**
 * The notice title for a list of ids: the first known id's, else null.
 *
 * @param {unknown} ids
 * @returns {string|null}
 */
export function actionWarningTitle(ids) {
    if (!Array.isArray(ids)) return null;
    const id = ids.find((value) => Object.prototype.hasOwnProperty.call(ACTION_WARNING_TITLES, value));
    return id ? t(ACTION_WARNING_TITLES[id].labelKey) : null;
}

// The describer lines that say what a card id already says, so the confirm
// screen states each fact once, in the card. The confirm screen's lines come
// from the SDK's describer (sdk.decoder.describe in composeActionForConfirm);
// a watcher review's come from the wallet's local in-form describer, which
// words a few of them differently, so both spellings are listed. Only these
// go: the lint lines (an empty ticker, a memo with | or ;) stay.
const DECODER_LINES_COVERED = Object.freeze({
    LIST_TRANSFER: [/^This transfer cannot be undone\.$/, /^The new owner alone can edit, share or transfer the list\.$/],
    // The fee line names a protocol key; the Protocol fee row states the fee.
    LIST_SHARE: [/^Sharing is permanent\. There is no unshare\.$/, /^Sharing charges the LIST_SHARE fee\.$/],
    TOKEN_LOCK: [/^Locking is permanent\. (These properties|The bridge chains and minimum confirmations) cannot be changed/],
    DESTROY: [/^Destroying is irreversible\. The tokens cannot be recovered\.$/],
    // The SDK describes every SLEEP that is not a resume with the token-pause
    // line, an address lock included.
    ADDRESS_LOCK: [/^While locked, this address cannot send anything/, /^While asleep, transfers of the affected token are rejected\.$/],
    TOKEN_PAUSE: [/^While asleep, transfers of the affected token are rejected\.$/],
    SWEEP: [/^Sweep moves the selected /],
    CONTROLLER_BIND: [/^A controller contract will be able to veto or gate/],
    CONTROLLER_UNBIND: [/^Unbinding removes the controller policy/],
    DISPENSER_CLOSE: [/^Cancelling a dispenser returns the remaining escrow/],
    CALLBACK: [/^Callback redeems ALL holders' tokens/],
    MARKET_CREATE: [/^Market terms cannot be edited after this\./, /^You are the oracle: /],
    MARKET_RESOLVE: [/^This pays out the market\./, /^Resolving cannot be undone/],
    MARKET_CANCEL: [/^Every open bet is refunded in full and the market is over\./],
    BRIDGE_MOVE: [/^This (locks|burns) the tokens here and (credits|releases) them on (another|the other) chain\. /],
});

/**
 * The decoder's warning lines less those a card id already states.
 *
 * @param {unknown} warnings   decoded.warnings
 * @param {unknown} ids        the card's ids (actionWarningIds)
 * @returns {string[]}
 */
export function withoutCoveredWarnings(warnings, ids) {
    const lines = Array.isArray(warnings) ? warnings : [];
    if (!Array.isArray(ids) || ids.length === 0) return lines;
    const covered = ids.flatMap((id) => (
        Object.prototype.hasOwnProperty.call(DECODER_LINES_COVERED, id) ? DECODER_LINES_COVERED[id] : []
    ));
    if (covered.length === 0) return lines;
    return lines.filter((warning) => !covered.some((pattern) => pattern.test(String(warning))));
}

const text = (value) => String(value ?? '').trim();
const isSet = (value) => text(value) !== '' && text(value) !== '0';

/**
 * The warning ids for one parsed action. Empty for an action with nothing
 * irreversible to say (a plain send) and for anything unparsed.
 *
 * DESTROY, a token lock and an address lock reuse the typed-word gate's own
 * test (irreversibleConfirmWord), so the notice and the gate cannot disagree
 * about which actions are irreversible.
 *
 * @param {{ action?: string|null, version?: unknown, params?: Record<string, unknown>|null } | null | undefined} parsed
 * @returns {string[]}   keys of ACTION_WARNINGS
 */
export function actionWarningIds(parsed) {
    const action = text(parsed?.action).toUpperCase();
    if (!action) return [];
    const raw = parsed?.params && typeof parsed.params === 'object' ? parsed.params : {};
    const version = text(parsed?.version ?? raw.VERSION ?? raw.version);
    const params = { ...raw, VERSION: raw.VERSION ?? (version || undefined) };
    const ids = [];
    const word = irreversibleConfirmWord(action, params);

    switch (action) {
        case 'LIST':
            if (version === '3') ids.push('LIST_TRANSFER');
            if (version === '2') ids.push('LIST_SHARE');
            break;
        case 'ISSUE':
            if (isSet(params.TRANSFER)) ids.push('TOKEN_OWNERSHIP_TRANSFER');
            if (word === 'LOCK') ids.push('TOKEN_LOCK');
            break;
        case 'DESTROY':
            ids.push('DESTROY');
            break;
        case 'SLEEP':
            if (word === 'LOCK') ids.push('ADDRESS_LOCK');
            else if (text(params.RESUME_BLOCK) !== '0' && text(params.TICK) !== '') ids.push('TOKEN_PAUSE');
            break;
        case 'SWEEP':
            ids.push('SWEEP');
            break;
        case 'ADDRESS':
            if (version === '1') ids.push(text(params.UNBIND) === '1' ? 'CONTROLLER_UNBIND' : 'CONTROLLER_BIND');
            break;
        case 'DISPENSER':
            if (version === '1') ids.push('DISPENSER_CLOSE');
            break;
        case 'VOTE':
            if (version === '3' && text(params.DELEGATE_TO ?? params.delegateTo) === '') ids.push('DELEGATION_CLEAR');
            break;
        case 'CALLBACK':
            ids.push('CALLBACK');
            break;
        case 'BET':
            if (version === '0') ids.push('MARKET_CREATE');
            if (version === '3') ids.push('MARKET_RESOLVE');
            if (version === '1') ids.push('MARKET_CANCEL');
            break;
        case 'XBRIDGE':
            ids.push('BRIDGE_MOVE');
            break;
        case 'ORDER':
            if (version === '1') ids.push('ORDER_CANCEL');
            break;
        case 'SWAP':
            if (version === '1') ids.push('SWAP_CANCEL');
            break;
        default:
            break;
    }
    return ids;
}

/**
 * The locale keys for a list of ids, in order, dropping unknown ids and any
 * key repeated across ids.
 *
 * @param {unknown} ids
 * @returns {string[]}
 */
export function actionWarningKeys(ids) {
    return warningRows(ids).map((row) => row.labelKey);
}

/**
 * The lines the confirm screen shows for a list of ids, in the active locale.
 *
 * @param {unknown} ids
 * @returns {Array<{ key: string, text: string }>}
 */
export function actionWarningLines(ids) {
    return warningRows(ids).map((row) => ({ key: row.labelKey, text: t(row.labelKey) }));
}

function warningRows(ids) {
    if (!Array.isArray(ids)) return [];
    const rows = [];
    const seen = new Set();
    for (const id of ids) {
        const lines = Object.prototype.hasOwnProperty.call(ACTION_WARNINGS, id) ? ACTION_WARNINGS[id] : null;
        if (!lines) continue;
        for (const row of lines) {
            if (seen.has(row.labelKey)) continue;
            seen.add(row.labelKey);
            rows.push(row);
        }
    }
    return rows;
}
