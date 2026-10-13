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
 */
export function RenameAccountForm({ accountId, walletId, initialName = '', onBack, onRenamed }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [name, setName] = useState(initialName);
    const [accounts, setAccounts] = useState(/** @type {any[]} */ ([]));
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
        if (!walletId || typeof messaging.listAccounts !== 'function') return undefined;
        messaging.listAccounts(walletId)
            .then((list) => {
                if (!cancelled) setAccounts(Array.isArray(list) ? list : []);
            })
            .catch(() => { /* the rename flow performs the authoritative check */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    async function handleSubmit(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (busy) return;
        const trimmed = name.trim();
        if (trimmed.length === 0) {
            setError('Account name is required.');
            return;
        }
        if (name.length > NAME_MAX_LENGTH) {
            setError(`Account name must be ${NAME_MAX_LENGTH} characters or fewer.`);
            return;
        }
        if (accounts.some((account) => account?.id !== accountId
            && account?.name?.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
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

    const saveDisabled = busy || name.trim().length === 0 || name.length > NAME_MAX_LENGTH;

    const header = (
        <PageHeader
            onBack={onBack}
            backDisabled={busy}
            title={t('renameAccount.title')}
            trailing={(
                <button
                    type="button"
                    onClick={() => handleSubmit()}
                    aria-label={t('common.save')}
                    title={t('common.save')}
                    disabled={saveDisabled}
                >
                    <Icon.CheckIcon />
                </button>
            )}
        />
    );

    const formBody = (
        <FormPage ref={formRef} label={t('renameAccount.title')} onSubmit={handleSubmit}>
            <Input
                ref={nameRef}
                label={t('renameAccount.name')}
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
                maxLength={NAME_MAX_LENGTH}
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
