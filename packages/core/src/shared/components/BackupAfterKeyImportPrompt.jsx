// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Shown right after a private key import (operator ruling 2026-11-16). A
// private key has no recovery phrase, so if this device is lost or erased the
// encrypted backup file is the only way to bring the key back. One G120 note:
// a bold title, the reason, one action that opens the existing backup export,
// and the X to dismiss it.

import { Icon, StatusMessage } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';

/**
 * @param {object} props
 * @param {() => void} props.onSaveBackup   opens the wallet's Export Backup page
 * @param {() => void} props.onDismiss
 * @param {string} [props.className]
 */
export function BackupAfterKeyImportPrompt({ onSaveBackup, onDismiss, className }) {
    return (
        <StatusMessage
            tone="info"
            role="status"
            className={className}
            testId="backup-after-key-import"
            title={t('components.backupAfterKeyImport.title')}
            action={{
                label: t('components.backupAfterKeyImport.save'),
                onAction: onSaveBackup,
                icon: <Icon.SaveIcon />,
            }}
            onDismiss={onDismiss}
            dismissLabel={t('components.backupAfterKeyImport.dismiss')}
        >
            {t('components.backupAfterKeyImport.body')}
        </StatusMessage>
    );
}
