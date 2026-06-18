// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import styles from './CopyButton.module.css';
import { CopyIcon, CheckIcon } from './icons/index.jsx';

/**
 * Copies `value` to the system clipboard and briefly shows a confirmation
 * state. Tries the modern Clipboard API first; falls back to a hidden-
 * textarea + `document.execCommand('copy')` so plain-HTTP origins (which
 * don't qualify as a secure context for `navigator.clipboard`) still
 * succeed. If both paths fail the button surfaces a "Failed" state for
 * `feedbackMs` so the user knows the click didn't silently no-op.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {string} [props.label]
 * @param {string} [props.ariaLabel]
 * @param {number} [props.feedbackMs]
 * @param {() => void} [props.onCopied]   fires after a successful copy
 */
export function CopyButton({ value, label = 'Copy', ariaLabel, feedbackMs = 1500, onCopied }) {
    const [state, setState] = useState(/** @type {'idle'|'copied'|'failed'} */ ('idle'));

    async function handleCopy() {
        const ok = await copyToClipboard(value);
        if (ok) {
            setState('copied');
            onCopied?.();
        } else {
            setState('failed');
        }
        setTimeout(() => setState('idle'), feedbackMs);
    }

    const text = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;
    const icon = state === 'copied' ? <CheckIcon /> : <CopyIcon />;
    return (
        <button
            type="button"
            onClick={handleCopy}
            className={styles.btn}
            aria-label={ariaLabel || label}
            aria-live="polite"
            data-state={state}
        >
            <span className={styles.icon} aria-hidden="true">{icon}</span>
            <span>{text}</span>
        </button>
    );
}

/**
 * Multi-tier clipboard write. Returns true on success, false on failure.
 * Tier 1: navigator.clipboard.writeText (modern, async, secure-context only).
 * Tier 2: hidden textarea + document.execCommand('copy'), which works on HTTP
 *         deprecated but supported by every browser we ship to.
 */
async function copyToClipboard(text) {
    if (typeof navigator !== 'undefined'
        && navigator.clipboard
        && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch {
            /* fall through to legacy path */
        }
    }
    if (typeof document === 'undefined') return false;
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        // Off-screen but selectable; `position: fixed` avoids scroll jump.
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}
