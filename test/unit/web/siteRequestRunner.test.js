// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createSiteRequestRunner } from '../../../packages/web/src/approvalAdapter.js';
import { createInAppApprovals } from '../../../packages/core/src/site_request/inAppApprovals.js';

const RETURN = 'https://site.example/back';

function request(overrides = {}) {
    return {
        v: 1,
        id: 'req-1',
        method: 'login',
        params: { appId: 'app', nonce: 'n' },
        return: RETURN,
        callback: 'https://site.example/cb',
        app: { name: 'Site' },
        ...overrides,
    };
}

function harness(handler) {
    let n = 0;
    const approvals = createInAppApprovals({ newId: () => `p${(n += 1)}` });
    const calls = [];
    const send = vi.fn(async (type, body) => {
        calls.push({ type, body });
        if (type === 'settings.get') return { developerMode: false };
        return handler({ type, body, approvals, calls });
    });
    const navigate = vi.fn();
    const deliver = vi.fn(async (req, outcome) => ({
        browserReturn: { url: `${req.return}#xchain=${outcome.ok ? 'ok' : 'bad'}`, full: true },
    }));
    const runner = createSiteRequestRunner({ send, approvals, deliver, navigate });
    return { approvals, calls, send, navigate, deliver, runner };
}

describe('web site request runner', () => {
    it('turns chain ids in the request into coins', async () => {
        const h = harness(async () => ({ ok: 1 }));
        const chainRegistry = { descriptorFor: (id) => (id === 'bitcoin-regtest' ? { id, coin: 'bitcoin' } : null) };
        const runner = createSiteRequestRunner({ send: h.send, approvals: h.approvals, deliver: h.deliver, navigate: h.navigate, chainRegistry });
        await runner.run(request({ params: { appId: 'a', chains: ['bitcoin-regtest', 'dogecoin'] } })).completed;
        expect(h.calls.find((c) => c.type === 'bridge.login').body).toMatchObject({ chains: ['bitcoin', 'dogecoin'] });
    });

    it('parks the approval, runs the request on approve and navigates to return', async () => {
        const h = harness(async ({ approvals }) => {
            const decision = await approvals.signIn({ origin: 'https://site.example', kind: 'signIn' });
            if (!decision.approved) throw Object.assign(new Error('no'), { name: 'UserRejectedError' });
            return { proofs: ['p'] };
        });
        const seen = [];
        const done = vi.fn();
        const handle = h.runner.run(request(), { onApproval: (entry) => seen.push(entry), onDone: done });
        await vi.waitFor(() => expect(seen).toHaveLength(1));
        expect(seen[0]).toMatchObject({ id: 'p1', kind: 'signIn' });
        expect(h.calls.find((c) => c.type === 'bridge.login').body).toMatchObject({
            appId: 'app', origin: 'https://site.example', appName: 'Site',
        });

        expect(h.approvals.resolve('p1', { approved: true })).toBe(true);
        expect(await handle.completed).toBe('delivered');
        expect(h.deliver.mock.calls[0][1]).toEqual({ ok: true, result: { proofs: ['p'] } });
        expect(h.navigate).toHaveBeenCalledWith(`${RETURN}#xchain=ok`);
        expect(done).toHaveBeenCalledWith('delivered');
    });

    it('delivers without navigating when the request has no return', async () => {
        const h = harness(async ({ approvals }) => {
            await approvals.signIn({});
            return { ok: 1 };
        });
        const seen = [];
        const handle = h.runner.run(request({ return: undefined }), { onApproval: (entry) => seen.push(entry) });
        await vi.waitFor(() => expect(seen).toHaveLength(1));
        h.deliver.mockResolvedValueOnce({ browserReturn: null });
        h.approvals.resolve(seen[0].id, { approved: true });
        expect(await handle.completed).toBe('delivered');
        expect(h.navigate).not.toHaveBeenCalled();
        expect(h.calls.find((c) => c.type === 'bridge.login').body.origin).toBe('https://site.example');
    });

    it('does not follow a return outside https', async () => {
        const h = harness(async () => ({ ok: 1 }));
        h.deliver.mockResolvedValueOnce({ browserReturn: { url: 'javascript:alert(1)#xchain=a', full: true } });
        const handle = h.runner.run(request());
        expect(await handle.completed).toBe('delivered');
        expect(h.navigate).not.toHaveBeenCalled();
    });

    it('closes without delivering when the user rejects', async () => {
        const h = harness(async ({ approvals }) => {
            const decision = await approvals.signIn({});
            if (!decision.approved) throw Object.assign(new Error('no'), { name: 'UserRejectedError' });
            return {};
        });
        const seen = [];
        const done = vi.fn();
        const handle = h.runner.run(request(), { onApproval: (entry) => seen.push(entry), onDone: done });
        await vi.waitFor(() => expect(seen).toHaveLength(1));
        handle.cancel();
        expect(await handle.completed).toBe('cancelled');
        expect(h.deliver).not.toHaveBeenCalled();
        expect(h.navigate).not.toHaveBeenCalled();
        expect(done).toHaveBeenCalledOnce();
    });

    it('asks again after a wrong password and delivers the error after three tries', async () => {
        const h = harness(async ({ approvals }) => {
            await approvals.signIn({});
            throw Object.assign(new Error('bad'), { name: 'InvalidPasswordError' });
        });
        const seen = [];
        const handle = h.runner.run(request(), { onApproval: (entry) => seen.push(entry) });
        for (let i = 1; i <= 3; i += 1) {
            await vi.waitFor(() => expect(seen).toHaveLength(i));
            h.approvals.resolve(seen[i - 1].id, { approved: true, password: 'x' });
        }
        expect(await handle.completed).toBe('delivered');
        expect(h.deliver.mock.calls[0][1]).toEqual({ ok: false, error: 'InvalidPasswordError' });
    });

    it('finishes unsupported for a method the web shell does not run', async () => {
        const h = harness(async () => ({}));
        const done = vi.fn();
        const handle = h.runner.run(request({ method: 'signPsbt' }), { onDone: done });
        expect(await handle.completed).toBe('unsupported');
        expect(done).toHaveBeenCalledWith('unsupported');
        expect(h.deliver).not.toHaveBeenCalled();
    });
});
