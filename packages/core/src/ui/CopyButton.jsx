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
// SSC-4 : every copy in the wallet goes through one path, so a
// sensitive one can be marked sensitive, kept off a cross-device clipboard
// sync and given a real expiry on the shells that have those mechanisms.
import { copyText } from '../shared/clipboard.js';

/**
 * Copies `value` to the system clipboard and briefly shows a confirmation
 * state. The write itself belongs to `shared/clipboard.js`, which owns the
 * tier order (Clipboard API, then a hidden textarea for plain-HTTP origins
 * that are not secure contexts) and the SSC-4 rules for a `sensitive` value.
 * If the copy fails - including a sensitive copy REFUSED on a native shell
 * with no clipboard plugin - the button surfaces a "Failed" state for
 * `feedbackMs` so the user knows the click didn't silently no-op.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {string} [props.label]
 * @param {string} [props.ariaLabel]
 * @param {number} [props.feedbackMs]
 * @param {boolean} [props.sensitive]     seed words, private keys: never to a synced or unmarked clipboard (SSC-4)
 * @param {() => void} [props.onCopied]   fires after a successful copy
 */
export function CopyButton({ value, label = 'Copy', ariaLabel, feedbackMs = 1500, sensitive = false, onCopied }) {
    const [state, setState] = useState(/** @type {'idle'|'copied'|'failed'} */ ('idle'));

    async function handleCopy() {
        // A sensitive copy can come back false on a native shell whose
        // clipboard plugin did not register: the shared path refuses rather
        // than leaking through the web API, and the user sees "Copy failed"
        // instead of a copy that silently went to their other devices.
        const { ok } = await copyText(value, { sensitive });
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
