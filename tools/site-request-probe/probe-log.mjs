// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

export function parseProbeLog(text) {
    if (typeof text !== 'string') return null;

    let value;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }

    if (!Array.isArray(value) || !value.every((entry) => (
        entry !== null
        && typeof entry === 'object'
        && !Array.isArray(entry)
        && typeof entry.type === 'string'
        && typeof entry.pageId === 'string'
        && typeof entry.session === 'string'
    ))) {
        return null;
    }

    return value;
}

function hasLandingParameter(href) {
    if (typeof href !== 'string') return false;

    try {
        return new URL(href, 'https://probe.invalid').searchParams.get('landing') === '1';
    } catch {
        return false;
    }
}

function receivedFrom(event, pageId, type = null) {
    return event.type === 'broadcast-received'
        && event.message !== null
        && typeof event.message === 'object'
        && event.message.pageId === pageId
        && (type === null || event.message.type === type);
}

function fragmentState(hash, marker) {
    if (hash === `#${marker}`) return 'intact';
    if (hash === null) return 'missing';
    return 'changed';
}

export function summarizeReturn({ origin, landing, marker }) {
    const originPageId = origin?.[0]?.pageId;
    let landingSnapshot = landing?.find((event) => (
        event.type === 'page-loaded' && event.landingMode === true
    ));

    if (!landingSnapshot && landing === null && originPageId !== undefined) {
        landingSnapshot = origin?.find((event) => (
            event.type === 'broadcast-received'
            && event.message !== null
            && typeof event.message === 'object'
            && event.message.pageId !== originPageId
            && hasLandingParameter(event.message.href)
        ))?.message;
    }

    if (!landingSnapshot) {
        return {
            landed: false,
            fragment: null,
            referrer: null,
            openerPresent: null,
            landingUserAgent: null,
            closed: null,
            broadcastToOrigin: null,
        };
    }

    const landingPageId = landingSnapshot.pageId;
    const didNotClose = landing?.some((event) => (
        event.pageId === landingPageId && event.type === 'window-close-did-not-close'
    )) ?? false;
    const closeRequestedLocally = landing?.some((event) => (
        event.pageId === landingPageId && event.type === 'window-close-requested'
    )) ?? false;
    const closeRequestedByBroadcast = origin?.some((event) => (
        receivedFrom(event, landingPageId, 'window-close-requested')
    )) ?? false;

    let closed = 'not-tried';
    if (didNotClose) closed = 'did-not-close';
    else if (closeRequestedLocally || closeRequestedByBroadcast) closed = 'requested';

    return {
        landed: true,
        fragment: fragmentState(landingSnapshot.hash, marker),
        referrer: landingSnapshot.referrer ?? null,
        openerPresent: landingSnapshot.openerPresent ?? null,
        landingUserAgent: landingSnapshot.userAgent ?? null,
        closed,
        broadcastToOrigin: origin === null
            ? null
            : origin.some((event) => receivedFrom(event, landingPageId)),
    };
}

export function summarizeRedirect({ destination, marker }) {
    const snapshot = destination?.find((event) => event.type === 'page-loaded');
    if (!snapshot) {
        return { arrived: false, fragment: null, navigationType: null };
    }

    return {
        arrived: true,
        fragment: fragmentState(snapshot.hash, marker),
        navigationType: snapshot.navigationType ?? null,
    };
}

export function matrixRow(values) {
    const cells = values.map((value) => (
        value === null ? '(empty)' : String(value).replaceAll('|', '\\|')
    ));
    return `| ${cells.join(' | ')} |`;
}
