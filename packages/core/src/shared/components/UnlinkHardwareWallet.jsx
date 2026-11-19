// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Unlink a hardware wallet (hw-4 layout 1, third row): its own page, opened
// from the Unlink row on the wallet's details. The device card, one notice
// saying what goes and what stays, and one green Unlink Wallet button. There
// is no typed name and no Cancel; Back returns to the details.
//
// Unlinking removes the wallet record through the same wallet.remove every
// wallet uses, which also drops its signer rows. The coins never move: they
// stay on the device. Removing the active wallet hands over to another one,
// and removing the last wallet clears the vault so the app opens on Welcome,
// exactly as Remove wallet does.

import { useState } from 'react';
import { Button, FormNotice, FormPage, Icon, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { HardwareDeviceCard, hardwareVendorName } from './hardware/index.js';
import { clearLastView } from '../utils/lastViewMemory.js';
import { sweepMsgMemoryForWallet } from '../utils/msgReadMemory.js';
import { clearRemovedWalletStorage } from '../utils/wipeWalletStorage.js';
import { handOverAfterActiveWalletRemoved } from '../utils/activeWalletRemoval.js';
import { readVaultOccupancy } from '../utils/demoGraduation.js';
import { formatWithThousands } from '../utils/amountFormat.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/hardwareManage.js';
import styles from './UnlinkHardwareWallet.module.css';

function reloadPage() {
    if (typeof globalThis.location?.reload === 'function') globalThis.location.reload();
}

/**
 * The one notice the Unlink page shows.
 * @param {{name: string, vendor: string, count: number}} input
 */
export function unlinkNotice({ name, vendor, count }) {
    return count === 1
        ? t('hardwareManage.unlinkNoticeOne', { name, vendor })
        : t('hardwareManage.unlinkNoticeMany', { name, vendor, count: formatWithThousands(String(count)) });
}

/**
 * @param {object} props
 * @param {{ id: string, name?: string }} props.wallet
 * @param {{ vendor: string, model?: string } | null} [props.signer]   the wallet's SignerRecord
 * @param {'found'|'connected'|'not-connected'|'unlock'} [props.status]
 * @param {number} props.accountCount
 * @param {string | null} [props.activeWalletId]
 * @param {() => void} props.onBack
 * @param {(walletId: string) => void} [props.onUnlinked]  a wallet that was not active is gone; the host leaves the page
 * @param {() => void} [props.reload]                after the active or last wallet is unlinked
 */
export function UnlinkHardwareWallet({
    wallet,
    signer = null,
    status = 'not-connected',
    accountCount,
    activeWalletId = null,
    onBack,
    onUnlinked,
    reload = reloadPage,
}) {
    const { messaging, shell } = useMessaging();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(/** @type {string | null} */ (null));
    const vendor = hardwareVendorName(signer?.vendor);
    const name = wallet.name || vendor;

    async function handleUnlink() {
        if (busy) return;
        if (typeof messaging?.removeWallet !== 'function') {
            setError(t('hardwareManage.unlinkUnavailable'));
            return;
        }
        setBusy(true);
        setError(null);
        try {
            await messaging.removeWallet({ walletId: wallet.id });
        } catch {
            setError(t('hardwareManage.unlinkFailed'));
            setBusy(false);
            return;
        }
        clearLastView(wallet.id);
        sweepMsgMemoryForWallet(wallet.id);
        clearRemovedWalletStorage(wallet.id);
        // The active wallet, or the last one, needs the shared hand-over: pick
        // another wallet, or clear the vault so the next boot is Welcome.
        const left = wallet.id === activeWalletId ? 'handover' : await readVaultOccupancy(messaging);
        if (left === 'handover' || left === 'empty') {
            await handOverAfterActiveWalletRemoved({ messaging, removedWalletId: wallet.id, reload });
            return;
        }
        setBusy(false);
        onUnlinked?.(wallet.id);
    }

    return (
        <Screen
            variant={screenVariantFor(shell)}
            header={<PageHeader onBack={onBack} backDisabled={busy} title={t('hardwareManage.unlinkTitle')} />}
        >
            <FormPage
                as="div"
                className={styles.form}
                label={t('hardwareManage.unlinkTitle')}
                data-unlink-hardware-wallet=""
                status={(
                    <FormNotice
                        variant="warning"
                        role={error ? 'alert' : 'note'}
                        title={t('hardwareManage.unlinkNoticeTitle')}
                        lines={error ? [unlinkNotice({ name, vendor, count: accountCount }), error] : undefined}
                    >
                        {error ? null : unlinkNotice({ name, vendor, count: accountCount })}
                    </FormNotice>
                )}
                actions={(
                    <Button
                        variant="success"
                        block
                        icon={<Icon.UnlinkIcon />}
                        loading={busy}
                        disabled={busy}
                        onClick={handleUnlink}
                    >
                        {t('hardwareManage.unlinkTitle')}
                    </Button>
                )}
            >
                {/* The wide FormPage flattens padded cards by default. This
                    device is its own section, so keep the standard card surface
                    at the same 600px breakpoint where the outer form card starts. */}
                <div data-xc-preserve-nested-cards="">
                    <HardwareDeviceCard
                        vendor={signer?.vendor || ''}
                        model={signer?.model}
                        name={name}
                        status={status}
                    />
                </div>
            </FormPage>
        </Screen>
    );
}
