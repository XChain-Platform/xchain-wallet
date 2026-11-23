// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { connectedSiteErrorMessage } from '../../../packages/core/src/shared/components/settings/ConnectedSitesSection.jsx';

describe('Connected Sites error copy', () => {
    it('filters internal handler text for the load and every action', () => {
        const actions = ['load', 'disconnect', 'block', 'unblock'];
        for (const action of actions) {
            const message = connectedSiteErrorMessage(new Error(`sites.${action}: internal failure`), action);
            expect(message).not.toMatch(/sites\.|internal failure/);
            expect(message).toMatch(/Try again/);
        }
    });

    it('names the local save as the shared cause of action failures', () => {
        for (const action of ['disconnect', 'block', 'unblock']) {
            expect(connectedSiteErrorMessage(new Error('x'), action))
                .toBe("Couldn't save this change on this device. Try again.");
        }
    });

    // Keep a refused action as a notice above usable content so the failure
    // cannot replace a loaded list that still reflects the wallet state.
    it('keeps action failures in the page notice instead of replacing the loaded page', () => {
        const relative = 'packages/core/src/shared/components/settings/ConnectedSitesSection.jsx';
        const direct = resolve(process.cwd(), relative);
        const source = readFileSync(existsSync(direct) ? direct : resolve(process.cwd(), 'xchain-wallet', relative), 'utf8');
        expect(source.match(/setError\(connectedSiteErrorMessage\(err, 'load'\)\)/g)).toHaveLength(1);
        for (const action of ['disconnect', 'block', 'unblock']) {
            expect(source).toContain(`setActionError(connectedSiteErrorMessage(null, '${action}'))`);
        }
        expect(source).not.toMatch(/setError\(err instanceof Error/);
    });
});
