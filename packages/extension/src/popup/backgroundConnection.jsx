// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Button } from '@xchain-wallet/core/ui';
import { t } from '../../../core/src/i18n/index.js';
import '@xchain-wallet/core/i18n/locales/en/extension.js';

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
    const reload = onReload || (() => window.location.reload());

    return (
        <section
            className="popup-background-connection"
            role={failed ? 'alert' : 'status'}
            aria-live="polite"
        >
            <h1>{failed ? t('extension.connection.unableToReconnect') : t('extension.connection.reconnectingToWallet')}</h1>
            <p>
                {failed
                    ? t('extension.connection.theWalletBackgroundIsNot')
                    : t('extension.connection.theWalletBackgroundIsRestarting')}
            </p>
            {failed ? (
                <Button type="button" variant="primary" block onClick={reload}>
                    {t('extension.connection.reload')}
                </Button>
            ) : null}
        </section>
    );
}
