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
import { Screen, Input, Icon, Notice, PageHeader, SectionHeader, useFormErrors } from '@xchain-wallet/core/ui';
// The Wallet Form Standard frame (no From and no fee: this form never signs or sends).
import { FormAction, FormFrame } from '../components/formStandard/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { SignerSelectForm } from './SignerSelectForm.jsx';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { isHardwareWallet } from '../../flows/hardwareWallet.js';
import { ActionList } from '../components/ActionList.jsx';
import {
    HardwareNetworkRow, addNetworkKey, useAddHardwareNetwork,
} from '../components/hardware/HardwareNetworkRow.jsx';
import { defaultRegistry } from '../../registry/index.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/accountPicker.js';
import '../../i18n/locales/en/common.js';
import '../../i18n/locales/en/hardwareManage.js';
import '../../i18n/locales/en/renameAccount.js';
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
    const formErrors = useFormErrors();
    const [busy, setBusy] = useState(false);
    // null = software (implicit); string = HW SignerRecord id. The
    // SignerSelectForm hides itself when only software is available
    // and emits onChange(null) once.
    const [signerId, setSignerId] = useState(/** @type {string | null} */ (null));
    const nameRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const userEditedRef = useRef(false);
    // A hardware wallet has no seed: every account it adds comes from its own
    // device, so the signer is pinned to that device and the picker hides.
    const [hardwareSignerId, setHardwareSignerId] = useState(/** @type {string | null} */ (null));
    const [hardwareVendor, setHardwareVendor] = useState('');
    // A Ledger answers only the open app's coin: the account is added with the
    // networks that app read, and the others wait here, each with the connect
    // step's line and Try again, until Done hands the account to the shell.
    const [added, setAdded] = useState(/** @type {{ account: any, waiting: string[] } | null} */ (null));
    const onNetworkAdded = useCallback((_accountId, chainId) => {
        setAdded((current) => (current ? { ...current, waiting: current.waiting.filter((id) => id !== chainId) } : current));
    }, []);
    const addNetwork = useAddHardwareNetwork({
        messaging, walletId, signerId: hardwareSignerId, onAdded: onNetworkAdded,
    });

    const onPickSigner = useCallback((id) => setSignerId(id), []);

    useEffect(() => {
        setTimeout(() => nameRef.current?.focus(), 0);
    }, []);

    useEffect(() => {
        let cancelled = false;
        if (typeof messaging.listWallets !== 'function' || typeof messaging.listSigners !== 'function') return undefined;
        Promise.resolve()
            .then(() => messaging.listWallets())
            .then(async (list) => {
                const wallet = Array.isArray(list) ? list.find((w) => w?.id === walletId) : null;
                if (!isHardwareWallet(wallet)) return;
                const records = await messaging.listSigners(walletId);
                const record = Array.isArray(records)
                    ? (records.find((r) => r?.walletId === walletId) || records[0])
                    : null;
                if (!cancelled && record?.id) {
                    setHardwareSignerId(record.id);
                    setHardwareVendor(typeof record.vendor === 'string' ? record.vendor : '');
                }
            })
            .catch(() => { /* a software wallet keeps its picker */ });
        return () => { cancelled = true; };
    }, [walletId, messaging]);
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
        const nameError = !hasVisibleText(trimmed)
            ? 'Account name is required.'
            : nameLength(trimmed) > NAME_MAX_LENGTH
                ? `Account name must be ${NAME_MAX_LENGTH} characters or fewer.`
                : accounts.some((account) => nameKey(account?.name) === nameKey(trimmed))
                    ? `An account named "${trimmed}" already exists.`
                    : null;
        if (!formErrors.validate({ 'account-name': nameError })) return;
        if (typeof messaging.createAccount !== 'function') {
            formErrors.fail('Adding accounts is not available in this shell.');
            return;
        }
        setBusy(true);
        try {
            const result = await messaging.createAccount({
                walletId,
                name: trimmed,
                signerId: hardwareSignerId || signerId || undefined,
            });
            // The new account's look is saved once it exists.
            if (result?.account?.id) writeWalletTile(result.account.id, { colour: tileColour, image: tileImage, shape: tileShape });
            const waiting = Array.isArray(result?.waitingChains)
                ? result.waitingChains.filter((id) => typeof id === 'string' && id)
                : [];
            if (hardwareSignerId && result?.account?.id && waiting.length) {
                addNetwork.wait(result.account.id, waiting);
                setAdded({ account: result.account, waiting });
                setBusy(false);
                return;
            }
            onCreated(result?.account);
        } catch (err) {
            // Show flow copy as is; developer text becomes lock-and-unlock advice (a stale signer pool is the usual cause)
            formErrors.fail(userFacingMessage(err, 'Couldn\'t add the account. Lock and unlock your wallet, then try again.'));
            setBusy(false);
        }
    }

    if (added) {
        // The account exists: Done, or Back, hands it to the shell as created.
        const finish = () => onCreated(added.account);
        const registry = defaultRegistry();
        const reading = added.waiting.some((id) => addNetwork.states[addNetworkKey(added.account.id, id)] === 'reading');
        return (
            <Screen
                variant={variant}
                header={<PageHeader onBack={finish} backDisabled={reading} title={t('accountPicker.add')} />}
            >
                <FormFrame
                    label={t('accountPicker.add')}
                    onSubmit={(event) => { event.preventDefault(); finish(); }}
                    action={(
                        <FormAction icon={<Icon.CheckIcon />} disabled={reading}>
                            {t('common.done')}
                        </FormAction>
                    )}
                >
                    <div data-hardware-waiting="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-2)', minWidth: 0 }}>
                        <Notice tone="info" title={t('hardwareManage.waitingNoticeTitle')} role="note">
                            {t('hardwareManage.waitingLine', { nameState: added.account.name ? 'named' : 'unnamed', name: added.account.name })}
                        </Notice>
                        {added.waiting.length ? (
                            <>
                                <SectionHeader as="h3" title={t('hardwareManage.waitingTitle')} />
                                <ActionList label={t('hardwareManage.waitingList')}>
                                    {added.waiting.map((chainId) => {
                                        const descriptor = registry.get(chainId) || { id: chainId, displayName: chainId };
                                        return (
                                            <HardwareNetworkRow
                                                key={chainId}
                                                descriptor={descriptor}
                                                title={descriptor.displayName || chainId}
                                                vendor={hardwareVendor}
                                                state={addNetwork.states[addNetworkKey(added.account.id, chainId)]}
                                                onAdd={() => { void addNetwork.add(added.account.id, chainId); }}
                                            />
                                        );
                                    })}
                                </ActionList>
                            </>
                        ) : null}
                    </div>
                </FormFrame>
            </Screen>
        );
    }

    // The one standard action, a verb with an icon.
    const actions = (
        <FormAction icon={<Icon.PlusIcon />} loading={busy} disabled={busy}>
            {t('accountPicker.add')}
        </FormAction>
    );

    return (
        <Screen
            variant={variant}
            header={<PageHeader onBack={onBack} backDisabled={busy} title={t('accountPicker.add')} />}
        >
            {/* FormFrame around one flat set of fields. */}
            <FormFrame
                label={t('accountPicker.add')}
                onSubmit={handleSubmit}
                errors={formErrors}
                action={actions}
            >
                {/* One flat form, no section wrappers: the look tile, Account name,
                    then Icon colour, Icon shape and Icon image. */}
                <div data-flat-look-form="" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-4)', minWidth: 0 }}>
                    {/* The current look tile, centred at the top. */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <span style={{ '--xc-avatar-shape': tileRadius(tileShape), display: 'inline-flex' }}>
                            <IdentityAvatar name={name || 'Account'} text={walletTileText(name)} seed="new-account" context="hero" variant="asset" tone={tileColour} src={tileImage} />
                        </span>
                    </div>
                    {hardwareSignerId ? null : (
                        <SignerSelectForm
                            walletId={walletId}
                            value={signerId}
                            onChange={onPickSigner}
                            disabled={busy}
                        />
                    )}
                    <Input
                        id="account-name"
                        ref={nameRef}
                        label={t('renameAccount.name')}
                        maxLength={NAME_MAX_LENGTH}
                        value={name}
                        onChange={(e) => {
                            userEditedRef.current = true;
                            setName(e.target.value);
                        }}
                        autoComplete="off"
                        disabled={busy}
                        help={t('accountPicker.addNameHelp')}
                    />
                    <TileLookFields kind="account" colour={tileColour} onColour={setTileColour} shape={tileShape} onShape={setTileShape} image={tileImage} onImage={setTileImage} />
                </div>
            </FormFrame>
        </Screen>
    );
}
