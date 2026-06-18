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
import { Screen, Input, Icon } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import styles from './CreateWallet.module.css';
import pickerStyles from './WalletPicker.module.css';

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
 * @param {string} [props.initialName]   pre-fill the input with the current name
 * @param {() => void} props.onBack
 * @param {() => void} props.onRenamed   refresh callers and return to the previous screen
 */
export function RenameAccountForm({ accountId, initialName = '', onBack, onRenamed }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [name, setName] = useState(initialName);
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

    async function handleSubmit(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        if (busy) return;
        const trimmed = name.trim();
        if (trimmed.length === 0) {
            setError('Account name is required.');
            return;
        }
        if (typeof messaging.renameAccount !== 'function') {
            setError('messaging.renameAccount is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            await messaging.renameAccount({ accountId, name: trimmed });
            onRenamed();
        } catch (err) {
            setError(err?.message || 'Failed to rename account.');
            setBusy(false);
        }
    }

    const saveDisabled = busy || name.trim().length === 0;

    const header = (
        <div className={pickerStyles.header}>
            <button
                type="button"
                onClick={onBack}
                className={pickerStyles.iconBtn}
                aria-label="Back"
                title="Back"
                disabled={busy}
            >
                <Icon.BackIcon />
            </button>
            <span className={pickerStyles.title}>Rename account</span>
            <button
                type="button"
                onClick={() => handleSubmit()}
                className={pickerStyles.iconBtn}
                aria-label="Save"
                title="Save"
                disabled={saveDisabled}
            >
                <Icon.CheckIcon />
            </button>
        </div>
    );

    const formBody = (
        <form ref={formRef} onSubmit={handleSubmit} noValidate>
            <Input
                ref={nameRef}
                label="Account name"
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
                autoComplete="off"
                error={error || undefined}
            />
        </form>
    );

    return (
        <Screen variant={variant} header={header}>
            {isFull ? <div className={styles.card}>{formBody}</div> : formBody}
        </Screen>
    );
}
