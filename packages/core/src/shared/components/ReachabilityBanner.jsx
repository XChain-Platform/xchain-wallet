// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// ReachabilityBanner: §49.1 / §49.2 / G152.
//
// The compact notice is the first row of the page content, below the page
// header, and reports only the user-facing consequence. Its Details disclosure identifies affected coins
// and when they were last checked, without service names or network kinds.

import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { StatusMessage } from '@xchain-wallet/core/ui';
import { useReachability } from '../hooks/useReachability.js';
import {
    NoticesRouteContext,
    ReachabilityNoticeHiddenContext,
    ReachabilityNoticeReportContext,
    ReachabilityNoticeWantedContext,
    routeHoldsNetworkData,
    routeMayShowBalances,
} from './noticesRoute.js';
import { t } from '../../i18n/index.js';
import { ReachabilityLine, affectedCoins } from './ReachabilityLine.jsx';

/**
 * @param {object} [props]
 * @param {string[]} [props.chainIds]   override chain set (otherwise read from settings.fees)
 * @param {number} [props.intervalMs]   override poll cadence
 * @param {number} [props.confirmMs]    override the corroborating-probe delay
 * @param {number} [props.startupGraceMs] override the cold-start silence window
 */
export function ReachabilityBanner({ chainIds, intervalMs, confirmMs, startupGraceMs }) {
    const { loading, overall, perChain, refresh, lastChecked } = useReachability({
        chainIds,
        intervalMs,
        confirmMs,
        startupGraceMs,
    });
    const routeKey = useContext(NoticesRouteContext);
    // A screen that already says its balances could not be checked takes
    // the place of this notice; the probe keeps running underneath.
    const hiddenByScreen = useContext(ReachabilityNoticeHiddenContext);
    // Balances are named only on a screen that can show one.
    const mayShowBalances = routeMayShowBalances(routeKey);
    // A screen of data held on this device has nothing to go out of date.
    // A local-data screen can still ask for the notice (the endpoint settings).
    const wantedByScreen = useContext(ReachabilityNoticeWantedContext);
    const holdsNetworkData = routeHoldsNetworkData(routeKey) || wantedByScreen;
    const unreachable = holdsNetworkData && (overall === 'degraded' || overall === 'offline');
    const variant = overall === 'offline' ? 'error' : 'warning';
    const text = mayShowBalances
        ? t('reachability.notice.balances')
        : t(overall === 'offline' ? 'reachability.notice.offline' : 'reachability.notice.degraded');

    // The route hears what this notice says even while a screen hides it, so
    // an empty state for data that could not be checked steps aside and a
    // form can carry the sentence in its own notice.
    const report = useContext(ReachabilityNoticeReportContext);
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    const retry = useCallback(() => refreshRef.current(), []);
    const coins = useMemo(() => affectedCoins(perChain), [perChain]);
    useEffect(() => {
        if (!report) return undefined;
        report(unreachable ? {
            variant,
            text,
            retryLabel: loading ? 'Checking…' : 'Try again',
            retrying: loading,
            retry,
            // What the Details disclosure shows, for a form that carries the sentence.
            coins,
            lastChecked,
        } : null);
        return undefined;
    }, [report, unreachable, variant, text, loading, retry, coins, lastChecked]);
    useEffect(() => (report ? () => report(null) : undefined), [report]);

    if (hiddenByScreen || !unreachable) return null;

    // The notice is a StatusMessage so it looks like every other notice. The
    // Details panel sits in the message's own flow, so it pushes route content
    // down instead of floating over it or scrolling inside the notice.
    return (
        <StatusMessage
            variant={variant}
            role={null}
            // This is the shell's notice itself, so its error tone never hides it.
            keepsShellNotice
            // The live region is the inner status span; the box carries the notice marker.
            marksNotice
            recovery={{
                label: loading ? 'Checking…' : 'Try again',
                onAction: refresh,
                disabled: loading,
            }}
        >
            <ReachabilityLine text={text} coins={coins} lastChecked={lastChecked} resetKey={routeKey} />
        </StatusMessage>
    );
}
