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
import { Screen, Input, Icon, PageHeader } from '@xchain-wallet/core/ui';
// The Wallet Form Standard frame (no From and no fee: this form never signs or sends).
import { FormAction, FormFrame, FormSection, useFormSections } from '../components/formStandard/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignerSelectForm } from './SignerSelectForm.jsx';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameKey, nameLength } from '../../util/display_name.js';
// Add Account carries the same tile look controls as Edit Account.
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { TileLookFields, TILE_COLOURS } from '../components/TileLookFields.jsx';
import { writeWalletTile, tileRadius, walletTileText } from '../utils/walletTile.js';

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
 * @param {(account: any) => void} props.onCreated   activate the new account and leave the form
 */
export function AddAccountForm({ walletId, onBack, onCreated }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);

    const [name, setName] = useState('Account');
    const [tileColour, setTileColour] = useState(TILE_COLOURS[0]);
    const [tileImage, setTileImage] = useState(/** @type {string | null} */ (null));
    const [tileShape, setTileShape] = useState('circle');
    const [accounts, setAccounts] = useState(/** @type {any[]} */ ([]));
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const [busy, setBusy] = useState(false);
    // null = software (implicit); string = HW SignerRecord id. The
    // SignerSelectForm hides itself when only software is available
    // and emits onChange(null) once.
    const [signerId, setSignerId] = useState(/** @type {string | null} */ (null));
    const nameRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const userEditedRef = useRef(false);

    // The main section starts open, the Look section closed.
    const formSections = useFormSections({ account: true, look: false });

    const onPickSigner = useCallback((id) => setSignerId(id), []);

    useEffect(() => {
        setTimeout(() => nameRef.current?.focus(), 0);
    }, []);
    // Default the name from the highest derivation index once the list resolves.
    // If the user types something before the fetch returns, leave their
    // edit alone.

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listAccounts !== 'function') return undefined;
        messaging.listAccounts(walletId)
            .then((list) => {
                if (cancelled) return;
                const resolved = Array.isArray(list) ? list : [];
                setAccounts(resolved);
                if (userEditedRef.current) return;
                const next = resolved.reduce(
                    (highest, account) => Math.max(highest, Number.isInteger(account?.index) ? account.index : -1),
                    -1,
                ) + 2;
                setName(`Account ${next}`);
            })
            .catch(() => { /* keep default name */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);

    async function handleSubmit(event) {
        event.preventDefault();
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
        if (accounts.some((account) => nameKey(account?.name) === nameKey(trimmed))) {
            setError(`An account named "${trimmed}" already exists.`);
            return;
        }
        if (typeof messaging.createAccount !== 'function') {
            setError('Adding accounts is not available in this shell.');
            return;
        }
        setError(null);
        setBusy(true);
        try {
            const result = await messaging.createAccount({
                walletId,
                name: trimmed,
                signerId: signerId || undefined,
            });
            // The new account's look is saved once it exists.
            if (result?.account?.id) writeWalletTile(result.account.id, { colour: tileColour, image: tileImage, shape: tileShape });
            onCreated(result?.account);
        } catch (err) {
            // Show flow copy as is; developer text becomes lock-and-unlock advice (a stale signer pool is the usual cause)
            setError(userFacingMessage(err, 'Couldn\'t add the account. Lock and unlock your wallet, then try again.'));
            setBusy(false);
        }
    }

    // The one standard action, a verb with an icon.
    const actions = (
        <FormAction icon={<Icon.PlusIcon />} loading={busy} disabled={busy}>
            Add Account
        </FormAction>
    );

    return (
        <Screen
            variant={variant}
            header={<PageHeader onBack={onBack} backDisabled={busy} title="Add Account" />}
        >
            {/* FormFrame with the main section open and Look closed. */}
            <FormFrame
                label="Add Account"
                onSubmit={handleSubmit}
                action={actions}
            >
                <FormSection
                    id="account"
                    title="Account"
                    icon={Icon.UserIcon}
                    {...formSections.bind('account')}
                    revealKey={error ? 1 : 0}
                    summary={name.trim() || 'Unnamed'}
                >
                    {/* The account tile, centred at the top of the section. */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <span style={{ '--xc-avatar-shape': tileRadius(tileShape), display: 'inline-flex' }}>
                            <IdentityAvatar name={name || 'Account'} text={walletTileText(name)} seed="new-account" context="hero" variant="asset" tone={tileColour} src={tileImage} />
                        </span>
                    </div>
                    <SignerSelectForm
                        walletId={walletId}
                        value={signerId}
                        onChange={onPickSigner}
                        disabled={busy}
                    />
                    <Input
                        ref={nameRef}
                        label="Account name"
                        maxLength={NAME_MAX_LENGTH}
                        value={name}
                        onChange={(e) => {
                            userEditedRef.current = true;
                            setName(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="off"
                        disabled={busy}
                        error={error || undefined}
                        help="Names a separate set of addresses in this wallet."
                    />
                </FormSection>
                <FormSection
                    id="look"
                    title="Look"
                    icon={Icon.PaletteIcon}
                    optional
                    {...formSections.bind('look')}
                    summary={`${tileShape === 'rounded' ? 'Rounded' : 'Circle'}${tileImage ? ', image' : ', colour'}`}
                >
                    <TileLookFields noun="account" colour={tileColour} onColour={setTileColour} shape={tileShape} onShape={setTileShape} image={tileImage} onImage={setTileImage} />
                </FormSection>
            </FormFrame>
        </Screen>
    );
}
