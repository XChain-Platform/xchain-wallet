// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { BIDI_CONTROLS, CONTROLS, ZERO_WIDTH } from './textHardening.js';

export const MAX_MEMO_BYTES = 250;

const ACTION_TEXT_FIELDS = Object.freeze({
    MEMO: 'Memo',
    MESSAGE: 'Message',
    PLAINTEXT_MESSAGE: 'Message',
    NAME: 'Name',
    TITLE: 'Title',
    DESCRIPTION: 'Description',
    QUESTION: 'Question',
    OPTION: 'Option',
    OPTIONS: 'Option',
    LABEL: 'Label',
    OUTCOMES: 'Outcome',
    METHOD: 'Method',
    CALLBACK_METHOD: 'Callback method',
    CALLBACK_PARAMS: 'Callback arguments',
    PARAMS: 'Parameter',
    DETAILS: 'Details',
    RESOLUTION_CRITERIA: 'Settlement rule',
    SOURCE: 'Result source',
    CATEGORY: 'Category',
    OUTCOME_DETAILS: 'Outcome note',
    URI: 'URL',
    URL: 'URL',
    TEXT: 'Text',
    NOTE: 'Note',
});

// Free-text fields typed into a multi-line control keep tabs and line breaks,
// which are ordinary formatting there. Single-line fields (memo, names,
// methods) still refuse every C0 control.
const MULTILINE_LABELS = new Set([
    'Message', 'Description', 'Details', 'Text', 'Note', 'Settlement rule', 'Outcome note',
]);
export const MULTILINE_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function matches(pattern, value) {
    pattern.lastIndex = 0;
    return pattern.test(value);
}

/**
 * Refuse invisible formatting that can change or conceal what a review screen
 * displays. Ordinary printable Unicode remains valid.
 *
 * @param {unknown} value
 * @param {string} [label]
 * @returns {string|null}
 */
export function actionTextSafetyError(value, label = 'Text') {
    const text = value == null ? '' : String(value);
    if (matches(MULTILINE_LABELS.has(label) ? MULTILINE_CONTROLS : CONTROLS, text)) return `${label} cannot contain control characters.`;
    if (matches(BIDI_CONTROLS, text)) return `${label} cannot contain text-direction control characters.`;
    if (matches(ZERO_WIDTH, text)) return `${label} cannot contain zero-width characters.`;
    return null;
}

/**
 * Validate user-facing text inside an action param tree. Structured fields,
 * ciphertext, binary file data, addresses, amounts, and tickers are excluded.
 *
 * @param {{ action?: unknown, params?: unknown } | null | undefined} actionData
 * @returns {string|null}
 */
export function actionParamsTextError(actionData) {
    let firstError = null;
    const visit = (value) => {
        if (firstError || value == null || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            const field = String(key).toUpperCase();
            const label = ACTION_TEXT_FIELDS[field];
            if (label) {
                const values = Array.isArray(child) ? child : [child];
                for (const item of values) {
                    const error = actionTextSafetyError(item, label);
                    if (error) { firstError = error; return; }
                    if (field === 'MEMO') {
                        const bytes = new TextEncoder().encode(String(item ?? '')).byteLength;
                        if (bytes > MAX_MEMO_BYTES) {
                            firstError = `Memo is ${bytes} bytes; the network accepts at most ${MAX_MEMO_BYTES} bytes.`;
                            return;
                        }
                    }
                }
            }
            visit(child);
        }
    };
    visit(actionData?.params);
    return firstError;
}

/** @param {{ action?: unknown, params?: unknown } | null | undefined} actionData */
export function assertSafeActionText(actionData) {
    const error = actionParamsTextError(actionData);
    if (error) throw new Error(error);
}
