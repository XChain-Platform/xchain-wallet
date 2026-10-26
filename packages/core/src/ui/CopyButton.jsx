// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { Button } from './Button.jsx';
import styles from './CopyButton.module.css';
import { CopyIcon, CheckIcon } from './icons/index.jsx';
import { useHapticFeedback } from '../shared/hooks/useHaptic.js';
// SSC-4: every copy in the wallet goes through one path, so a
// sensitive one can be marked sensitive, kept off a cross-device clipboard
// sync and given a real expiry on the shells that have those mechanisms.
import { copyText, CopyFailure } from '../shared/clipboard.js';
import { t } from '../i18n/index.js';
import '../i18n/locales/en/ui.js';

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
 * @param {'filled' | 'outlined'} [props.appearance]  outlined for a per-row action
 *   repeated down a list (each message in a thread); filled everywhere else
 */
export function CopyButton({ value, label = t('ui.copyButton.copyValue'), ariaLabel, feedbackMs = 1500, sensitive = false, onCopied, appearance = 'filled' }) {
    const [state, setState] = useState(/** @type {'idle'|'copied'|'failed'} */ ('idle'));
    const [failureText, setFailureText] = useState('');
    const [copiedText, setCopiedText] = useState('');
    const [announcement, setAnnouncement] = useState({
        id: 0,
        text: '',
        error: false,
        parentOwns: false,
    });
    const buttonRef = useRef(null);
    // The pending reset to idle. It is cleared on unmount so it never runs
    // against a component (or, in a test, a torn-down document) that is gone,
    // and on a second click so the first click's timer cannot cut the new
    // confirmation short.
    const resetTimerRef = useRef(null);
    const haptic = useHapticFeedback();

    useEffect(() => () => clearTimeout(resetTimerRef.current), []);

    async function handleCopy() {
        const actionLabel = String(ariaLabel || label).trim();
        const subject = actionLabel.replace(/^copy(?:\s+to\s+clipboard)?\s*/i, '').trim() || 'value';
        const successText = `Copied: ${subject}`;
        // A sensitive copy can come back false on a native shell whose
        // clipboard plugin did not register: the shared path refuses rather
        // than leaking through the web API, and the user sees "Copy failed"
        // instead of a copy that silently went to their other devices.
        const { ok, reason } = await copyText(value, { sensitive });
        if (ok) {
            setState('copied');
            setFailureText('');
            setCopiedText(successText);
            haptic.tap();
            onCopied?.();
        } else {
            setState('failed');
            setFailureText(reason === CopyFailure.NO_NATIVE_CLIPBOARD
                ? 'Copy blocked: this app has no secure clipboard.'
                : 'Copy failed: the clipboard is unavailable.');
            haptic.error();
        }
        const resultText = ok
            ? successText
            : reason === CopyFailure.NO_NATIVE_CLIPBOARD
                ? 'Copy blocked: this app has no secure clipboard.'
                : 'Copy failed: the clipboard is unavailable.';
        setAnnouncement((current) => ({
            id: current.id + 1,
            text: resultText,
            error: !ok,
            parentOwns: Boolean(buttonRef.current?.parentElement?.closest(
                '[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]',
            )),
        }));
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = setTimeout(() => {
            resetTimerRef.current = null;
            setState('idle');
            setAnnouncement((current) => (
                current.error ? current : { ...current, text: '' }
            ));
        }, feedbackMs);
    }

    const text = state === 'copied' ? copiedText : state === 'failed' ? failureText : label;
    const icon = state === 'copied' ? <CheckIcon /> : <CopyIcon />;
    return (
        <>
            <Button
                ref={buttonRef}
                size="sm"
                className={appearance === 'outlined' ? `${styles.btn} ${styles.outlined}` : styles.btn}
                onClick={handleCopy}
                icon={icon}
                aria-label={state === 'copied' ? text : ariaLabel || label}
                title={text}
                data-state={state}
                style={{ minHeight: 'var(--xc-control-h-sm)' }}
            >
                {text}
            </Button>
            <span
                key={announcement.id}
                className="sr-only"
                role={announcement.parentOwns || !announcement.text
                    ? undefined
                    : (announcement.error ? 'alert' : 'status')}
                aria-live={announcement.parentOwns
                    ? undefined
                    : (announcement.error ? 'assertive' : 'polite')}
                aria-atomic={announcement.parentOwns ? undefined : 'true'}
            >
                {announcement.text}
            </span>
        </>
    );
}
