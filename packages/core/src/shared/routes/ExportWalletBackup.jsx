// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Export Backup is its own page for one wallet, opened from Wallet Details.
// It hosts the same encrypted-backup export Settings uses, pointed at the
// wallet the page was opened for rather than the active one, so exporting a
// wallet never switches the active wallet.

import { useState } from 'react';
import { ListPage, PageHeader, PageNoticeHostContext, Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { BackupSection } from '../components/settings/BackupSection.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/settings.js';
import settingsStyles from './Settings.module.css';

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.walletName]
 * @param {string} [props.walletFormat]
 * @param {() => void} props.onBack
 * @param {() => void} [props.onExportInTab]  the extension's toolbar popup closes when a
 *   download takes focus, so there the export continues in a full tab
 */
export function ExportWalletBackup({ walletId, walletName = '', walletFormat, onBack, onExportInTab }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [noticeHost, setNoticeHost] = useState(null);
    const wallet = walletId ? { id: walletId, name: walletName, format: walletFormat } : null;
    return (
        <Screen variant={variant} header={<PageHeader onBack={onBack} title={t('settings.help.backup.exportBackup')} />}>
            <ListPage
                className={settingsStyles.page}
                data-settings-layout="responsive"
                data-settings-page-template="subpage"
                notices={<div ref={setNoticeHost} style={{ display: 'contents' }} data-page-notice-host="" />}
            >
                <PageNoticeHostContext.Provider value={noticeHost}>
                    <div className={settingsStyles.settingsSurface} data-settings-section="wallet-backup">
                        <BackupSection
                            // Keyed by wallet so a page reused for another wallet
                            // never carries a half-finished export across.
                            key={walletId || 'none'}
                            activeWallet={wallet}
                            onExportInTab={onExportInTab}
                            only="export"
                        />
                    </div>
                </PageNoticeHostContext.Provider>
            </ListPage>
        </Screen>
    );
}
