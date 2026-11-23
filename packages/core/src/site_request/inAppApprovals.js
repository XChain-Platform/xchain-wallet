// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { randomUUID } from '../util/uuid.js';
import { createApprovalParking } from './approvalParking.js';

const APPROVAL_KINDS = [
    'connect',
    'signAction',
    'signMessage',
    'signPsbt',
    'coSign',
    'signIn',
];

export function createInAppApprovals({
    newId = randomUUID,
    timeoutMs,
    setTimer,
    clearTimer,
} = {}) {
    const parkingOptions = { newId };
    if (timeoutMs !== undefined) parkingOptions.timeoutMs = timeoutMs;
    if (setTimer !== undefined) parkingOptions.setTimer = setTimer;
    if (clearTimer !== undefined) parkingOptions.clearTimer = clearTimer;

    const parking = createApprovalParking(parkingOptions);
    const approvals = {
        fetch: (id) => parking.fetch(id),
        resolve: (id, result) => parking.resolve(id, result),
        list: () => parking.list(),
        listPending: (kind) => parking.list().filter((entry) => entry.kind === kind),
        cancelAll: () => parking.cancelAll(),
        cancelOriginsMatching: (matches) => parking.cancelOriginsMatching(matches),
        subscribe: (listener) => parking.subscribe(listener),
    };

    for (const kind of APPROVAL_KINDS) {
        approvals[kind] = (payload) => parking.park(kind, payload);
    }

    return approvals;
}
