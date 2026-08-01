// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The screen for a vault that EXISTS and cannot be opened .
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
//
// The erase path deliberately reuses the Locked screen's type-WIPE gate
// rather than inventing a lighter one. A user reading this screen has just
// been told their wallet will not open, which is the worst possible moment
// to put a one-tap destructive button under their thumb.

import { useState } from 'react';
import { Screen, Button, Input } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { wipeWalletStorage } from '../utils/wipeWalletStorage.js';
import styles from './VaultUnavailable.module.css';

/** Headline and body per kind. Plain language, and never blame the user. */
const COPY = {
    locked: {
        title: 'Your device needs to be unlocked',
        body: 'Your wallet is safe on this device. Its keys are held in the'
            + " device's secure storage, which stays locked until you unlock the"
            + ' device itself. Unlock it, then try again.',
    },
    corrupt: {
        title: 'This device’s copy of your wallet is damaged',
        body: 'The wallet file stored here cannot be opened, and trying again'
            + ' will not repair it.',
    },
    unavailable: {
        title: 'Your wallet could not be opened',
        body: "This device's secure storage could not be reached, so the wallet"
            + ' was not opened. This is usually temporary.',
    },
};

/**
 * @param {object} props
 * @param {'corrupt' | 'locked' | 'unavailable'} props.kind
 * @param {string} [props.detail]      the raw error, kept for support
 * @param {() => void} [props.onRetry] defaults to reloading the app
 * @param {() => Promise<void>} [props.wipe] injectable for tests
 */
export function VaultUnavailable({ kind, detail, onRetry, wipe = wipeWalletStorage }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const copy = COPY[kind] || COPY.unavailable;

    const [wipeOpen, setWipeOpen] = useState(false);
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);
    const [wipeError, setWipeError] = useState(/** @type {string | null} */ (null));

    function handleRetry() {
        if (onRetry) { onRetry(); return; }
        if (typeof window !== 'undefined') window.location.reload();
    }

    async function handleWipe() {
        if (busy) return;
        if (confirmText.trim().toUpperCase() !== 'WIPE') return;
        setBusy(true);
        setWipeError(null);
        try {
            await wipe();
            if (typeof window !== 'undefined') window.location.reload();
        } catch (err) {
            setWipeError(err?.message || 'Could not remove the damaged wallet data.');
            setBusy(false);
        }
    }

    return (
        <Screen variant={variant}>
            <div className={styles.wrap} role="alert">
                <h1 className={styles.title}>{copy.title}</h1>
                <p className={styles.body}>{copy.body}</p>

                {/* The fact the old screen withheld, and the reason none of
                    this is a catastrophe. Said on every kind, because a user
                    who has just been told their wallet will not open should
                    not have to work out whether their coins are gone. */}
                <p className={styles.reassure}>
                    <strong>Your recovery phrase still holds everything.</strong>
                    {' '}
                    Your coins live on the blockchain, not in this app. Anything
                    stored here is only a copy, and your recovery phrase restores
                    it on this device or any other.
                </p>

                <Button type="button" variant="primary" block onClick={handleRetry}>
                    Try again
                </Button>

                {/* Offered for `corrupt` alone. On `locked` the vault is
                    perfectly intact and the user simply has not unlocked their
                    device; on `unavailable` we could not read the vault, so we
                    are in no position to call it damaged. Erasing in either
                    case would destroy a working wallet to fix nothing. */}
                {kind === 'corrupt' && !wipeOpen ? (
                    <button
                        type="button"
                        className={styles.escapeLink}
                        onClick={() => setWipeOpen(true)}
                        aria-expanded="false"
                        aria-controls="vault-unavailable-wipe-panel"
                    >
                        Start over from my recovery phrase
                    </button>
                ) : null}

                {kind === 'corrupt' && wipeOpen ? (
                    <div
                        id="vault-unavailable-wipe-panel"
                        className={styles.wipeConfirm}
                        role="region"
                        aria-label="Remove the damaged wallet data"
                    >
                        <p className={styles.wipeWarning}>
                            <strong>
                                Do not do this unless you have your recovery phrase
                                or an encrypted backup file to hand.
                            </strong>
                        </p>
                        <p className={styles.wipeNote}>
                            This removes the damaged wallet data from this device so
                            you can import your wallet again. It changes nothing on
                            the blockchain. Without your recovery phrase it cannot be
                            undone.
                        </p>
                        <Input
                            type="text"
                            label="Type WIPE to confirm"
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
                            onClick={handleWipe}
                            loading={busy}
                            disabled={busy || confirmText.trim().toUpperCase() !== 'WIPE'}
                        >
                            Remove damaged data
                        </Button>
                        <Button
                            type="button"
                            variant="secondary"
                            block
                            onClick={() => { setWipeOpen(false); setConfirmText(''); setWipeError(null); }}
                            disabled={busy}
                        >
                            Cancel
                        </Button>
                        {wipeError ? (
                            <p role="alert" className={styles.wipeError}>{wipeError}</p>
                        ) : null}
                    </div>
                ) : null}

                {/* Last, small, and unstyled as prose: it is for a support
                    conversation, not for the person reading the screen. */}
                {detail ? (
                    <p className={styles.detail}>Technical detail: {detail}</p>
                ) : null}
            </div>
        </Screen>
    );
}
