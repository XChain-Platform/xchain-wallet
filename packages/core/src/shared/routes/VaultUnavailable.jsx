// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The screen for a vault that EXISTS and cannot be opened.
//
// The storage contract already gets the hard part right: a backend that
// cannot read an existing blob throws rather than answering "no wallet
// here", so the user is never dropped onto create-a-wallet for a vault that
// is merely locked (core/src/storage/backend.js, wallet spec §11.2). That
// was measured on an Android emulator on 2026-08-01 by corrupting the
// Keystore ciphertext: the app refused, exactly as designed.
//
// What it showed while refusing was `vault storage unavailable: vault failed
// its integrity check`, in red, centred, with no next step. For a
// self-custody user that line withholds the single most important fact -
// their recovery phrase still holds everything - and offers nothing to do.
// This screen is the answer to that, and it is shared: the failure belongs to
// the storage contract, not to any one shell.
//
// THE THREE KINDS ARE NOT THE SAME SCREEN, which is the reason this takes a
// kind rather than a message:
//
//   locked      nothing is wrong. The OS keystore will not release the key
//               until the device is unlocked. "Unlock your phone and try
//               again" is the whole answer, and offering to erase anything
//               here would be actively dangerous.
//   corrupt     the blob is damaged and no retry will fix it. This is the
//               only kind that offers the destructive escape, because it is
//               the only kind where the user genuinely cannot proceed
//               without it.
//   unavailable the backend could not be reached at all. Retry; do not
//               offer to erase a vault we were not even able to look at.
//   evicted     the encrypted store is gone but the vault's meta record is
//               still here, so a wallet WAS set up on this device and the
//               browser (not the wallet) removed it: storage eviction,
//               Safari's seven-day purge, clear-on-exit, a cleaner. Two
//               users reported this on 2026-09-16 as "it asked for my
//               recovery phrase again". Retry first, because a store that
//               reads empty once may be a transient; the escape stays
//               behind the WIPE gate because it also drops the meta, and
//               a blob that DID come back could never be opened without it.
//   incomplete  the encrypted store is gone and the meta is still here, on a
//               device whose stores only the wallet writes: a desktop reset
//               or a phone wipe that stopped between the two, or any other
//               loss of the blob. Nothing can be opened and onboarding
//               refuses over the meta, so the one way forward is to finish
//               the reset, and Reset this wallet leads the screen.
//
// The erase path deliberately reuses the Locked screen's type-WIPE gate
// rather than inventing a lighter one. A user reading this screen has just
// been told their wallet will not open, which is the worst possible moment
// to put a one-tap destructive button under their thumb.

import { useState } from 'react';
import { Button, FormPage, Icon, Input, Notice, Screen, StatusMessage, useFormErrors } from '@xchain-wallet/core/ui';
import { ActionList, ActionListItem } from '../components/ActionList.jsx';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { wipeWalletStorage } from '../utils/wipeWalletStorage.js';
import { isExactTypedConfirmation } from '../../flows/typedConfirmation.js';
import { t } from '../../i18n/index.js';
import styles from './VaultUnavailable.module.css';

/** The four storage diagnoses share one heading and paragraph shape. */
const BODY_KEYS = {
    locked: 'vaultUnavailable.locked.body',
    corrupt: 'vaultUnavailable.corrupt.body',
    unavailable: 'vaultUnavailable.unavailable.body',
    evicted: 'vaultUnavailable.evicted.body',
};

/** Copy for an install whose meta outlived its vault. */
function incompleteCopy() {
    return {
        title: t('vaultUnavailable.incomplete.title'),
        body: t('vaultUnavailable.incomplete.body'),
        nextStep: t('vaultUnavailable.incomplete.nextStep'),
    };
}

/** The kinds where the user genuinely cannot proceed without the escape. */
const OFFERS_ESCAPE = new Set(['corrupt', 'evicted', 'incomplete']);

/** The escape panel's copy, per kind: what is being removed and why. */
const WIPE_COPY = {
    corrupt: {
        region: 'Remove the damaged wallet data',
        note: 'This removes the damaged wallet data from this device so'
            + ' you can import your wallet again. It changes nothing on'
            + ' the blockchain. Without your recovery phrase it cannot be'
            + ' undone.',
        button: 'Remove Damaged Data',
        failed: 'Could not remove the damaged wallet data. Try again, or restart the app and try once more.',
    },
    evicted: {
        region: 'Clear what is left of the old wallet',
        note: 'This clears the remaining record of the old wallet on this'
            + ' device so you can import your wallet again from its recovery'
            + ' phrase. It changes nothing on the blockchain. If you would'
            + ' rather check first whether the data comes back, use Try Again.',
        button: 'Clear and Start Over',
        failed: 'Could not clear the old wallet data. Try again, or restart the app and try once more.',
    },
};

/** The escape panel copy for an incomplete install: the reset, finished. */
function incompleteWipeCopy() {
    return {
        region: t('vaultUnavailable.incomplete.region'),
        note: t('vaultUnavailable.incomplete.note'),
        button: t('vaultUnavailable.incomplete.reset'),
        failed: t('vaultUnavailable.incomplete.failed'),
    };
}

/**
 * @param {object} props
 * @param {'corrupt' | 'locked' | 'unavailable' | 'evicted' | 'incomplete'} props.kind
 * @param {() => void | Promise<void>} [props.onRetry] defaults to reloading the app
 * @param {() => Promise<void>} [props.wipe] injectable for tests
 */
export function VaultUnavailable({ kind, onRetry, wipe = wipeWalletStorage }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const incomplete = kind === 'incomplete';
    const resolvedKind = incomplete || BODY_KEYS[kind] ? kind : 'unavailable';
    const copy = incomplete ? incompleteCopy() : { body: t(BODY_KEYS[resolvedKind]) };
    // A re-read of an incomplete install answers the same, so its screen
    // leads with the reset instead of a retry.
    const offersRetry = resolvedKind !== 'corrupt' && !incomplete;
    const offersEscape = OFFERS_ESCAPE.has(resolvedKind);
    const wipeCopy = incomplete ? incompleteWipeCopy() : (WIPE_COPY[resolvedKind] || WIPE_COPY.corrupt);

    const [wipeOpen, setWipeOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);
    const [wipeError, setWipeError] = useState(/** @type {string | null} */ (null));
    const [retryError, setRetryError] = useState(/** @type {string | null} */ (null));
    const wipeErrors = useFormErrors();
    const wipeConfirmId = 'vault-unavailable-wipe-confirm';

    async function handleRetry() {
        setRetryError(null);
        try {
            if (onRetry) await onRetry();
            else if (typeof window !== 'undefined') window.location.reload();
            return true;
        } catch {
            setRetryError('Could not try again. Check your connection, then retry.');
            return false;
        }
    }

    async function handleWipe() {
        if (busy) return;
        if (!wipeErrors.validate({
            [wipeConfirmId]: isExactTypedConfirmation(confirmText, 'WIPE')
                ? null
                : 'Type WIPE exactly to continue.',
        })) return;
        setBusy(true);
        setWipeError(null);
        try {
            await wipe();
            const retried = await handleRetry();
            if (!retried) setBusy(false);
        } catch {
            setWipeError(wipeCopy.failed);
            setBusy(false);
        }
    }

    return (
        // A vault that cannot open sits outside the wallet shell, like Loading
        // and Lock, so it has neither an app bar nor a page header.
        <Screen variant={variant} bodyClassName={styles.centre}>
            <FormPage
                label={t('vaultUnavailable.title')}
                className={styles.vaultCard}
                onSubmit={(event) => event.preventDefault()}
                errors={wipeOpen ? wipeErrors : undefined}
            >
                <div className={styles.wrap}>
                    <h1 className={styles.title}>{t('vaultUnavailable.title')}</h1>
                    <p className={styles.body}>
                        {copy.body}{copy.nextStep ? ` ${copy.nextStep}` : ''}{' '}
                        {t('vaultUnavailable.recoverySafe')} {t('vaultUnavailable.blockchainSafe')}
                    </p>
                        {/* The recovery actions are one ActionList (G101). The
                            escape row is offered for `corrupt`, `evicted` and
                            `incomplete` alone. On `locked` the vault is perfectly
                            intact and the user simply has not unlocked their
                            device; on `unavailable` we could not read the vault,
                            so we are in no position to call it damaged. Erasing
                            in either case would destroy a working wallet to fix
                            nothing. */}
                        {offersRetry || (offersEscape && !wipeOpen) ? (
                            <ActionList label={t('vaultUnavailable.actions.label')}>
                                {offersRetry ? (
                                    <ActionListItem
                                        icon={<Icon.RefreshIcon />}
                                        onClick={() => { void handleRetry(); }}
                                        title={t('vaultUnavailable.actions.retry.title')}
                                        description={t('vaultUnavailable.actions.retry.description')}
                                    />
                                ) : null}
                                {offersEscape && !wipeOpen && incomplete ? (
                                    // A removal is red, never the blue or green of a
                                    // forward step.
                                    <ActionListItem
                                        tone="danger"
                                        icon={<Icon.TrashIcon />}
                                        onClick={() => setWipeOpen(true)}
                                        title={t('vaultUnavailable.actions.reset.title')}
                                        description={t('vaultUnavailable.actions.reset.description')}
                                        aria-expanded="false"
                                        aria-controls="vault-unavailable-wipe-panel"
                                    />
                                ) : null}
                                {offersEscape && !wipeOpen && !incomplete ? (
                                    <ActionListItem
                                        icon={<Icon.KeyIcon />}
                                        onClick={() => setWipeOpen(true)}
                                        title={t('vaultUnavailable.actions.restore.title')}
                                        description={t('vaultUnavailable.actions.restore.description')}
                                        aria-expanded="false"
                                        aria-controls="vault-unavailable-wipe-panel"
                                    />
                                ) : null}
                            </ActionList>
                        ) : null}
                        {retryError ? (
                            <StatusMessage variant="error">{retryError}</StatusMessage>
                        ) : null}

                        {offersEscape && wipeOpen ? (
                            <div
                                id="vault-unavailable-wipe-panel"
                                className={styles.wipeConfirm}
                                role="region"
                                aria-label={wipeCopy.region}
                            >
                                <Notice
                                    tone="danger"
                                    role="note"
                                    title={t('vaultUnavailable.wipeWarning')}
                                >
                                    {wipeCopy.note}
                                </Notice>
                                <Input
                                    id={wipeConfirmId}
                                    type="text"
                                    label={t('vaultUnavailable.wipeConfirm')}
                                    help={t('common.typedConfirmationHint', { word: 'WIPE' })}
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value)}
                                    autoComplete="off"
                                    autoCapitalize="characters"
                                    disabled={busy}
                                />
                                <Button
                                    type="button"
                                    variant="danger"
                                    block
                                    icon={<Icon.TrashIcon />}
                                    onClick={handleWipe}
                                    loading={busy}
                                >
                                    {wipeCopy.button}
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    block
                                    icon={<Icon.XIcon />}
                                    onClick={() => {
                                        setWipeOpen(false);
                                        setConfirmText('');
                                        setWipeError(null);
                                        wipeErrors.reset();
                                    }}
                                    disabled={busy}
                                >
                                    {t('common.cancel')}
                                </Button>
                                {wipeError ? (
                                    <StatusMessage variant="error" className={styles.wipeError}>{wipeError}</StatusMessage>
                                ) : null}
                            </div>
                        ) : null}
                </div>
            </FormPage>
        </Screen>
    );
}
