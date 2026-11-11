// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The live protocol-fee quote behind a form's Fees card, before review.
//
// A form hands over either a finished action string (priced through
// `requoteNativeFee`) or the `{ action, params }` it will compose at review
// (priced through `quoteProtocolFee`, which builds the action string host-side
// with the same SDK builder compose uses). The answer is display only: the
// review step composes and re-quotes for real, so nothing here reaches a
// signed transaction.

import { useEffect, useRef, useState } from 'react';

const QUOTE_DEBOUNCE_MS = 400;

export function useProtocolFeeQuote({
    messaging,
    chainId,
    source,
    actionString,
    actionData,
    enabled = true,
} = {}) {
    // A caller that passes `actionData` (even null while its inputs are
    // incomplete) quotes by action and params; everyone else by string.
    const byActionData = !actionString && actionData !== undefined;
    const transport = byActionData ? messaging?.quoteProtocolFee : messaging?.requoteNativeFee;
    const hasQuoteTransport = typeof transport === 'function';
    const actionKey = byActionData ? actionDataKey(actionData) : (actionString || null);
    const hasQuoteInputs = Boolean(chainId && source && actionKey);
    const canQuote = enabled === true && hasQuoteTransport && hasQuoteInputs;
    const waitingForInputs = enabled === true && hasQuoteTransport && !hasQuoteInputs;
    const [state, setState] = useState(() => ({
        quote: null,
        pending: canQuote || waitingForInputs,
    }));
    // The effect is keyed on the params' content, so a form that rebuilds an
    // equal object on every render does not requote; the ref hands the effect
    // the object that key was computed from.
    const actionDataRef = useRef(actionData);
    actionDataRef.current = actionData;

    useEffect(() => {
        let active = true;
        if (!canQuote) {
            setState({ quote: null, pending: waitingForInputs });
            return () => { active = false; };
        }

        setState({ quote: null, pending: true });
        const timer = setTimeout(() => {
            const request = byActionData
                ? messaging.quoteProtocolFee({ chainId, source, actionData: actionDataRef.current })
                : messaging.requoteNativeFee({ chainId, source, actionString: actionKey });
            Promise.resolve(request)
                .then((quote) => {
                    if (active) setState({ quote: quote || null, pending: false });
                })
                .catch(() => {
                    if (active) setState({ quote: null, pending: false });
                });
        }, QUOTE_DEBOUNCE_MS);

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [actionKey, byActionData, canQuote, chainId, messaging, source, waitingForInputs]);

    return state;
}

// A content key for `{ action, params }`: object keys sorted at every depth so
// two equal param maps built in a different order share one quote.
function actionDataKey(actionData) {
    if (!actionData || typeof actionData !== 'object') return null;
    const action = typeof actionData.action === 'string' ? actionData.action.trim() : '';
    if (!action) return null;
    try {
        return JSON.stringify(sortKeys(actionData));
    } catch {
        return null;
    }
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const key of Object.keys(value).sort()) {
        if (value[key] !== undefined) out[key] = sortKeys(value[key]);
    }
    return out;
}
