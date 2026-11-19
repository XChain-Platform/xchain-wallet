// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';
import { prepareArtworkLink } from '../../flows/multipartArtworkLinkPrep.js';
import { multipartLinkMessage } from '../utils/multipartLinkMessage.js';

function noticeFor(reason) {
    return multipartLinkMessage(reason) ?? { reason, message: null, retryable: false };
}

function useRunGuard() {
    const mountedRef = useRef(true);
    const generationRef = useRef(0);
    const runningRef = useRef(null);
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            generationRef.current += 1;
        };
    }, []);
    return { mountedRef, generationRef, runningRef };
}

export function useMultipartArtworkLink({
    explorer,
    tick,
    coinTicker,
    maxAttempts,
    waitMs,
    sleep,
    prepare = prepareArtworkLink,
}) {
    const [checking, setChecking] = useState(false);
    const [fields, setFields] = useState(null);
    const [notice, setNotice] = useState(null);
    const [error, setError] = useState(null);
    const { mountedRef, generationRef, runningRef } = useRunGuard();

    const reset = useCallback(() => {
        generationRef.current += 1;
        setFields(null);
        setNotice(null);
        setError(null);
    }, []);

    const check = useCallback(async ({ txid, linkTarget }) => {
        if (runningRef.current) return null;
        const generation = generationRef.current;
        const run = {};
        runningRef.current = run;
        setChecking(true);
        setFields(null);
        setNotice(null);
        setError(null);
        const current = () => mountedRef.current && generationRef.current === generation;
        try {
            const result = await prepare({
                explorer, txid, linkTarget, tick, coinTicker, maxAttempts, waitMs, sleep,
            });
            if (current()) {
                setFields(result.ok ? result.fields : null);
                setNotice(result.ok ? null : noticeFor(result.reason));
            }
            return result;
        } catch (cause) {
            if (current()) {
                setFields(null);
                setNotice(null);
                setError(cause);
            }
            return null;
        } finally {
            if (runningRef.current === run) runningRef.current = null;
            if (mountedRef.current) setChecking(false);
        }
    }, [coinTicker, explorer, maxAttempts, prepare, sleep, tick, waitMs]);

    return { check, checking, fields, notice, error, reset };
}
