// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Remove Wallet is its own page for one wallet, opened from Wallet Details.
// It hosts the same name-confirmed removal Settings uses, pointed at the
// wallet the page was opened for, so opening it or backing out never switches
// the active wallet. Removing a wallet that is not active leaves the active
// one in place; removing the active one hands over to another wallet exactly
// as Settings does.

import { useCallback, useState } from 'react';
import { ListPage, PageHeader, PageNotice, PageNoticeHostContext, Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { ThisWalletSection } from '../components/settings/ThisWalletSection.jsx';
import { handOverAfterActiveWalletRemoved } from '../utils/activeWalletRemoval.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/walletDetails.js';
import settingsStyles from './Settings.module.css';

function reloadPage() {
    if (typeof globalThis.location?.reload === 'function') globalThis.location.reload();
}

/**
 * @param {object} props
 * @param {string} props.walletId                 the wallet to remove
 * @param {string} [props.walletName]             its name, which the user types to confirm
 * @param {string} [props.walletFormat]
 * @param {string | null} [props.activeWalletId]
 * @param {() => void} props.onBack
 * @param {(walletId: string) => void} [props.onRemoved]  a wallet that was not active is gone; the host refreshes its list and leaves
 * @param {() => void} [props.reload]             after the active wallet is removed
 */
export function RemoveWallet({ walletId, walletName = '', walletFormat, activeWalletId = null, onBack, onRemoved, reload = reloadPage }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [noticeHost, setNoticeHost] = useState(null);
    const [busy, setBusy] = useState(false);
    // The confirm step compares the typed text with the name, so a wallet
    // without a known name is never offered for removal.
    const wallet = walletId && walletName ? { id: walletId, name: walletName, format: walletFormat } : null;

    const handleRemoved = useCallback(async (removedWalletId) => {
        if (removedWalletId === activeWalletId) {
            await handOverAfterActiveWalletRemoved({ messaging, removedWalletId, reload });
            return;
        }
        onRemoved?.(removedWalletId);
    }, [activeWalletId, messaging, reload, onRemoved]);

    return (
        <Screen
            variant={variant}
            // Back stays shut while the removal runs, as on Settings' page.
            header={<PageHeader onBack={onBack} backDisabled={busy} title={t('walletDetails.remove.title')} />}
        >
            <ListPage
                className={settingsStyles.page}
                data-settings-layout="responsive"
                data-settings-page-template="subpage"
                notices={<div ref={setNoticeHost} style={{ display: 'contents' }} data-page-notice-host="" />}
            >
                <PageNoticeHostContext.Provider value={noticeHost}>
                    <div className={settingsStyles.settingsSurface} data-settings-section="wallet-remove">
                        {wallet ? (
                            <ThisWalletSection
                                // Keyed by wallet so a page reused for another wallet
                                // never carries a half-typed confirmation across.
                                key={walletId}
                                activeWallet={wallet}
                                only="remove"
                                onWalletRemoved={handleRemoved}
                                onBusyChange={setBusy}
                            />
                        ) : (
                            <PageNotice text={t('walletDetails.remove.notListed')} />
                        )}
                    </div>
                </PageNoticeHostContext.Provider>
            </ListPage>
        </Screen>
    );
}
