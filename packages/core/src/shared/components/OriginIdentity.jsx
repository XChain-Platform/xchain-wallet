// Copyright © 2025–2026 Dankest, LLC
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

/**
 * Show the authoritative end of a hostname before its complete origin.
 * A long attacker-controlled prefix cannot push the site-defining suffix
 * out of the first identity line.
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
    const hostEnding = originHostEnding(origin);

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
            {children}
        </Root>
    );
}

/** Keep three trailing DNS labels visible without claiming to parse the public suffix list. */
export function originHostEnding(origin) {
    try {
        const hostname = new URL(String(origin)).hostname;
        const labels = hostname.split('.').filter(Boolean);
        const visibleHost = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
            ? hostname
            : labels.slice(-3).join('.') || hostname;
        return neutralizeControlText(visibleHost, { maxLength: 255 });
    } catch {
        return '';
    }
}
