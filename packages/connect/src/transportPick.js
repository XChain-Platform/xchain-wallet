// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: MIT

export const MIN_PROVIDER_VERSION = '0.2.0';

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const MIN_PROVIDER_PARTS = MIN_PROVIDER_VERSION.split('.').map(BigInt);
const PLATFORMS = new Set(['android', 'ios', 'desktop']);
const DESKTOP_PICKS = new Set(['app', 'web', 'get']);

export function providerReady(provider) {
    if (provider === null || typeof provider !== 'object') {
        return false;
    }
    if (typeof provider.version !== 'string') {
        return false;
    }

    const match = VERSION_PATTERN.exec(provider.version);
    if (match === null) {
        return false;
    }

    const parts = match.slice(1).map(BigInt);
    for (let index = 0; index < MIN_PROVIDER_PARTS.length; index += 1) {
        if (parts[index] > MIN_PROVIDER_PARTS[index]) {
            return true;
        }
        if (parts[index] < MIN_PROVIDER_PARTS[index]) {
            return false;
        }
    }

    return true;
}

export function androidIntentUrl(
    httpsLink,
    { packageName = 'io.xchain.wallet.android' } = {}
) {
    if (typeof httpsLink !== 'string') {
        throw new TypeError('httpsLink must be an https URL');
    }

    let parsed;
    try {
        parsed = new URL(httpsLink);
    } catch {
        throw new TypeError('httpsLink must be an https URL');
    }

    if (parsed.protocol !== 'https:') {
        throw new TypeError('httpsLink must be an https URL');
    }

    const intentTarget = httpsLink.slice('https://'.length);
    return `intent://${intentTarget}#Intent;scheme=https;package=${packageName};S.browser_fallback_url=${encodeURIComponent(httpsLink)};end`;
}

export function pickTransport({ provider, platform, rememberedPick }) {
    if (!PLATFORMS.has(platform)) {
        throw new TypeError('platform must be android, ios or desktop');
    }

    if (providerReady(provider)) {
        return { kind: 'provider' };
    }

    if (platform === 'android') {
        return { kind: 'intent' };
    }
    if (platform === 'ios') {
        return { kind: 'universal-link' };
    }
    if (DESKTOP_PICKS.has(rememberedPick)) {
        return { kind: rememberedPick };
    }

    return { kind: 'chooser' };
}
