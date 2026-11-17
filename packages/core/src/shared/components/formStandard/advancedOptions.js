// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The choices made in a form's Advanced section (fee bumping, coin
// control, change address), held outside React so they survive the
// form's picker pages (an early return unmounts the frame) and reach the
// compose call without any per-form code.
//
// One entry per form, network and source address. A form arms its entry
// when it is submitted (FormFrame does this), the compose layer reads the
// armed entry (withAdvancedOptions), and the entry is disarmed when the
// confirmation ends (useConfirmAction). An action outside that form, such as
// cancelling an order beside the trade panel, never picks up its choices.

import { useCallback, useSyncExternalStore } from 'react';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/send.js';

/** Coin control lists at most this many inputs; Select All still takes every one. */
export const COIN_CONTROL_ROW_LIMIT = 200;

/**
 * Which Advanced options a form can honour. A transaction whose inputs or
 * outputs are fixed (an exact payee, a co-signer session, an imported PSBT)
 * turns the matching option off, and the section then hides it.
 *
 * @typedef {{ rbf: boolean, coins: boolean, change: boolean }} AdvancedCaps
 */
export const ALL_ADVANCED = Object.freeze({ rbf: true, coins: true, change: true });
export const NO_ADVANCED = Object.freeze({ rbf: false, coins: false, change: false });

/**
 * Normalise a form's `advanced` prop: `false` hides the section, `true` or
 * nothing allows every option, and an object turns single options off
 * (`{ coins: false }`). `rbfDefault` is kept for a form that sends its own
 * fee-bumping default (Send seeds it from Settings).
 *
 * @param {boolean | Partial<AdvancedCaps> & { rbfDefault?: boolean | null } | null | undefined} advanced
 * @returns {AdvancedCaps}
 */
export function advancedCaps(advanced) {
    if (advanced === false) return NO_ADVANCED;
    if (!advanced || advanced === true) return ALL_ADVANCED;
    return {
        rbf: advanced.rbf !== false,
        coins: advanced.coins !== false,
        change: advanced.change !== false,
    };
}

/**
 * @typedef {object} AdvancedEntry
 * @property {string} key
 * @property {string} formKey
 * @property {string} chainId
 * @property {string} address
 * @property {boolean} open
 * @property {boolean | null} rbf          null: untouched, the switch sits at rbfDefault
 * @property {boolean | null} rbfDefault   the switch's default (the form's own, else the chain's Fees setting), null on a network without RBF or before the section renders
 * @property {boolean} coinControl
 * @property {string[]} selectedKeys      txid:vout of the chosen coins
 * @property {any[]} available            the spendable coins at the source address
 * @property {'idle' | 'loading' | 'ready' | 'error'} loadState
 * @property {string} change              '' for automatic, else an own address
 * @property {AdvancedCaps} shown          the options the section shows right now
 */

const entries = new Map();
const blanks = new Map();
const listeners = new Set();
let armedFormKey = null;

function emit() {
    for (const listener of [...listeners]) listener();
}

function subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/**
 * @param {{ formKey?: string, chainId?: string | null, address?: string | null }} parts
 * @returns {string}
 */
export function advancedKey({ formKey = 'form', chainId, address }) {
    return `${formKey}|${chainId || ''}|${address || ''}`;
}

function blankEntry(key) {
    const [formKey, chainId, address] = key.split('|');
    return {
        key,
        formKey,
        chainId,
        address,
        open: false,
        rbf: null,
        rbfDefault: null,
        coinControl: false,
        selectedKeys: [],
        available: [],
        loadState: 'idle',
        change: '',
        shown: NO_ADVANCED,
    };
}

/**
 * @param {string} key
 * @returns {AdvancedEntry}
 */
export function getAdvancedEntry(key) {
    const stored = entries.get(key);
    if (stored) return stored;
    // useSyncExternalStore needs the same object back for an unchanged key,
    // so a key with no choices yet keeps one cached blank entry.
    let blank = blanks.get(key);
    if (!blank) {
        blank = blankEntry(key);
        blanks.set(key, blank);
    }
    return blank;
}

/**
 * Merge a patch (or the result of a function of the entry) into one entry.
 *
 * @param {string} key
 * @param {Partial<AdvancedEntry> | ((entry: AdvancedEntry) => Partial<AdvancedEntry>)} patch
 */
export function updateAdvanced(key, patch) {
    const current = getAdvancedEntry(key);
    const next = typeof patch === 'function' ? patch(current) : patch;
    const changed = Object.keys(next || {}).some((field) => current[field] !== next[field]);
    if (!changed) return;
    entries.set(key, { ...current, ...next });
    emit();
}

/**
 * The live entry for a key; re-renders when it changes.
 *
 * @param {string} key
 * @returns {AdvancedEntry}
 */
export function useAdvancedEntry(key) {
    const read = useCallback(() => getAdvancedEntry(key), [key]);
    return useSyncExternalStore(subscribe, read, read);
}

let armedElement = null;
let listening = false;

// A submit that never reached its confirmation (a field refused it) leaves
// the form armed. A press outside that form while it is still on screen is
// another action (an order cancel beside the trade panel), so it ends the arm
// before that action composes. A form already swapped for its review page is
// no longer connected, and keeps its arm.
function pressedOutside(event) {
    if (!armedElement || !armedElement.isConnected) return;
    const target = event.target;
    if (target && typeof target === 'object' && 'nodeType' in target) {
        if (armedElement.contains(target)) return;
        if (target.closest?.('[data-advanced-picker]')) return;
    }
    disarmAdvanced();
}

function keyedOutside(event) {
    if (event.key === 'Enter' || event.key === ' ') pressedOutside(event);
}

/**
 * Marks the form whose submit is under way; its choices reach compose.
 *
 * @param {string} formKey
 * @param {Element | null} [element]  the form, so a press outside it ends the arm
 */
export function armAdvanced(formKey, element = null) {
    armedFormKey = formKey || null;
    armedElement = element;
    if (!listening && element && typeof document !== 'undefined') {
        document.addEventListener('pointerdown', pressedOutside, true);
        document.addEventListener('keydown', keyedOutside, true);
        listening = true;
    }
}

/** Ends the armed submit (the confirmation settled, or another action began). */
export function disarmAdvanced() {
    armedFormKey = null;
    armedElement = null;
    if (listening && typeof document !== 'undefined') {
        document.removeEventListener('pointerdown', pressedOutside, true);
        document.removeEventListener('keydown', keyedOutside, true);
        listening = false;
    }
}

/**
 * The armed form's transaction went out: its chosen coins are spent, so its
 * choices return to Default for the next one (the section keeps its place).
 */
export function clearArmedChoices() {
    if (!armedFormKey) return;
    let changed = false;
    for (const [key, entry] of entries) {
        if (entry.formKey !== armedFormKey) continue;
        entries.set(key, { ...entry, rbf: null, coinControl: false, selectedKeys: [], change: '' });
        changed = true;
    }
    if (changed) emit();
}

/** For tests: forget every entry and any armed form. */
export function resetAdvancedStore() {
    entries.clear();
    blanks.clear();
    disarmAdvanced();
    emit();
}

function utxoKeyOf(utxo) {
    return `${utxo?.txid || ''}:${utxo?.vout ?? ''}`;
}
export { utxoKeyOf as utxoKey };

/**
 * The coins an entry has chosen, read from the coins it loaded.
 *
 * @param {AdvancedEntry} entry
 * @returns {any[]}
 */
export function selectedUtxosOf(entry) {
    if (!entry.coinControl) return [];
    const chosen = new Set(entry.selectedKeys);
    return entry.available.filter((utxo) => chosen.has(utxoKeyOf(utxo)));
}

/**
 * What an entry asks of compose, limited to the options its section shows.
 * An untouched fee-bumping switch sends its default; untouched coin control
 * and change are left out, so they compose as they would without a section.
 *
 * @param {AdvancedEntry} entry
 * @returns {{ rbf?: boolean, utxos?: any[], change?: string }}
 * @throws {Error} coin control on with no coin chosen
 */
export function advancedOptionsOf(entry) {
    const out = {};
    // An untouched switch sends its default, so RBF is on wherever the network
    // supports it and the Fees setting has not turned it off (operator
    // 2026-11-13). A network without RBF stores no default, so its locked
    // switch sends nothing, and the flows' descriptor cap clamps any rbf there.
    if (entry.shown.rbf) {
        const rbf = entry.rbf ?? entry.rbfDefault;
        if (rbf !== null && rbf !== undefined) out.rbf = rbf;
    }
    if (entry.shown.coins && entry.coinControl) {
        const utxos = selectedUtxosOf(entry);
        if (utxos.length === 0) {
            throw Object.assign(new Error(t('send.advanced.coinsRequired')), { name: 'CoinControlEmptyError' });
        }
        out.utxos = utxos;
    }
    if (entry.shown.change && entry.change) out.change = entry.change;
    return out;
}

function optionsOrNull(entry) {
    const options = advancedOptionsOf(entry);
    return Object.keys(options).length > 0 ? options : null;
}

/**
 * The armed form's choices for this network and source address, or null.
 *
 * @param {{ chainId?: string | null, address?: string | null }} target
 * @returns {{ rbf?: boolean, utxos?: any[], change?: string } | null}
 */
export function armedAdvancedOptions({ chainId, address }) {
    if (!armedFormKey || !chainId) return null;
    // The entry for this exact source address wins. An entry with no address
    // (a form whose From names none, or the render before it loaded) is used
    // only when there is no exact one, so it can never shadow the real choices.
    let fallback = null;
    for (const entry of entries.values()) {
        if (entry.formKey !== armedFormKey || entry.chainId !== chainId) continue;
        if (address && entry.address === address) return optionsOrNull(entry);
        if (!entry.address && !fallback) fallback = entry;
        if (!address && entry.address && !fallback) fallback = entry;
    }
    return fallback ? optionsOrNull(fallback) : null;
}

/**
 * Fold the armed form's Advanced choices into a compose request. The one
 * place every compose route takes them from: useActionConfirmFlow calls it
 * for every form on the shared route, and the forms that compose on their
 * own route wrap their request in it.
 *
 * `change` always rides at the top of the request, where the host checks
 * that it belongs to this wallet. `rbf` and `utxos` go into `encoderOpts`
 * when the request carries `actionData` (the generic route spreads those
 * into the encoder), and at the top otherwise (the SEND shape and the vote,
 * bet, message and gated publish routes read them there).
 *
 * @template {Record<string, any>} R
 * @param {R} request
 * @returns {R}
 */
export function withAdvancedOptions(request) {
    // A message names the recipient's chain in `chainId` and the network that
    // funds it in `broadcastChainId`; the coins come from the second.
    const options = armedAdvancedOptions({
        chainId: request?.broadcastChainId ?? request?.chainId,
        address: request?.from?.address ?? request?.source ?? null,
    });
    if (!options) return request;
    const { change, ...spend } = options;
    const next = { ...request, ...(change ? { change } : {}) };
    if (Object.keys(spend).length === 0) return next;
    if (request.actionData) {
        return { ...next, encoderOpts: { ...(request.encoderOpts || {}), ...spend } };
    }
    return { ...next, ...spend };
}

/**
 * One-line summary for the closed section: "Default", or the choices that
 * differ from it ("RBF on · 2 coins · custom change").
 *
 * @param {AdvancedEntry} entry
 * @param {{ rbfSupported: boolean }} opts
 * @returns {string}
 */
export function advancedSummary(entry, { rbfSupported }) {
    const parts = [];
    if (entry.shown.rbf && rbfSupported && entry.rbf !== null && entry.rbf !== (entry.rbfDefault ?? false)) {
        parts.push(t(entry.rbf ? 'send.advanced.summaryRbfOn' : 'send.advanced.summaryRbfOff'));
    }
    if (entry.shown.coins && entry.coinControl) {
        const count = selectedUtxosOf(entry).length;
        parts.push(t(count === 1 ? 'send.advanced.summaryCoin' : 'send.advanced.summaryCoins', { count }));
    }
    if (entry.shown.change && entry.change) parts.push(t('send.advanced.summaryChange'));
    return parts.length > 0 ? parts.join(' · ') : t('send.advanced.summaryDefault');
}
