// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense } from 'react';
import { Skeleton } from '@xchain-wallet/core/ui/Skeleton.jsx';
import { ScrollRestoration } from '@xchain-wallet/core/ui/Screen.jsx';
import { RouteErrorBoundary } from './RouteErrorBoundary.jsx';

export function ShellRouteOutlet({
    routeKey,
    resetKey = routeKey,
    onHome,
    fallback = <Skeleton.List rows={5} />,
    children,
}) {
    return (
        <ScrollRestoration routeKey={routeKey}>
            <RouteErrorBoundary resetKey={resetKey} onHome={onHome}>
                <Suspense fallback={fallback}>
                    {children}
                </Suspense>
            </RouteErrorBoundary>
        </ScrollRestoration>
    );
}
