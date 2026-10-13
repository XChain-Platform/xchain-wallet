// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Screen, Button, FormPage, Input, Icon, PageHeader } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignerSelectForm } from './SignerSelectForm.jsx';

/**
 * Add a new BIP44 account under the active wallet (§11.3.2). Derives
 * the next free `index` for the wallet and persists an Account record
 * + a first address per active chain.
 *
 * No password prompt: account creation reuses the SignerPool entry
 * the host populated at wallet-unlock time. If the host can't find a
 * pre-unlocked signer for the wallet (an extension/desktop shell that
 * hasn't wired SignerPool yet), the call surfaces an error and the
 * user has to lock + unlock to refresh the pool.
 *
 * Cluster P FOLLOWUP 4: error-recovery audit. This form's errors
 * are all "edit a single input then re-submit" (the canonical
 * recovery is the form itself). The `error` state binds to the Input's
 * `error` prop so it renders inline at the offending field; the
 * Input's onChange clears `error` on the next keystroke. No additional
 * StatusMessage `recovery: { label, onAction }` affordance fits: the
 * fix is "type the right name + click Add account again", which is
 * already the form's primary control. Auditable per-form decision:
 * terminal-as-rendered with user-iteration as the recovery path.
 *
 * @param {object} props
 * @param {string} props.walletId
 * @param {() => void} props.onBack
 * @param {() => void} props.onCreated   refresh callers' account list and return to home
 */
export function AddAccountForm({ walletId, onBack, onCreated }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [name, setName] = useState('Account');
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    // null = software (implicit); string = HW SignerRecord id. The
    // SignerSelectForm hides itself when only software is available
    // and emits onChange(null) once.
    const [signerId, setSignerId] = useState(/** @type {string | null} */ (null));
    const nameRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const userEditedRef = useRef(false);

    const onPickSigner = useCallback((id) => setSignerId(id), []);

    useEffect(() => {
        setTimeout(() => nameRef.current?.focus(), 0);
    }, []);
    // Default the name to "Account N+1" once we know the current count.
    // If the user types something before the fetch returns, leave their
    // edit alone.

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listAccounts !== 'function') return undefined;
        messaging.listAccounts(walletId)
            .then((list) => {
                if (cancelled || userEditedRef.current) return;
                const next = (Array.isArray(list) ? list.length : 0) + 1;
                setName(`Account ${next}`);
            })
            .catch(() => { /* keep default name */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    async function handleSubmit(event) {
        event.preventDefault();
        if (busy) return;
        if (name.trim().length === 0) {
            setError('Account name is required.');
            return;
        }
        if (typeof messaging.createAccount !== 'function') {
            setError('messaging.createAccount is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            await messaging.createAccount({
                walletId,
                name: name.trim(),
                signerId: signerId || undefined,
            });
            onCreated();
        } catch (err) {
            setError(err?.message || 'Failed to add account.');
            setBusy(false);
        }
    }

    const actions = (
        <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={busy}
            icon={<Icon.PlusIcon />}
        >
            Add account
        </Button>
    );

    return (
        <Screen
            variant={variant}
            header={<PageHeader onBack={onBack} backDisabled={busy} title="Add account" />}
        >
            <FormPage
                label="Add account"
                onSubmit={handleSubmit}
                intro="A new set of derived addresses under the same recovery phrase."
                actions={actions}
            >
                <SignerSelectForm
                    walletId={walletId}
                    value={signerId}
                    onChange={onPickSigner}
                    disabled={busy}
                />
                <Input
                    ref={nameRef}
                    label="Account name"
                    value={name}
                    onChange={(e) => {
                        userEditedRef.current = true;
                        setName(e.target.value);
                        if (error) setError(null);
                    }}
                    autoComplete="off"
                    error={error || undefined}
                />
            </FormPage>
        </Screen>
    );
}
