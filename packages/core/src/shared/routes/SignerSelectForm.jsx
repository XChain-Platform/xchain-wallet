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
import { FormPage, FormSection, RadioGroup } from '@xchain-wallet/core/ui';
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
        <FormPage as="div" sectioned label={t('signerSelect.choose')}>
            <FormSection title={t('signerSelect.choose')}>
                <p style={INTRO_STYLE}>
                    {t('signerSelect.intro')}
                </p>
                {isWatcherMode ? (
                    <p role="note" style={WATCH_ONLY_STYLE}>
                        {t('signerSelect.watcherNote')}
                    </p>
                ) : null}
                <RadioGroup
                    legend={t('signerSelect.title')}
                    aria-label={t('signerSelect.choose')}
                    name={`signer-${walletId}`}
                    value={value ?? 'software'}
                    onChange={(nextValue) => emitChange(nextValue === 'software' ? null : nextValue)}
                    options={options.map((opt) => ({
                        value: opt.id ?? 'software',
                        label: opt.label,
                        description: opt.sub,
                    }))}
                    disabled={disabled}
                />
            </FormSection>
        </FormPage>
    );
}

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


const ERROR_STYLE = {
    color: 'var(--xc-danger-fg)',
    fontSize: 'var(--xc-text-sm)',
    margin: '0 0 var(--xc-space-3) 0',
};
