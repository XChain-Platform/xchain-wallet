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
import styles from './RawPsbtViewer.module.css';

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
 * Read-only. The Copy button copies the displayed payload (PSBT hex
 * when present, otherwise the action-fields JSON) to the clipboard.
 *
 * @param {object} props
 * @param {boolean} props.developerMode
 * @param {string} [props.psbtHex]
 * @param {Record<string, unknown>} [props.actionFields]
 */
export function RawPsbtViewer({ developerMode, psbtHex, actionFields }) {
    const [copied, setCopied] = useState(false);

    if (!developerMode) return null;

    const hasPsbt = typeof psbtHex === 'string' && psbtHex.length > 0;
    const hasFields = actionFields && typeof actionFields === 'object' && Object.keys(actionFields).length > 0;
    if (!hasPsbt && !hasFields) return null;

    const fieldsJson = hasFields ? safeJson(actionFields) : '';
    const copyTarget = hasPsbt ? psbtHex : fieldsJson;

    async function handleCopy() {
        try {
            await navigator.clipboard?.writeText(copyTarget);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (_err) {
            // Clipboard write can fail in approval popup contexts
            // without permissions; the textarea above stays
            // selectable as a fallback.
        }
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
                    </section>
                ) : null}

                {hasFields ? (
                    <section className={styles.section} aria-label="Action fields">
                        <p className={styles.label}>Action fields</p>
                        <pre className={styles.json}>{fieldsJson}</pre>
                    </section>
                ) : null}

                <section className={styles.section} aria-label="Parsed inputs / outputs">
                    <p className={styles.label}>Parsed inputs / outputs</p>
                    <p className={styles.placeholder}>
                        (parser not wired yet; see PSBT hex above for the raw bytes)
                    </p>
                </section>

                <button
                    type="button"
                    className={styles.copyBtn}
                    onClick={handleCopy}
                >
                    {copied ? 'Copied' : `Copy ${hasPsbt ? 'unsigned transaction hex' : 'action fields'}`}
                </button>
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
