// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Settings > Privacy and Sites > Reset Privacy Settings: a confirm page of its
// own (G104, no modal), as Reset Display Settings is. One button restores
// every privacy default; Done returns to the list.

import { useState } from 'react';
import { Button, Icon, StatusMessage } from '@xchain-wallet/core/ui';
import { useSettings } from '../../hooks/useSettings.js';
import { t } from '../../../i18n/index.js';
import '../../../i18n/locales/en/common.js';
import '../../../i18n/locales/en/settings.js';
import { PRIVACY_CONTROL_DEFAULTS } from './PrivacySection.jsx';
import { SettingsLoadError } from './SettingsInlineRow.jsx';
import styles from './AppearancePages.module.css';

export function ResetPrivacyPage({ onDone }) {
    const { settings, error, update } = useSettings({ reportsOwnError: true });
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const [saveError, setSaveError] = useState(/** @type {string | null} */ (null));
    if (done) {
        return (
            <div className={styles.page}>
                <StatusMessage variant="success">{t('settings.privacy.resetPageDone')}</StatusMessage>
                <div className={styles.actions}>
                    <Button type="button" variant="success" block icon={<Icon.CheckIcon />} onClick={() => onDone?.()}>
                        {t('common.done')}
                    </Button>
                </div>
            </div>
        );
    }
    if (error) return <SettingsLoadError error={error} />;
    const reset = async () => {
        setSaveError(null);
        setBusy(true);
        try {
            await update({ privacy: PRIVACY_CONTROL_DEFAULTS });
            setDone(true);
        } catch (err) {
            setSaveError(t('settings.privacy.resetPageFailed'));
            // eslint-disable-next-line no-console
            console.error('privacy settings reset failed:', err);
        } finally {
            setBusy(false);
        }
    };
    return (
        <div className={styles.page}>
            {saveError ? <StatusMessage variant="error">{saveError}</StatusMessage> : null}
            <p className={styles.body}>{t('settings.privacy.resetPageIntro')}</p>
            <p className={styles.body}>{t('settings.privacy.resetPageSitesKept')}</p>
            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="danger"
                    block
                    icon={<Icon.RefreshIcon />}
                    disabled={!settings || busy}
                    onClick={reset}
                >
                    {busy ? t('settings.appearancePages.resetting') : t('settings.privacy.resetPageAction')}
                </Button>
            </div>
        </div>
    );
}
