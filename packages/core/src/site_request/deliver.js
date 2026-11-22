// Copyright (c) 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { callbackBodyFits, mintClaim } from './claim.js';
import { buildReturnUrl } from './returnFragment.js';
import { buildCallbackBody, sendCallback } from './callbackSend.js';

function responsePayload(request, outcome, claim) {
    const payload = {
        v: 1,
        id: request.id,
        method: request.method,
        ok: outcome.ok,
    };
    if (outcome.ok) payload.result = outcome.result;
    else payload.error = outcome.error;
    if (request.state !== undefined) payload.state = request.state;
    if (claim !== undefined) payload.claim = claim;
    return payload;
}

function callbackBody(request, outcome, claim, hasReturn) {
    return buildCallbackBody({
        id: request.id,
        method: request.method,
        ok: outcome.ok,
        result: outcome.result,
        error: outcome.error,
        state: request.state,
        claim,
    }, { hasReturn });
}

function resultTooLargeOutcome() {
    return { ok: false, error: 'RESULT_TOO_LARGE' };
}

export function prepareDelivery(
    request,
    outcome,
    { randomBytes, maxReturnLength } = {},
) {
    if (!request || typeof request !== 'object') {
        throw new TypeError('request must be an object');
    }
    if (!outcome || typeof outcome !== 'object' || typeof outcome.ok !== 'boolean') {
        throw new TypeError('outcome.ok must be a boolean');
    }

    const hasReturn = typeof request.return === 'string';
    const hasCallback = typeof request.callback === 'string';
    if (!hasReturn && !hasCallback) {
        throw new TypeError('request must have a return or callback target');
    }

    const claim = hasReturn ? mintClaim(randomBytes) : undefined;
    let deliveredOutcome = outcome;
    let body = hasCallback
        ? callbackBody(request, deliveredOutcome, claim, hasReturn)
        : null;
    let resultTooLarge = body !== null && !callbackBodyFits(body);

    if (resultTooLarge) {
        deliveredOutcome = resultTooLargeOutcome();
        body = callbackBody(request, deliveredOutcome, claim, hasReturn);
    }

    let payload = responsePayload(request, deliveredOutcome, claim);
    let browserReturn = hasReturn
        ? buildReturnUrl(request.return, payload, maxReturnLength === undefined
            ? undefined
            : { maxLength: maxReturnLength })
        : null;

    if (browserReturn && !browserReturn.full && !hasCallback) {
        resultTooLarge = true;
        deliveredOutcome = resultTooLargeOutcome();
        payload = responsePayload(request, deliveredOutcome, claim);
        browserReturn = buildReturnUrl(
            request.return,
            payload,
            maxReturnLength === undefined ? undefined : { maxLength: maxReturnLength },
        );
    }

    return {
        claim,
        payload,
        callback: hasCallback ? { url: request.callback, body } : null,
        browserReturn,
        resultTooLarge,
    };
}

export async function sendDeliveryCallback(
    prepared,
    { developerMode = false, tor = false, resolve, post } = {},
) {
    if (!prepared?.callback) return null;

    return sendCallback({
        url: prepared.callback.url,
        body: prepared.callback.body,
        developerMode,
        tor,
        resolve,
        post,
    });
}

export async function deliverResult(request, outcome, options = {}) {
    const prepared = prepareDelivery(request, outcome, options);
    const callbackResult = await sendDeliveryCallback(prepared, options);
    return { ...prepared, callbackResult };
}
