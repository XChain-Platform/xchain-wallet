// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { neutralizeControlText } from '../utils/textHardening.js';
import styles from './OriginIdentity.module.css';

const STRUCTURED_SECOND_LEVEL_SUFFIXES = new Set([
    'ac', 'co', 'com', 'edu', 'go', 'gov', 'mil', 'ne', 'net', 'nom', 'or', 'org',
]);

const DOMAIN_LIKE_LABELS = new Set([
    'app', 'biz', 'co', 'com', 'dev', 'info', 'io', 'net', 'org', 'site', 'xyz',
]);

function isIpAddress(hostname) {
    return hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

/**
 * Return the site-defining portion of a DNS hostname. Country-code registries
 * commonly place registrations below a category such as co.uk or com.au.
 */
export function registrableDomainForHostname(hostname) {
    const normalized = String(hostname || '').toLowerCase().replace(/\.$/, '');
    if (!normalized || isIpAddress(normalized)) return normalized;
    const labels = normalized.split('.').filter(Boolean);
    if (labels.length < 3) return normalized;

    const tld = labels.at(-1);
    const secondLevel = labels.at(-2);
    const suffixLength = tld.length === 2 && STRUCTURED_SECOND_LEVEL_SUFFIXES.has(secondLevel)
        ? 2
        : 1;
    return labels.slice(-(suffixLength + 1)).join('.');
}

export function originIdentityDetails(origin) {
    try {
        const parsed = new URL(String(origin));
        const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
        const registrableDomain = registrableDomainForHostname(hostname);
        const labels = hostname.split('.').filter(Boolean);
        const domainLabels = registrableDomain.split('.').filter(Boolean);
        const prefixLabels = labels.slice(0, Math.max(0, labels.length - domainLabels.length));
        const hasPunycode = labels.some((label) => label.startsWith('xn--'));
        const hasDomainInPrefix = prefixLabels.some((label, index) => (
            index > 0 && DOMAIN_LIKE_LABELS.has(label)
        ));

        return {
            hostname,
            hostEnding: labels.slice(-3).join('.') || hostname,
            registrableDomain,
            hasPunycode,
            possibleLookalike: hasPunycode || hasDomainInPrefix,
        };
    } catch {
        return {
            hostname: '',
            hostEnding: '',
            registrableDomain: '',
            hasPunycode: false,
            possibleLookalike: false,
        };
    }
}

/**
 * Show the registrable domain before the complete browser-verified origin.
 * This keeps an attacker-controlled subdomain from receiving the emphasis.
 */
export function OriginIdentity({
    origin,
    label = 'Requesting site',
    testId,
    headingClassName = '',
    originClassName = '',
    embedded = false,
    as: Root = 'section',
    children,
}) {
    const displayedOrigin = neutralizeControlText(origin, { maxLength: 2048 });
    if (!displayedOrigin) return null;
    const details = originIdentityDetails(origin);
    const hostEnding = neutralizeControlText(details.hostEnding, { maxLength: 255 });

    return (
        <Root
            className={`${styles.identity} ${embedded ? styles.embedded : ''}`.trim()}
            role={Root === 'div' ? 'group' : undefined}
            aria-label={label}
            data-testid={testId}
        >
            <p className={`${styles.heading} ${headingClassName}`.trim()}>{label}</p>
            {hostEnding ? (
                <div className={styles.line}>
                    <span className={styles.lineLabel}>Host ending</span>
                    <code className={styles.hostEnding} data-testid="request-origin-host-ending" dir="ltr">
                        {hostEnding}
                    </code>
                </div>
            ) : null}
            {details.registrableDomain ? (
                <div className={styles.line}>
                    <span className={styles.lineLabel}>Site domain</span>
                    <code
                        className={styles.registrableDomain}
                        data-testid="request-origin-registrable-domain"
                        dir="ltr"
                    >
                        {details.registrableDomain}
                    </code>
                </div>
            ) : null}
            <div className={styles.line}>
                <span className={styles.lineLabel}>Full origin</span>
                <code
                    className={`${styles.fullOrigin} ${originClassName}`.trim()}
                    data-testid="request-origin-full"
                    dir="ltr"
                >
                    {displayedOrigin}
                </code>
            </div>
            {details.hasPunycode ? (
                <p className={styles.warning} role="alert">
                    Punycode domain. Verify the site address carefully before approving.
                </p>
            ) : null}
            {details.possibleLookalike ? (
                <p className={styles.warning} role="alert">
                    Possible lookalike domain. Confirm that the highlighted site domain is the one you expect.
                </p>
            ) : null}
            {children}
        </Root>
    );
}

/** Compatibility helper for callers that display a three-label hostname ending. */
export function originHostEnding(origin) {
    const { hostname, hostEnding } = originIdentityDetails(origin);
    const visibleHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ? hostname : hostEnding;
    return neutralizeControlText(visibleHost, { maxLength: 255 });
}
