// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense, useMemo } from 'react';
import { Skeleton } from '@xchain-wallet/core/ui/Skeleton.jsx';
import { WalletRouteScope } from '@xchain-wallet/core/ui/Screen.jsx';
import { NavHistoryContext } from '@xchain-wallet/core/ui/navHistory.js';
import { CurrentRouteContext } from './navSurface.js';
import { RouteErrorBoundary } from './RouteErrorBoundary.jsx';

/**
 * @param {object} props
 * @param {string} props.routeKey     the shell's routed view id.
 * @param {boolean} [props.canGoBack] the shell history's `canGoBack`: false
 *   on a root page, so PageHeader leaves out its Back chevron. Omitted, every
 *   screen with a Back handler shows Back.
 */
export function ShellRouteOutlet({
    routeKey,
    walletId = null,
    resetKey = routeKey,
    onHome,
    canGoBack,
    fallback = <Skeleton.List rows={5} />,
    children,
}) {
    // routeKey is the shell's routed view id, kept bare for the screens that
    // read it; walletId scopes only the saved scroll offsets and the mounted route.
    const history = useMemo(
        () => (typeof canGoBack === 'boolean' ? { canGoBack } : null),
        [canGoBack],
    );
    return (
        <CurrentRouteContext.Provider value={routeKey}>
            <NavHistoryContext.Provider value={history}>
                <WalletRouteScope walletId={walletId} routeKey={routeKey}>
                    <RouteErrorBoundary resetKey={resetKey} onHome={onHome} atHome={routeKey === 'home'}>
                        <Suspense fallback={fallback}>
                            {children}
                        </Suspense>
                    </RouteErrorBoundary>
                </WalletRouteScope>
            </NavHistoryContext.Provider>
        </CurrentRouteContext.Provider>
    );
}
