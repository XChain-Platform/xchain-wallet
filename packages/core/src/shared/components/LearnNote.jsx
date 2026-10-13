// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// LearnNote shows concise confirmation help when Learn Mode is on. Each
// confirmation kind has its own dismissal so hiding familiar advice does not
// hide help for a different kind of signature.

import { useState } from 'react';
import { useLearnMode } from '../hooks/useLearnMode.js';
import styles from './LearnNote.module.css';

const DOCS_URL = 'https://docs.xchain.io/';
const DISMISSED_KEY_PREFIX = 'xc:learn-note:dismissed:';
const DISMISS_LABEL = 'Dismiss learn note';
const DISMISS_TEXT = 'Dismiss';
const LEARN_MORE_TEXT = 'Learn more';

function dismissalKey(variant) {
    return `${DISMISSED_KEY_PREFIX}${variant}`;
}

function readDismissed(key) {
    try {
        return globalThis.localStorage?.getItem(key) === '1';
    } catch {
        return false;
    }
}

/**
 * @param {object} props
 * @param {'action'|'psbt'|'message'} [props.variant]   which confirmation surface this is
 * @param {string} [props.chainLabel]                   e.g. "Bitcoin"; named in the action copy
 * @param {string} [props.title]
 * @param {import('react').ReactNode} [props.children]  overrides the built-in copy
 */
export function LearnNote({ variant = 'action', chainLabel, title = 'Good to know', children }) {
    const enabled = useLearnMode();
    const key = dismissalKey(variant);
    const [dismissedKey, setDismissedKey] = useState(
        () => (readDismissed(key) ? key : null),
    );

    if (!enabled || dismissedKey === key || readDismissed(key)) return null;

    const network = chainLabel ? `the ${chainLabel} network` : 'the network';
    let body = children;
    if (!body) {
        if (variant === 'message') {
            body = 'Only sign text you understand because its signature proves your approval without moving coins or paying a fee.';
        } else if (variant === 'psbt') {
            body = 'Check every input and output before approving because another app, not your wallet, built this transaction.';
        } else {
            body = `Check the amounts and addresses before approving on ${network} because a broadcast transaction cannot be recalled.`;
        }
    }

    const dismiss = () => {
        try {
            globalThis.localStorage?.setItem(key, '1');
        } catch { /* The current view can still hide help when storage is unavailable. */ }
        setDismissedKey(key);
    };

    return (
        <div className={styles.note} data-testid="learn-note">
            <div className={styles.header}>
                <span className={styles.title}>{title}</span>
                <button
                    type="button"
                    className={styles.dismiss}
                    onClick={dismiss}
                    aria-label={DISMISS_LABEL}
                >
                    {DISMISS_TEXT}
                </button>
            </div>
            <p className={styles.body}>
                {body}{' '}
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                    {LEARN_MORE_TEXT}
                </a>
            </p>
        </div>
    );
}
