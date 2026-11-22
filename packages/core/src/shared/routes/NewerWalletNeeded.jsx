// Copyright (c) 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { EmptyState, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/siteRequest.js';

export function NewerWalletNeeded({ variant, onBack }) {
    return (
        <Screen
            variant={variant}
            header={<PageHeader onBack={onBack} title={null} />}
        >
            <EmptyState
                showWhileUnavailable
                title={t('siteRequest.newerWallet.title')}
                body={t('siteRequest.newerWallet.body')}
            />
        </Screen>
    );
}
