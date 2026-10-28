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
import '../../i18n/locales/en/accountPicker.js';
import '../../i18n/locales/en/history.js';
import '../../i18n/locales/en/renameAccount.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameKey, nameLength } from '../../util/display_name.js';

/**
 * RenameAccountForm: change an Account record's `name` field. No
 * password input, no signer needed; pure metadata update. Twin of
 * RenameWalletForm.
 *
 * The header carries Back on the left and Save (check) on the right,
 * matching the AccountPicker / WalletPicker shape so the user's eye
 * already knows where the action affordances live.
 *
 * @param {object} props
 * @param {string} props.accountId
 * @param {string} props.walletId
 * @param {string} [props.initialName]   pre-fill the input with the current name
 * @param {() => void} props.onBack
 * @param {(account: any) => void} props.onRenamed   refresh callers and return to the previous screen
 * @param {unknown} [props.refreshKey]   changes when another window changes account records, so the names are read again
 */
export function RenameAccountForm({ accountId, walletId, initialName = '', onBack, onRenamed, refreshKey }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [name, setName] = useState(initialName);
    const [accounts, setAccounts] = useState(/** @type {any[]} */ ([]));
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
        if (!walletId || typeof messaging.listAccounts !== 'function') return undefined;
        messaging.listAccounts(walletId)
            .then((list) => {
                if (cancelled) return;
                const rows = Array.isArray(list) ? list : [];
                setAccounts(rows);
                const stored = rows.find((account) => account?.id === accountId)?.name;
                if (!firstRead.current && !edited.current && typeof stored === 'string' && stored) setName(stored);
                firstRead.current = false;
            })
            .catch(() => { /* the rename flow performs the authoritative check */ });
        return () => { cancelled = true; };
    }, [walletId, accountId, messaging, refreshKey]);

    async function handleSubmit(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (busy) return;
        const trimmed = name.trim();
        if (!hasVisibleText(trimmed)) {
            setError('Account name is required.');
            return;
        }
        if (nameLength(trimmed) > NAME_MAX_LENGTH) {
            setError(`Account name must be ${NAME_MAX_LENGTH} characters or fewer.`);
            return;
        }
        if (accounts.some((account) => account?.id !== accountId
            && nameKey(account?.name) === nameKey(trimmed))) {
            setError(`An account named "${trimmed}" already exists.`);
            return;
        }
        if (typeof messaging.renameAccount !== 'function') {
            setError('messaging.renameAccount is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            const result = await messaging.renameAccount({ accountId, name: trimmed });
            onRenamed(result?.account || result);
        } catch (err) {
            setError(err?.message || 'Failed to rename account.');
            setBusy(false);
        }
    }

    const saveDisabled = busy || !hasVisibleText(name)
        || nameLength(name.trim()) > NAME_MAX_LENGTH;

    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={busy}
            title={t('accountPicker.renameTitle')}
        />
    );

    const formBody = (
        <FormPage
            ref={formRef}
            label={t('accountPicker.renameTitle')}
            onSubmit={handleSubmit}
            actions={(
                <Button type="submit" variant="primary" disabled={saveDisabled}>
                    {t('history.contact.save')}
                </Button>
            )}
        >
            <Input
                ref={nameRef}
                label={t('renameAccount.name')}
                value={name}
                onChange={(e) => {
                    const nextName = e.target.value;
                    edited.current = true;
                    setName(nextName);
                    setError(nameLength(nextName.trim()) > NAME_MAX_LENGTH
                        ? `Account name must be ${NAME_MAX_LENGTH} characters or fewer.`
                        : null);
                }}
                autoComplete="off"
                disabled={busy}
                error={error || undefined}
            />
        </FormPage>
    );

    return (
        <Screen variant={variant} header={header}>
            {formBody}
        </Screen>
    );
}
