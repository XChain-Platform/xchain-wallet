// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export const UPDATE_FEED_MAX_BYTES = 4096;
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const UPDATE_CHANNELS = Object.freeze([
    'web',
    'chrome',
    'firefox',
    'edge',
    'ios',
    'macos-appstore',
    'android-play',
    'android-direct',
    'windows-store',
    'desktop-direct',
    'snap',
]);
export const UPDATE_HOSTS = Object.freeze({
    web: ['wallet.xchain.io'],
    chrome: ['chromewebstore.google.com'],
    firefox: ['addons.mozilla.org'],
    edge: ['microsoftedge.microsoft.com'],
    ios: ['apps.apple.com'],
    'macos-appstore': ['apps.apple.com'],
    'android-play': ['play.google.com'],
    'android-direct': ['downloads.xchain.io'],
    'windows-store': ['apps.microsoft.com', 'www.microsoft.com'],
    'desktop-direct': ['downloads.xchain.io'],
    snap: ['snapcraft.io'],
});

export function parseReleaseFeed(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('invalid update feed');
    }
    const latest = cleanVersion(body.latest);
    if (!SEMVER.test(latest) || !body.channels || typeof body.channels !== 'object' || Array.isArray(body.channels)) {
        throw new Error('invalid update feed');
    }
    const channels = {};
    for (const channel of UPDATE_CHANNELS) {
        if (!Object.hasOwn(body.channels, channel)) continue;
        const entry = body.channels[channel];
        const version = cleanVersion(entry?.version);
        if (!SEMVER.test(version) || isNewerVersion(version, latest)) {
            throw new Error('invalid update channel');
        }
        const url = validUpdateUrl(channel, entry?.url);
        if (!url) throw new Error('invalid update target');
        channels[channel] = { version, url };
    }
    return { latest, channels };
}

export function cleanVersion(version) {
    return String(version ?? '').replace(/^v/, '');
}

export function isNewerVersion(candidate, current) {
    const next = SEMVER.exec(cleanVersion(candidate));
    const installed = SEMVER.exec(cleanVersion(current));
    if (!next || !installed) return false;
    for (let index = 1; index <= 3; index += 1) {
        const difference = Number(next[index]) - Number(installed[index]);
        if (difference !== 0) return difference > 0;
    }
    return false;
}

function validUpdateUrl(channel, value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || !UPDATE_HOSTS[channel]?.includes(url.hostname)) return null;
        return url.href;
    } catch (_error) {
        return null;
    }
}
