// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { EmptyState, ListPage, Screen } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import { screenVariantFor, useMessaging } from '../useMessaging.js';

/**
 * Gives unmatched or incomplete route state an explicit recovery destination.
 */
export function RouteNotFound({ onHome }) {
    const { shell } = useMessaging();
    return (
        <Screen variant={screenVariantFor(shell)}>
            <ListPage>
                <EmptyState
                    title={t('routeNotFound.title')}
                    body={t('routeNotFound.body')}
                    actionLabel={t('routeNotFound.backToHome')}
                    onAction={onHome}
                />
            </ListPage>
        </Screen>
    );
}
