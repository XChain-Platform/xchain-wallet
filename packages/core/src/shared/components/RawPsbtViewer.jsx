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
import { copyText } from '../clipboard.js';
import styles from './RawPsbtViewer.module.css';
import { useHapticFeedback } from '../hooks/useHaptic.js';
import { useToast } from './ToastHost.jsx';

/**
 * Developer-Mode-gated raw view (§21.3 / §48.4) for sign screens.
 *
 * Renders nothing when `developerMode` is false. When on, renders a
 * collapsed `<details>` disclosure exposing whichever pieces the
 * caller has at sign time:
 *   - **Action fields**: always available for the user-initiated Send
 *     flow and for dApp-initiated `signAction` requests. Pretty-printed
 *     JSON of the payload the encoder will ingest.
 *   - **PSBT hex**: available for dApp-initiated `signPsbt` requests
 *     (the dApp passes the hex it built). For `signAction` and Send.jsx
 *     review, the PSBT is constructed *after* the user approves, so
 *     this section is omitted.
 *   - **Inputs / outputs**: placeholder. A future commit wires a real
 *     PSBT parser (BIP-174); until then the section reads "(parser not
 *     wired yet)" so the disclosure remains honest about its limits.
 *
 * Read-only. Each displayed payload has its own clipboard control.
 *
 * @param {object} props
 * @param {boolean} props.developerMode
 * @param {string} [props.psbtHex]
 * @param {Record<string, unknown>} [props.actionFields]
 */
export function RawPsbtViewer({ developerMode, psbtHex, actionFields }) {
    const [copyState, setCopyState] = useState(/** @type {{ target: string|null, status: 'idle'|'copied'|'failed' }} */ ({
        target: null,
        status: 'idle',
    }));
    const haptic = useHapticFeedback();
    const { announce } = useToast();
    const hasPsbt = typeof psbtHex === 'string' && psbtHex.length > 0;
    const hasFields = actionFields && typeof actionFields === 'object' && Object.keys(actionFields).length > 0;
    const fieldsJson = hasFields ? safeJson(actionFields) : '';
    const mountedRef = useRef(false);
    const copyAttemptRef = useRef(0);
    const resetTimerRef = useRef(null);

    useEffect(() => {
        mountedRef.current = true;
        copyAttemptRef.current += 1;
        if (resetTimerRef.current !== null) {
            clearTimeout(resetTimerRef.current);
            resetTimerRef.current = null;
        }
        setCopyState((current) => current.status === 'idle'
            ? current
            : { target: null, status: 'idle' });

        return () => {
            mountedRef.current = false;
            copyAttemptRef.current += 1;
            if (resetTimerRef.current !== null) {
                clearTimeout(resetTimerRef.current);
                resetTimerRef.current = null;
            }
        };
    }, [developerMode, fieldsJson, psbtHex]);

    if (!developerMode) return null;
    if (!hasPsbt && !hasFields) return null;

    async function handleCopy(target, value) {
        const attempt = ++copyAttemptRef.current;
        if (resetTimerRef.current !== null) {
            clearTimeout(resetTimerRef.current);
            resetTimerRef.current = null;
        }
        let ok = false;
        try {
            ({ ok } = await copyText(value));
        } catch {
            // Clipboard adapters are expected to return failures, but a rejected
            // platform promise still produces the same safe, visible result.
        }
        if (!mountedRef.current || copyAttemptRef.current !== attempt) return;

        setCopyState({ target, status: ok ? 'copied' : 'failed' });
        announce(ok ? 'Copied' : 'Copy failed: clipboard unavailable');
        if (ok) haptic.tap();
        else haptic.error();
        resetTimerRef.current = setTimeout(() => {
            resetTimerRef.current = null;
            if (!mountedRef.current || copyAttemptRef.current !== attempt) return;
            setCopyState((current) => current.target === target
                ? { target: null, status: 'idle' }
                : current);
        }, 1500);
    }

    function copyLabel(target, label) {
        if (copyState.target !== target || copyState.status === 'idle') return `Copy ${label}`;
        return copyState.status === 'copied' ? 'Copied' : 'Copy failed: clipboard unavailable';
    }

    return (
        <details className={styles.root}>
            <summary className={styles.toggle}>
                Developer · raw view
            </summary>

            <div className={styles.body}>
                {hasPsbt ? (
                    <section className={styles.section} aria-label="Unsigned transaction hex">
                        <p className={styles.label}>Unsigned transaction hex</p>
                        <textarea
                            className={styles.hex}
                            readOnly
                            value={psbtHex}
                            rows={4}
                            spellCheck={false}
                            aria-label="Unsigned transaction hex"
                        />
                        <button
                            type="button"
                            className={styles.copyBtn}
                            onClick={() => handleCopy('psbt', psbtHex)}
                            aria-live="polite"
                        >
                            {copyLabel('psbt', 'unsigned transaction hex')}
                        </button>
                    </section>
                ) : null}

                {hasFields ? (
                    <section className={styles.section} aria-label="Action fields">
                        <p className={styles.label}>Action fields</p>
                        <pre className={styles.json}>{fieldsJson}</pre>
                        <button
                            type="button"
                            className={styles.copyBtn}
                            onClick={() => handleCopy('fields', fieldsJson)}
                            aria-live="polite"
                        >
                            {copyLabel('fields', 'action fields')}
                        </button>
                    </section>
                ) : null}

                <section className={styles.section} aria-label="Parsed inputs / outputs">
                    <p className={styles.label}>Parsed inputs / outputs</p>
                    <p className={styles.placeholder}>
                        (parser not wired yet; see PSBT hex above for the raw bytes)
                    </p>
                </section>

            </div>
        </details>
    );
}

function safeJson(v) {
    try {
        return JSON.stringify(v, jsonReplacer, 2);
    } catch (_err) {
        return String(v);
    }
}

function jsonReplacer(_key, value) {
    if (typeof value === 'bigint') return value.toString();
    return value;
}
