// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { forwardRef } from 'react';
import { Button, FormPage, Icon, Notice } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/adsNotice.js';
import { ADS_DEFAULT_PER_TRANSACTION, ADS_DEFAULT_SEND_AT } from '../../schemas/settings.js';
import { formatFiatAmount } from '../utils/fiatAmountFormat.js';
import styles from './AdsNotice.module.css';

/**
 * §36.1 ADS notice: the one-time screen at the end of onboarding, after a
 * wallet is created, imported, migrated from FreeWallet or restored from a
 * backup. It informs; it does not ask. The default donation settings already
 * hold, so there is nothing to write here. The amount, the send-at total and
 * the recipient live in Settings -> Automatic donations (operator rulings
 * 2026-10-12 and 2026-11-14).
 *
 * The notice owns its FormPage, so create and import end on the same screen at
 * every width.
 *
 * @param {object} props
 * @param {() => void} props.onContinue
 * @param {boolean} [props.busy]
 */
export const AdsNotice = forwardRef(function AdsNotice({ onContinue, busy = false, status = null }, ref) {
    return (
        <FormPage
            ref={ref}
            label={t('adsNotice.title')}
            className={styles.form}
            status={status}
            actions={(
                <Button
                    variant="success"
                    onClick={onContinue}
                    block
                    icon={<Icon.CheckIcon />}
                    loading={busy}
                    disabled={busy}
                >
                    {t('adsNotice.continue')}
                </Button>
            )}
        >
            <Notice
                tone="info"
                role={null}
                title={t('adsNotice.subtitle')}
            >
                <p>{t('adsNotice.defaultBehavior', {
                    perTransaction: formatFiatAmount(ADS_DEFAULT_PER_TRANSACTION, 'USD'),
                    sendAt: formatFiatAmount(ADS_DEFAULT_SEND_AT, 'USD'),
                })}</p>
                <p>{t('adsNotice.optional')}</p>
                <p>{t('adsNotice.settings')}</p>
            </Notice>
        </FormPage>
    );
});
