// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button, Screen } from '@xchain-wallet/core/ui';
import { screenVariantFor, useMessaging } from '@xchain-wallet/core/shared/useMessaging.js';

const RUNTIME_CONNECTION_CODES = new Set([
    'RUNTIME_DISCONNECTED',
    'RUNTIME_NO_RESPONSE',
    'RUNTIME_TIMEOUT',
    'RUNTIME_UNAVAILABLE',
]);

export const BACKGROUND_RETRY_DELAYS_MS = Object.freeze([200, 800]);

export function isBackgroundConnectionError(error) {
    return RUNTIME_CONNECTION_CODES.has(error?.code);
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries only transport failures so vault and authentication errors keep
 * their dedicated recovery paths.
 */
export async function connectToBackground(load, {
    onRetry = () => {},
    retryDelays = BACKGROUND_RETRY_DELAYS_MS,
    delay = wait,
} = {}) {
    for (let attempt = 0; ; attempt += 1) {
        try {
            return await load();
        } catch (error) {
            if (!isBackgroundConnectionError(error) || attempt >= retryDelays.length) {
                throw error;
            }
            onRetry(error);
            await delay(retryDelays[attempt]);
        }
    }
}

export function BackgroundConnectionState({ failed = false, onReload }) {
    const { shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const reload = onReload || (() => window.location.reload());

    return (
        <Screen variant={variant}>
            <section
                className="popup-background-connection"
                role={failed ? 'alert' : 'status'}
                aria-live="polite"
            >
                <h1>{failed ? 'Unable to reconnect' : 'Reconnecting to wallet...'}</h1>
                <p>
                    {failed
                        ? 'The wallet background is not responding. Reload the popup to try again.'
                        : 'The wallet background is restarting. This should only take a moment.'}
                </p>
                {failed ? (
                    <Button type="button" variant="primary" block onClick={reload}>
                        Reload
                    </Button>
                ) : null}
            </section>
        </Screen>
    );
}
