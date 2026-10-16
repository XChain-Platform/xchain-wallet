// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The empty state of a network-backed list while the wallet is offline. It
// takes the place of the list's loading skeleton and of its load error, and
// it states the offline state itself, so the shell's reachability notice
// steps aside and the page carries one message.

import { EmptyState, Icon } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import { useHideReachabilityNotice } from './hideReachabilityNotice.js';

/**
 * @param {object} props
 * @param {string} props.body          what loads when the connection returns
 * @param {() => void} [props.onRetry] rechecks the connection
 * @param {'h2' | 'h3' | 'p'} [props.titleAs]
 */
export function OfflineEmptyState({ body, onRetry, titleAs }) {
    useHideReachabilityNotice(true);
    return (
        <EmptyState
            titleAs={titleAs}
            icon={<Icon.InfoIcon />}
            title={t('offline.empty.title')}
            body={body}
            actionLabel={onRetry ? t('common.tryAgain') : undefined}
            onAction={onRetry}
            actionIcon={onRetry ? <Icon.RefreshIcon /> : undefined}
        />
    );
}
