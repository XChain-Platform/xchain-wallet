// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense } from 'react';
import { Skeleton } from '@xchain-wallet/core/ui/Skeleton.jsx';
import { WalletRouteScope } from '@xchain-wallet/core/ui/Screen.jsx';
import { CurrentRouteContext } from './navSurface.js';
import { RouteErrorBoundary } from './RouteErrorBoundary.jsx';

export function ShellRouteOutlet({
    routeKey,
    walletId = null,
    resetKey = routeKey,
    onHome,
    fallback = <Skeleton.List rows={5} />,
    children,
}) {
    // routeKey is the shell's routed view id; PageHeader compares it with
    // the visible nav surface's destinations, so it stays the bare view id;
    // walletId scopes only the saved scroll offsets and the mounted route.
    return (
        <CurrentRouteContext.Provider value={routeKey}>
            <WalletRouteScope walletId={walletId} routeKey={routeKey}>
                <RouteErrorBoundary resetKey={resetKey} onHome={onHome} atHome={routeKey === 'home'}>
                    <Suspense fallback={fallback}>
                        {children}
                    </Suspense>
                </RouteErrorBoundary>
            </WalletRouteScope>
        </CurrentRouteContext.Provider>
    );
}
