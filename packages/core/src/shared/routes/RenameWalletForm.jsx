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
import { FormPage, Screen, Input, Icon, PageHeader } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';

const NAME_MAX_LENGTH = 64;

/**
 * RenameWalletForm: change a Wallet record's `name` field. No
 * password input, no signer needed; pure metadata update.
 *
 * The header carries Back on the left and Save (✓) on the right,
 * matching the WalletPicker / AccountPicker shape so the user's eye
 * already knows where the action affordances live.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.initialName]   pre-fill the input with the current name
 * @param {() => void} props.onBack
 * @param {(wallet: any) => void} props.onRenamed   refresh callers and return to the previous screen
 */
export function RenameWalletForm({ walletId, initialName = '', onBack, onRenamed }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [name, setName] = useState(initialName);
    const [wallets, setWallets] = useState(/** @type {any[] | null} */ (null));
    const [walletLoadError, setWalletLoadError] = useState(/** @type {string | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    const nameRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const formRef = useRef(/** @type {HTMLFormElement | null} */ (null));

    useEffect(() => {
        setTimeout(() => {
            nameRef.current?.focus();
            nameRef.current?.select();
        }, 0);
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listWallets !== 'function') {
            setWalletLoadError('Wallet names could not be checked.');
            return undefined;
        }
        messaging.listWallets()
            .then((list) => {
                if (!cancelled) setWallets(Array.isArray(list) ? list : []);
            })
            .catch(() => {
                if (!cancelled) setWalletLoadError('Wallet names could not be checked.');
            });
        return () => { cancelled = true; };
    }, [messaging]);

    async function handleSubmit(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        // Ignore a second submit while the first rename is still in flight.
        if (busy) return;
        const trimmed = name.trim();
        // Require a visible wallet name after surrounding whitespace is removed.
        if (trimmed.length === 0) {
            setError('Wallet name is required.');
            return;
        }
        if (name.length > NAME_MAX_LENGTH) {
            setError(`Wallet name must be ${NAME_MAX_LENGTH} characters or fewer.`);
            return;
        }
        if (wallets === null) {
            setError('Wallet names could not be checked.');
            return;
        }
        if (wallets.some((wallet) => wallet?.id !== walletId
            && wallet?.name?.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
            setError(`A wallet named "${trimmed}" already exists.`);
            return;
        }
        // Refuse submission when this shell cannot persist the new name.
        if (typeof messaging.renameWallet !== 'function') {
            setError('messaging.renameWallet is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            const result = await messaging.renameWallet({ walletId, name: trimmed });
            onRenamed(result?.wallet || result);
        } catch (err) {
            setError(err?.message || 'Failed to rename wallet.');
            setBusy(false);
        }
    }

    const saveDisabled = busy || wallets === null || name.trim().length === 0
        || name.length > NAME_MAX_LENGTH;

    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={busy}
            title={t('renameWallet.title')}
            trailing={(
                <button
                    type="button"
                    onClick={() => handleSubmit()}
                    aria-label={t('common.save')}
                    title={t('common.save')}
                    disabled={saveDisabled}
                    aria-busy={busy ? 'true' : undefined}
                >
                    <Icon.CheckIcon />
                </button>
            )}
        />
    );

    const formBody = (
        <FormPage ref={formRef} label={t('renameWallet.title')} onSubmit={handleSubmit}>
            <Input
                ref={nameRef}
                label={t('renameWallet.name')}
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
                maxLength={NAME_MAX_LENGTH}
                autoComplete="off"
                disabled={busy || Boolean(walletLoadError)}
                error={error || walletLoadError || undefined}
            />
        </FormPage>
    );

    return (
        <Screen variant={variant} header={header}>
            {formBody}
        </Screen>
    );
}
