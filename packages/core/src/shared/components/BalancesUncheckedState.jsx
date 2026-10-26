// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// One message, not two. When the wallet's balances could not be checked
// (the verdict behind "Some balances may be out of date"), a screen whose
// empty state depends on balances must not claim the wallet holds nothing.
// It shows this state instead, and the shell's notice steps aside on that
// screen so the page carries the message once.

import { EmptyState, Icon } from '@xchain-wallet/core/ui';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/balances.js';
import { useReachability } from '../hooks/useReachability.js';
import { useHideReachabilityNotice } from './hideReachabilityNotice.js';

/**
 * Whether balances could not be checked, and the retry that rechecks them.
 * Reads the same shared verdict as the shell's reachability notice.
 *
 * @returns {{ unchecked: boolean, recheck: () => void }}
 */
export function useBalancesUnchecked() {
    const { overall, refresh } = useReachability({});
    return { unchecked: overall === 'degraded' || overall === 'offline', recheck: refresh };
}

/**
 * @param {object} props
 * @param {() => void} props.onRetry       a press while a check runs joins it
 * @param {() => void} [props.onReceive]
 * @param {boolean} [props.plain]          default true; false inside a list area
 * @param {'h2' | 'h3' | 'p'} [props.titleAs]
 */
export function BalancesUncheckedState({ onRetry, onReceive, plain = true, titleAs }) {
    useHideReachabilityNotice(true);
    return (
        <EmptyState
            showWhileUnavailable
            plain={plain}
            titleAs={titleAs}
            icon={<Icon.InfoIcon />}
            title={t('balances.unchecked.title')}
            body={t('balances.unchecked.body')}
            actionLabel={t('common.tryAgain')}
            onAction={onRetry}
            actionIcon={<Icon.RefreshIcon />}
            secondaryActionLabel={onReceive ? t('home.receive') : undefined}
            onSecondaryAction={onReceive}
            secondaryActionIcon={<Icon.ReceiveIcon />}
        />
    );
}
