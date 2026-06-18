// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// SignerSelectForm (§17.6 / G023): inline picker shown when adding an
// account or generating a new receive address on a wallet that has more
// than one signer (software seed plus one or more paired hardware
// devices).
//
// Behavior:
//
//   - On mount, fetches `messaging.listSigners(walletId)` to enumerate
//     paired SignerRecord entries (HW only; the software signer is
//     implicit per wallet).
//   - When zero HW signers exist, the component auto-resolves to the
//     implicit software signer (calls `onChange(null)` once) and renders
//     nothing. Single-signer wallets see no extra friction.
//   - When at least one HW signer exists, the component renders one
//     selectable card per option: an explicit "Software wallet
//     (this seed)" card representing the implicit SoftwareSigner, plus
//     one card per `SignerRecord`.
//
// `value === null` means "software". `value === signerRecord.id` means
// the matching HW signer.
//
// The picker is purely presentational beyond its initial fetch: parents
// own the active `value` state, listen on `onChange`, and pass the
// selected `signerId` (or undefined for software) into
// `messaging.createAccount` / `messaging.generateReceiveAddress`.

import { useEffect, useState } from 'react';
import { useMessaging } from '../useMessaging.js';

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null} props.value                         currently selected signerId; null = software
 * @param {(signerId: string | null) => void} props.onChange
 * @param {boolean} [props.disabled]
 */
export function SignerSelectForm({ walletId, value, onChange, disabled = false }) {
    const { messaging } = useMessaging();
    const [signers, setSigners] = useState(/** @type {any[] | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listSigners !== 'function') {
            // Shell hasn't wired listSigners; treat as zero HW signers.
            setSigners([]);
            return () => { cancelled = true; };
        }
        messaging.listSigners(walletId)
            .then((list) => {
                if (cancelled) return;
                setSigners(Array.isArray(list) ? list : []);
            })
            .catch((err) => {
                if (cancelled) return;
                // Loading the registry failed; fall back to software so
                // the parent flow stays usable. Surface the error inline
                // for diagnostic visibility.
                setSigners([]);
                setError(err?.message || 'Failed to load signers.');
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Once the list is in, auto-resolve to software when there are no
    // HW signers. Avoids a render with stale selection when the list
    // changes (e.g., a device was just unpaired).
    useEffect(() => {
        if (signers && signers.length === 0 && value !== null) {
            onChange(null);
        }
    }, [signers, value, onChange]);

    if (!signers || signers.length === 0) {
        // Either still loading (we don't render a placeholder; the
        // overall form does its own loading), or no HW signers exist
        // (auto-resolved above).
        return error ? <p style={ERROR_STYLE} role="alert">{error}</p> : null;
    }

    /** @type {Array<{ id: string | null, label: string, sub: string, kind: string }>} */
    const options = [
        {
            id: null,
            label: 'Software wallet (this seed)',
            sub: 'Derived from the wallet password. Fast, no device needed.',
            kind: 'software',
        },
        ...signers.map((s) => ({
            id: s.id,
            label: s.label || `${s.vendor} ${s.model}`,
            sub: `${s.vendor} · ${s.model}${s.firmwareVersion ? ` · firmware ${s.firmwareVersion}` : ''}`,
            kind: s.kind,
        })),
    ];

    return (
        <fieldset style={FIELDSET_STYLE} aria-label="Choose signer">
            <legend style={LEGEND_STYLE}>Signer</legend>
            <ul style={LIST_STYLE}>
                {options.map((opt) => {
                    const checked = (value ?? null) === (opt.id ?? null);
                    return (
                        <li key={opt.id ?? 'software'}>
                            <label
                                style={{
                                    ...CARD_STYLE,
                                    ...(checked ? CARD_CHECKED_STYLE : null),
                                    ...(disabled ? CARD_DISABLED_STYLE : null),
                                }}
                            >
                                <input
                                    type="radio"
                                    name={`signer-${walletId}`}
                                    value={opt.id ?? 'software'}
                                    checked={checked}
                                    disabled={disabled}
                                    onChange={() => onChange(opt.id)}
                                    style={RADIO_STYLE}
                                />
                                <span style={CARD_TEXT_STYLE}>
                                    <strong style={CARD_LABEL_STYLE}>{opt.label}</strong>
                                    <span style={CARD_SUB_STYLE}>{opt.sub}</span>
                                </span>
                            </label>
                        </li>
                    );
                })}
            </ul>
        </fieldset>
    );
}

const FIELDSET_STYLE = {
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    padding: 'var(--xc-space-2) var(--xc-space-3) var(--xc-space-3)',
    margin: '0 0 var(--xc-space-3) 0',
};

const LEGEND_STYLE = {
    padding: '0 var(--xc-space-2)',
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-sm)',
    fontWeight: 500,
};

const LIST_STYLE = {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-2)',
};

const CARD_STYLE = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--xc-space-3)',
    padding: 'var(--xc-space-2) var(--xc-space-3)',
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-sm)',
    background: 'var(--xc-bg)',
    cursor: 'pointer',
};

const CARD_CHECKED_STYLE = {
    borderColor: 'var(--xc-accent-primary)',
    background: 'var(--xc-surface-raised)',
};

const CARD_DISABLED_STYLE = {
    opacity: 0.6,
    cursor: 'not-allowed',
};

const RADIO_STYLE = {
    marginTop: 4,
};

const CARD_TEXT_STYLE = {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
};

const CARD_LABEL_STYLE = {
    color: 'var(--xc-text)',
    fontSize: 'var(--xc-text-sm)',
};

const CARD_SUB_STYLE = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
};

const ERROR_STYLE = {
    color: 'var(--xc-danger)',
    fontSize: 'var(--xc-text-sm)',
    margin: '0 0 var(--xc-space-3) 0',
};
