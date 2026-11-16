// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useMemo } from 'react';
import { multipartFieldOptions } from '../../flows/multipartFieldOptions.js';
import { multipartSupportForMethod } from '../../flows/multipartMethodSupport.js';
import { useMultipartQuotePreview } from './useMultipartQuotePreview.js';

const METHODS = ['taproot', 'standard'];

function supportFor(input) {
    try {
        const support = Object.fromEntries(METHODS.map((method) => [
            method,
            multipartSupportForMethod({ method, ...input }),
        ]));
        return { support, error: null };
    } catch (error) {
        return { support: null, error };
    }
}

function plannedMethods(singleReasons, singleFits, support) {
    if (support === null) return [];
    return METHODS.filter((method) => singleFits?.[method] === false
        && (singleReasons?.[method] === null || singleReasons?.[method] === 'tooLarge')
        && support[method].supported);
}

function fieldState(input, supportError, previewState) {
    if (supportError) {
        return { options: null, reasons: null, ready: false, error: supportError };
    }
    try {
        const result = multipartFieldOptions({ ...input, quoteOptions: previewState.options });
        return {
            ...result,
            ready: previewState.error ? false : result.ready,
            error: previewState.error,
        };
    } catch (error) {
        return { options: null, reasons: null, ready: false, error };
    }
}

export function useMultipartUploadMethod({
    bytes, meta, gated = false, gate = null, rate,
    descriptor, addressRecord, addressType, isWatcherMode = false,
    singleReasons, singleFits, lanes, sizes, preview,
}) {
    const supportState = useMemo(() => supportFor({
        descriptor, addressRecord, addressType, isWatcherMode,
    }), [descriptor, addressRecord, addressType, isWatcherMode]);
    const methods = useMemo(() => plannedMethods(
        singleReasons, singleFits, supportState.support,
    ), [singleReasons, singleFits, supportState]);
    const previewState = useMultipartQuotePreview({
        bytes, meta, gated, gate, rate, methods, lanes, sizes, preview,
    });
    const state = fieldState({
        singleReasons, singleFits, support: supportState.support,
    }, supportState.error, previewState);
    return { ...state, loading: previewState.loading };
}
