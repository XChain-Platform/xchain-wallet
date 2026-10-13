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
import { t } from '../../i18n/index.js';
import { useMessaging } from '../useMessaging.js';
import { useWalletMode } from '../hooks/useWalletMode.js';

const NOOP = () => {};

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string | null} props.value                         currently selected signerId; null = software
 * @param {(signerId: string | null) => void} props.onChange
 * @param {boolean} [props.disabled]
 */
export function SignerSelectForm({ walletId, value, onChange, disabled = false }) {
    const { messaging } = useMessaging();
    const { isWatcherMode } = useWalletMode();
    const emitChange = typeof onChange === 'function' ? onChange : NOOP;
    const [registry, setRegistry] = useState(/** @type {{ walletId: string, messaging: any, signers: any[] | null, error: string | null } | null} */ (null));
    const currentRegistry = registry?.walletId === walletId && registry.messaging === messaging
        ? registry
        : null;
    const signers = currentRegistry?.signers ?? null;
    const error = currentRegistry?.error ?? null;

    useEffect(() => {
        let cancelled = false;
        setRegistry({ walletId, messaging, signers: null, error: null });
        if (typeof messaging.listSigners !== 'function') {
            // Shell hasn't wired listSigners; treat as zero HW signers.
            setRegistry({ walletId, messaging, signers: [], error: null });
            return () => { cancelled = true; };
        }
        Promise.resolve().then(() => messaging.listSigners(walletId))
            .then((list) => {
                if (cancelled) return;
                setRegistry({
                    walletId,
                    messaging,
                    signers: Array.isArray(list) ? list : [],
                    error: null,
                });
            })
            .catch((err) => {
                if (cancelled) return;
                // Loading the registry failed; fall back to software so
                // the parent flow stays usable. Surface the error inline
                // for diagnostic visibility.
                setRegistry({
                    walletId,
                    messaging,
                    signers: [],
                    error: err?.message || 'Failed to load signers.',
                });
            });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    // Resolve a missing selection to software after the signer registry loads.
    useEffect(() => {
        if (signers && value !== null && !signers.some((signer) => signer.id === value)) {
            emitChange(null);
        }
    }, [signers, value, emitChange]);

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
            sub: 'Uses this wallet\'s recovery phrase on this device. Unlock it with the wallet password.',
            kind: 'software',
        },
        ...signers.map((s) => ({
            id: s.id,
            label: s.label || `${s.vendor} ${s.model}`,
            sub: `Hardware device: connect ${s.vendor} ${s.model} and approve there; the wallet password is not sent to it${s.firmwareVersion ? ` (firmware ${s.firmwareVersion})` : ''}.`,
            kind: s.kind,
        })),
    ];

    return (
        <fieldset style={FIELDSET_STYLE} aria-label={t('signerSelect.choose')}>
            <legend style={LEGEND_STYLE}>{t('signerSelect.title')}</legend>
            <p style={INTRO_STYLE}>
                {t('signerSelect.intro')}
            </p>
            {isWatcherMode ? (
                <p role="note" style={WATCH_ONLY_STYLE}>
                    {t('signerSelect.watcherNote')}
                </p>
            ) : null}
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
                                    onChange={() => emitChange(opt.id)}
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

const INTRO_STYLE = {
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-text-xs)',
    margin: '0 0 var(--xc-space-2)',
};

const WATCH_ONLY_STYLE = {
    color: 'var(--xc-warning-fg, var(--xc-text))',
    fontSize: 'var(--xc-text-xs)',
    margin: '0 0 var(--xc-space-2)',
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
    color: 'var(--xc-danger-fg)',
    fontSize: 'var(--xc-text-sm)',
    margin: '0 0 var(--xc-space-3) 0',
};
