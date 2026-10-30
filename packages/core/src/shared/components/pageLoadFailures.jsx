// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// A page that loads several things shows one error that names what could not
// load, with one Try again, instead of one error per panel. The page provides
// the context; a panel inside it reports its failure with
// useReportLoadFailure and, when that returns true, leaves the message to the
// page. Outside such a page a panel keeps showing its own error.

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';

const PageLoadFailureContext = createContext(
    /** @type {null | ((label: string, failed: boolean) => void)} */ (null),
);

/**
 * "a", "a and b", "a, b and c".
 *
 * @param {string[]} items
 * @returns {string}
 */
export function andList(items) {
    if (items.length <= 1) return items.join('');
    return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Collects the failures its panels report.
 *
 * @returns {{ failed: string[], report: (label: string, failed: boolean) => void }}
 *   `failed` lists the reported labels in the order they were first reported;
 *   `report` records a failure the page itself found.
 */
export function usePageLoadFailures() {
    const [labels, setLabels] = useState(/** @type {string[]} */ ([]));
    const report = useCallback((label, failed) => {
        setLabels((current) => {
            const has = current.includes(label);
            if (failed === has) return current;
            return failed ? [...current, label] : current.filter((entry) => entry !== label);
        });
    }, []);
    return useMemo(() => ({ failed: labels, report }), [labels, report]);
}

/** Wraps the panels whose failures the page reports once. */
export function PageLoadFailureScope({ report, children }) {
    return <PageLoadFailureContext.Provider value={report}>{children}</PageLoadFailureContext.Provider>;
}

/**
 * Reports a panel's load failure to the page that holds it.
 *
 * @param {string} label    what could not load, as it reads after "Couldn't load"
 * @param {boolean} failed
 * @returns {boolean} true when a page takes the message, so the panel stays quiet
 */
export function useReportLoadFailure(label, failed) {
    const report = useContext(PageLoadFailureContext);
    useLayoutEffect(() => {
        if (!report || !failed) return undefined;
        report(label, true);
        return () => report(label, false);
    }, [report, label, failed]);
    return Boolean(report);
}
