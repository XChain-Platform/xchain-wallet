// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useRef, useState } from 'react';
import { multipartFieldReasons } from '../../flows/multipartFieldReasons.js';
import { multipartMethodSummaries } from '../../flows/multipartMethodOptions.js';
import { previewMultipartQuotes } from '../../flows/multipartQuotePreview.js';

function previewGate(gated, gate) {
    if (!gated) return null;
    return {
        ticker: gate?.ticker,
        minAmount: gate?.minAmount,
        key: new Uint8Array(32),
        iv: new Uint8Array(12),
    };
}

function previewOptions(result) {
    const summaries = multipartMethodSummaries(result.quotes);
    const fields = multipartFieldReasons(result);
    return Object.fromEntries(['taproot', 'standard'].map((method) => [method, {
        ...summaries[method],
        reason: fields.reasons[method],
        cap: fields.caps[method],
        single: fields.single[method],
    }]));
}

function unavailableRateError() {
    const error = new Error('Multipart quote fee rate is unavailable.');
    error.code = 'MULTIPART_QUOTE_RATE_UNAVAILABLE';
    return error;
}

export function useMultipartQuotePreview({
    bytes,
    size = null,
    meta,
    gated = false,
    gate = null,
    rate,
    methods,
    lanes,
    sizes,
    preview = previewMultipartQuotes,
}) {
    const [state, setState] = useState({ loading: false, options: null, error: null });
    const contextRef = useRef(null);
    contextRef.current = { bytes, size, meta, gated, gate, rate, methods, lanes, sizes, preview };
    const methodsKey = Array.isArray(methods) ? methods.join(',') : '';

    useEffect(() => {
        let active = true;
        const context = contextRef.current;
        // A large file is held by reference: its size alone prices it.
        const hasBytes = context.bytes != null && context.bytes.length > 0;
        const hasSize = Number.isSafeInteger(context.size) && context.size > 0;
        if ((!hasBytes && !hasSize) || context.methods.length === 0) {
            setState({ loading: false, options: null, error: null });
            return () => { active = false; };
        }
        if (context.rate === undefined) {
            setState({ loading: true, options: null, error: null });
            return () => { active = false; };
        }
        if (context.rate === null) {
            setState({ loading: false, options: null, error: unavailableRateError() });
            return () => { active = false; };
        }
        setState({ loading: true, options: null, error: null });
        let pending;
        try {
            pending = context.preview({
                bytes: hasBytes ? context.bytes : null,
                size: hasBytes ? context.bytes.length : context.size,
                meta: context.meta,
                gate: previewGate(context.gated, context.gate),
                rate: context.rate,
                methods: context.methods,
                lanes: context.lanes,
                sizes: context.sizes,
            });
        } catch (error) {
            if (active) setState({ loading: false, options: null, error });
            return () => { active = false; };
        }
        Promise.resolve(pending).then(
            (result) => {
                if (!active) return;
                try {
                    setState({ loading: false, options: previewOptions(result), error: null });
                } catch (error) {
                    setState({ loading: false, options: null, error });
                }
            },
            (error) => {
                if (active) setState({ loading: false, options: null, error });
            },
        );
        return () => { active = false; };
    }, [bytes, size, gated, methodsKey, rate]);

    return state;
}
