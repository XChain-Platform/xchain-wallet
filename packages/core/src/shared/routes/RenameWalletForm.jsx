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
import { Button, FormPage, Screen, Input, PageHeader } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameKey, nameLength } from '../../util/display_name.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/renameWallet.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { readActiveWallet, writeActiveWallet } from '../utils/activeWalletMemory.js';
import { userFacingMessage } from '../utils/userFacingMessage.js';

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
 * @param {unknown} [props.refreshKey]   changes when another window changes wallet records, so the names are read again
 */
export function RenameWalletForm({ walletId, initialName = '', onBack, onRenamed, refreshKey }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [name, setName] = useState(initialName);
    const [wallets, setWallets] = useState(/** @type {any[] | null} */ (null));
    const [walletLoadError, setWalletLoadError] = useState(/** @type {string | null} */ (null));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    // A rename made in another window reaches this screen as a fresh read of
    // the records (refreshKey). Until the user types, the field follows it, so
    // Save does not put back the name this screen opened with.
    const edited = useRef(false);
    const firstRead = useRef(true);
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
                if (cancelled) return;
                const rows = Array.isArray(list) ? list : [];
                setWallets(rows);
                const stored = rows.find((wallet) => wallet?.id === walletId)?.name;
                if (!firstRead.current && !edited.current && typeof stored === 'string' && stored) setName(stored);
                firstRead.current = false;
            })
            .catch(() => {
                if (!cancelled) setWalletLoadError('Wallet names could not be checked.');
            });
        return () => { cancelled = true; };
    }, [messaging, walletId, refreshKey]);

    async function handleSubmit(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        // Ignore a second submit while the first rename is still in flight.
        if (busy) return;
        const trimmed = name.trim();
        // Require a visible wallet name after surrounding whitespace is removed.
        if (!hasVisibleText(trimmed)) {
            setError('Wallet name is required.');
            return;
        }
        if (nameLength(trimmed) > NAME_MAX_LENGTH) {
            setError(`Wallet name must be ${NAME_MAX_LENGTH} characters or fewer.`);
            return;
        }
        if (wallets === null) {
            setError('Wallet names could not be checked.');
            return;
        }
        if (wallets.some((wallet) => wallet?.id !== walletId
            && nameKey(wallet?.name) === nameKey(trimmed))) {
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
            const renamed = result?.wallet || result;
            // The lock screen names the wallet from this stored selection, so a
            // renamed active wallet updates it or the lock screen shows the old name.
            if (readActiveWallet() === walletId) writeActiveWallet(walletId, trimmed);
            onRenamed(renamed);
        } catch (err) {
            setError(userFacingMessage(err, 'Failed to rename wallet.'));
            setBusy(false);
        }
    }

    const saveDisabled = busy || wallets === null || !hasVisibleText(name)
        || nameLength(name.trim()) > NAME_MAX_LENGTH;

    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={busy}
            title={t('renameWallet.title')}
        />
    );

    const formBody = (
        <FormPage
            ref={formRef}
            label={t('renameWallet.title')}
            onSubmit={handleSubmit}
            actions={(
                <Button
                    type="submit"
                    variant="primary"
                    disabled={saveDisabled}
                    aria-busy={busy ? 'true' : undefined}
                >
                    {t('history.contact.save')}
                </Button>
            )}
        >
            <Input
                ref={nameRef}
                label={t('renameWallet.name')}
                value={name}
                onChange={(e) => {
                    const nextName = e.target.value;
                    edited.current = true;
                    setName(nextName);
                    setError(nameLength(nextName.trim()) > NAME_MAX_LENGTH
                        ? `Wallet name must be ${NAME_MAX_LENGTH} characters or fewer.`
                        : null);
                }}
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
