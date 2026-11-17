// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The recipient list behind the Send form's Multi and Advanced tabs. Pure: the
// form owns the state, this module validates rows, edits the list, reads and
// writes the one-recipient-per-line text, and measures the list against what
// one transaction can carry.
//
// Wire: every recipient is one leg of a single SEND (xchain-documentation/
// protocol/actions/send.md, Version 1 "Multi-Send (Brief)" when every leg is
// the same asset, Version 2 "Multi-Send (Full)" when assets differ). The form
// hands the legs to flows/sendLegs.js, whose params the SDK selector turns
// into the shortest version that carries them; nothing here picks a version.

import { MAX_SEND_LEGS, totalsByTick } from './sendLegs.js';
import { MAX_COMPILED_ACTION_BYTES, pushPrefixSize } from './fileSizeLimits.js';
import { formatWithThousands } from '../shared/utils/amountFormat.js';
import { tickerReferenceError } from '../shared/utils/tickerGrammar.js';

/** The most recipients one transaction carries (the sendLegs guardrail). */
export const MAX_MULTI_RECIPIENTS = MAX_SEND_LEGS;

/** The three columns of one Advanced line, in order. */
export const RECIPIENT_LINE_FORMAT = 'address,asset,amount';

const HEADER_FIRST = new Set(['address', 'to', 'destination', 'recipient']);
const HEADER_SECOND = new Set(['asset', 'token', 'tick', 'ticker']);
const HEADER_THIRD = new Set(['amount', 'quantity', 'qty']);

/**
 * @typedef {object} MultiRecipient
 * @property {string} id
 * @property {string} to
 * @property {string} tick   upper case
 * @property {string} amount plain decimal, no grouping
 */

/**
 * @typedef {object} RecipientRules
 * @property {(address: string) => string | null} [addressError]   the chain's address check
 * @property {string | null} [nativeTicker]   the chain's coin, which has no multi-recipient form
 * @property {((tick: string) => boolean) | null} [isHeld]   false refuses an asset the From address does not hold; null skips the check
 * @property {((tick: string) => number | undefined) | null} [decimalsFor]  the asset's decimal places, when known
 */

let idSeq = 0;
/** A row id that stays unique when two rows are made in the same millisecond. */
export function newRecipientId() {
    idSeq += 1;
    return `rcpt-${Date.now().toString(36)}-${idSeq}`;
}

/** @param {unknown} raw */
function plainAmount(raw) {
    return String(raw ?? '').replace(/[,\s]/g, '');
}

/** @param {string} value */
function isPositiveDecimal(value) {
    return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && /[1-9]/.test(value);
}

/**
 * Check one recipient. Returns a message per failing field; an empty object
 * means the row can be added.
 *
 * @param {{ to?: string, tick?: string, amount?: string }} row
 * @param {RecipientRules} [rules]
 * @returns {{ to?: string, tick?: string, amount?: string }}
 */
export function validateRecipient(row, rules = {}) {
    /** @type {{ to?: string, tick?: string, amount?: string }} */
    const errors = {};
    const to = String(row?.to ?? '').trim();
    const tick = String(row?.tick ?? '').trim().toUpperCase();
    const amount = plainAmount(row?.amount);

    if (!to) errors.to = 'Enter the recipient address.';
    else {
        const addressProblem = rules.addressError ? rules.addressError(to) : null;
        if (addressProblem) errors.to = addressProblem;
    }

    // Only tokens can be recipients here (the coin is refused below), so the
    // copy says token, as the Multi field's label does (G60).
    if (!tick) errors.tick = 'Choose a token.';
    else if (rules.nativeTicker && tick === String(rules.nativeTicker).toUpperCase()) {
        errors.tick = `${tick} is paid in its own output, so it can't share a transaction with other recipients. `
            + `Send ${tick} on the Single tab.`;
    } else if (tickerReferenceError(tick, { noun: 'Token', allowRef: true })) {
        errors.tick = `${tick} is not a valid token name.`;
    } else if (rules.isHeld && rules.isHeld(tick) === false) {
        errors.tick = `${tick} is not a token this address holds.`;
    }

    if (!amount) errors.amount = 'Enter an amount.';
    else if (!isPositiveDecimal(amount)) errors.amount = 'Amount must be a positive number.';
    else if (!errors.tick && rules.decimalsFor) {
        const places = rules.decimalsFor(tick);
        if (Number.isInteger(places) && (amount.split('.')[1] || '').length > places) {
            errors.amount = places === 0
                ? `${tick} has no decimal places, so the amount must be a whole number.`
                : `${tick} amounts can have at most ${places} decimal places.`;
        }
    }
    return errors;
}

/**
 * The trimmed, upper-cased row the list keeps.
 * @param {{ id?: string, to?: string, tick?: string, amount?: string }} row
 * @returns {MultiRecipient}
 */
export function normalizeRecipient(row) {
    return {
        id: row?.id || newRecipientId(),
        to: String(row?.to ?? '').trim(),
        tick: String(row?.tick ?? '').trim().toUpperCase(),
        amount: plainAmount(row?.amount),
    };
}

/**
 * Append a row. The list never grows past the cap: a full list comes back
 * unchanged, and the form says why before the user gets that far.
 *
 * @param {MultiRecipient[]} list
 * @param {{ to?: string, tick?: string, amount?: string }} row
 * @param {number} [max]
 * @returns {MultiRecipient[]}
 */
export function addRecipient(list, row, max = MAX_MULTI_RECIPIENTS) {
    const current = Array.isArray(list) ? list : [];
    if (current.length >= max) return current;
    return [...current, normalizeRecipient(row)];
}

/**
 * Replace one row in place, keeping its id and position.
 * @param {MultiRecipient[]} list
 * @param {string} id
 * @param {{ to?: string, tick?: string, amount?: string }} row
 * @returns {MultiRecipient[]}
 */
export function updateRecipient(list, id, row) {
    return (Array.isArray(list) ? list : [])
        .map((item) => (item.id === id ? normalizeRecipient({ ...row, id }) : item));
}

/**
 * @param {MultiRecipient[]} list
 * @param {string} id
 * @returns {MultiRecipient[]}
 */
export function removeRecipient(list, id) {
    return (Array.isArray(list) ? list : []).filter((item) => item.id !== id);
}

/**
 * The Advanced text for a list: one `address,asset,amount` line per recipient,
 * with plain amounts so the commas only ever separate columns.
 *
 * @param {MultiRecipient[]} list
 * @returns {string}
 */
export function recipientsToText(list) {
    return (Array.isArray(list) ? list : [])
        .map((row) => `${row.to},${row.tick},${row.amount}`)
        .join('\n');
}

/**
 * Split one CSV line into trimmed cells. A double-quoted cell may hold a comma
 * ("1,000"), and a doubled quote inside one is a literal quote.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function splitCsvLine(line) {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quoted) {
            if (ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
            else if (ch === '"') quoted = false;
            else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === ',' || ch === '\t' || ch === ';') { cells.push(cell.trim()); cell = ''; }
        else cell += ch;
    }
    cells.push(cell.trim());
    return cells;
}

const BYTE_ORDER_MARK = 0xfeff;

/**
 * The text without the byte-order mark a spreadsheet's CSV export can start with.
 * @param {string} text
 * @returns {string}
 */
export function withoutByteOrderMark(text) {
    return text.charCodeAt(0) === BYTE_ORDER_MARK ? text.slice(1) : text;
}

/** @param {string[]} cells */
function isHeaderRow(cells) {
    if (cells.length !== 3) return false;
    const [a, b, c] = cells.map((cell) => cell.toLowerCase());
    return HEADER_FIRST.has(a) && HEADER_SECOND.has(b) && HEADER_THIRD.has(c);
}

/**
 * Read the Advanced text (typed or from a CSV file): one recipient per line,
 * `address,asset,amount`. Blank lines are skipped, a header row on the first
 * line that holds anything is tolerated, and every line that cannot be a
 * recipient is reported by its line number, never dropped quietly.
 *
 * @param {string} text
 * @param {RecipientRules} [rules]
 * @returns {{ recipients: MultiRecipient[], errors: Array<{ line: number, message: string }>, header: boolean }}
 */
export function parseRecipientText(text, rules = {}) {
    /** @type {MultiRecipient[]} */
    const recipients = [];
    /** @type {Array<{ line: number, message: string }>} */
    const errors = [];
    let header = false;
    let seenContent = false;
    const lines = withoutByteOrderMark(String(text ?? '')).split(/\r\n|\r|\n/);
    lines.forEach((raw, index) => {
        const line = index + 1;
        if (raw.trim() === '') return;
        const cells = splitCsvLine(raw);
        if (!seenContent) {
            seenContent = true;
            if (isHeaderRow(cells)) { header = true; return; }
        }
        if (cells.length !== 3) {
            errors.push({
                line,
                message: `Line ${line}: expected three values (${RECIPIENT_LINE_FORMAT}), found ${cells.length}.`,
            });
            return;
        }
        const [to, tick, amount] = cells;
        const rowErrors = validateRecipient({ to, tick, amount }, rules);
        const first = rowErrors.to || rowErrors.tick || rowErrors.amount;
        if (first) {
            errors.push({ line, message: `Line ${line}: ${first}` });
            return;
        }
        recipients.push(normalizeRecipient({ id: `line-${line}`, to, tick, amount }));
    });
    return { recipients, errors, header };
}

/**
 * The refusal for a list longer than one transaction carries, naming both
 * numbers, or null when it fits. The list is never cut down to fit.
 *
 * @param {number} count
 * @param {number} [max]
 * @returns {string | null}
 */
export function recipientLimitError(count, max = MAX_MULTI_RECIPIENTS) {
    if (!(count > max)) return null;
    const over = count - max;
    return `One transaction carries at most ${max} recipients, and this list has ${count}. `
        + `Remove ${over} ${over === 1 ? 'recipient' : 'recipients'}, or send the rest in another payment.`;
}

/** @param {string} s */
function utf8Length(s) {
    return new TextEncoder().encode(String(s ?? '')).length;
}

/**
 * The SEND action string these recipients compose to, as the SDK selector
 * writes it: v0 for one leg, v1 when every leg is the same asset, v2 when
 * they differ, with one shared memo in the trailing slot.
 *
 * @param {Array<{ to: string, tick: string, amount: string }>} legs
 * @param {string} [memo]
 * @returns {string}
 */
export function sendActionString(legs, memo = '') {
    const list = Array.isArray(legs) ? legs : [];
    const memoTail = memo ? `|${memo}` : '';
    if (list.length === 0) return '';
    if (list.length === 1) {
        const [leg] = list;
        return `SEND|0|${leg.tick}|${leg.amount}|${leg.to}${memoTail}`;
    }
    const ticks = new Set(list.map((leg) => leg.tick));
    if (ticks.size === 1) {
        return `SEND|1|${list[0].tick}|${list.map((leg) => `${leg.amount}|${leg.to}`).join('|')}${memoTail}`;
    }
    return `SEND|2|${list.map((leg) => `${leg.tick}|${leg.amount}|${leg.to}`).join('|')}${memoTail}`;
}

/**
 * Compiled size of the action push, measured as composeForConfirm measures it.
 * @param {Array<{ to: string, tick: string, amount: string }>} legs
 * @param {string} [memo]
 * @returns {number}
 */
export function sendActionBytes(legs, memo = '') {
    const bytes = utf8Length(sendActionString(legs, memo));
    return bytes + pushPrefixSize(bytes);
}

/**
 * The refusal for a list whose action would not fit one transaction's data
 * push, or null when it fits.
 *
 * @param {Array<{ to: string, tick: string, amount: string }>} legs
 * @param {string} [memo]
 * @returns {string | null}
 */
export function recipientSizeError(legs, memo = '') {
    const bytes = sendActionBytes(legs, memo);
    if (bytes <= MAX_COMPILED_ACTION_BYTES) return null;
    return `These recipients need ${formatWithThousands(String(bytes))} bytes, and one transaction carries at most `
        + `${formatWithThousands(String(MAX_COMPILED_ACTION_BYTES))}. Remove recipients or shorten the memo.`;
}

/**
 * Every reason the list cannot go into one transaction, before review.
 * @param {MultiRecipient[]} list
 * @param {string} [memo]
 * @returns {string | null}
 */
export function recipientListFitError(list, memo = '') {
    const rows = Array.isArray(list) ? list : [];
    return recipientLimitError(rows.length) || recipientSizeError(rows, memo);
}

/**
 * The row's summary: "100,000 XCHAIN", grouped for reading (G123).
 * @param {{ tick: string, amount: string }} row
 * @returns {string}
 */
export function recipientAmountText(row) {
    return `${formatWithThousands(row.amount) || row.amount} ${row.tick}`;
}

/**
 * Per-asset totals for the review, grouped: ["1,600 XCHAIN", "5 PEPE"].
 * @param {Array<{ tick: string, amount: string }>} list
 * @returns {string[]}
 */
export function recipientTotalsText(list) {
    return totalsByTick(Array.isArray(list) ? list : [])
        .map((total) => `${formatWithThousands(total.amount) || total.amount} ${total.tick}`);
}
