// @vitest-environment node
// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createInAppApprovals } from '../../../packages/core/src/site_request/inAppApprovals.js';

function approvalsWithIds(...ids) {
    return createInAppApprovals({
        newId: () => ids.shift(),
        setTimer: () => 1,
        clearTimer: () => {},
    });
}

describe('createInAppApprovals', () => {
    it('parks every approval kind until the matching decision resolves it', async () => {
        const kinds = ['connect', 'signAction', 'signMessage', 'signPsbt', 'coSign', 'signIn'];
        const approvals = approvalsWithIds(...kinds.map((kind) => `${kind}-id`));

        for (const kind of kinds) {
            const payload = { origin: `https://${kind}.test` };
            const pending = approvals[kind](payload);
            const id = `${kind}-id`;

            expect(approvals.fetch(id)).toEqual({ id, kind, payload });
            expect(approvals.listPending(kind)).toEqual([{ id, kind, payload }]);
            expect(approvals.resolve(id, { approved: false })).toBe(true);
            await expect(pending).resolves.toEqual({ approved: false });
        }

        expect(approvals.list()).toEqual([]);
    });

    it('cannot reach a signer before the parked approval is explicitly resolved', async () => {
        const approvals = approvalsWithIds('sign-request');
        const signer = vi.fn(async () => 'signed');
        const signing = (async () => {
            const decision = await approvals.signMessage({
                origin: 'https://requester.test',
                payload: { message: 'review me' },
            });
            if (!decision.approved) return 'rejected';
            return signer();
        })();

        await Promise.resolve();
        expect(signer).not.toHaveBeenCalled();

        expect(approvals.resolve('unknown', { approved: true })).toBe(false);
        await Promise.resolve();
        expect(signer).not.toHaveBeenCalled();

        expect(approvals.resolve('sign-request', { approved: true })).toBe(true);
        await expect(signing).resolves.toBe('signed');
        expect(signer).toHaveBeenCalledOnce();
    });
});
