// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// leg (a): a transaction that was signed but never broadcast must not render as a
// completed action.
//
// useConfirmAction deliberately ends a TRANSIENT post-sign broadcast failure in its own
// `signed-not-broadcast` phase and RESOLVES with `{ queued: true, broadcast: 'queued' }`, so the
// caller does not render an error: the signed tx is in the §49.5 rebroadcast queue and can still
// confirm. Every form that owns its own done screen then read only `result.txid` and, finding
// none, fell through to "Broadcast complete." - which is precisely the queued case. Confirmed
// live on DividendForm (campaign D-99): a user whose node was briefly unreachable was told the
// dividend had been sent.
//
// The invariant is structural: if a form's done screen keys on `result?.txid` AND its submit
// goes through the confirm pipeline (the only producer of a `queued` result), it must branch on
// `result?.queued` first. Derived from the tree rather than a list, so a new form is covered the
// day it is written. Against the commit before the sweep only Send.jsx passes.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHARED = join(HERE, '..', '..', '..', 'packages', 'core', 'src', 'shared');

// The confirm pipeline: useConfirmAction directly, or one of the two wrappers over it.
const USES_CONFIRM = /useConfirmAction|useActionConfirmFlow|useConfirmSubmit/;
// A done screen that reports a broadcast by its txid.
const TXID_DONE_SCREEN = /const txid = result\?\.txid/;

function confirmDoneScreens() {
    const out = [];
    for (const dir of ['components', 'routes']) {
        for (const file of readdirSync(join(SHARED, dir))) {
            if (!file.endsWith('.jsx')) continue;
            const rel = `${dir}/${file}`;
            const src = readFileSync(join(SHARED, rel), 'utf8');
            if (TXID_DONE_SCREEN.test(src) && USES_CONFIRM.test(src)) out.push({ rel, src });
        }
    }
    return out;
}

describe('A signed-but-not-broadcast result never renders as done', () => {
    const forms = confirmDoneScreens();

    it('finds the confirm-pipeline done screens to check (guards against an empty sweep)', () => {
        expect(forms.length).toBeGreaterThan(20);
    });

    for (const { rel, src } of forms) {
        it(`${rel} tells a queued result apart from a broadcast one`, () => {
            expect(/result\?\.queued/.test(src),
                `${rel}: the done screen reads only result.txid, so a TRANSIENT broadcast failure `
                + '(which useConfirmAction RESOLVES as { queued: true }) renders as a completed '
                + 'action. Branch on result?.queued and render QueuedResultPanel.').toBe(true);
        });
    }

    // The queued branch has to come BEFORE the success render, or it never runs: nothing
    // between the done screen's txid and the queued check may claim the action happened.
    // (A watcher-mode PSBT branch may sit in between - it renders no such claim.)
    const CLAIMS_SUCCESS = /successTitle|Broadcast complete|Order placed/;
    for (const { rel, src } of forms) {
        if (!/result\?\.queued/.test(src)) continue;
        it(`${rel} checks queued before rendering the success copy`, () => {
            const txidAt = src.search(TXID_DONE_SCREEN);
            const queuedAt = src.indexOf('result?.queued', txidAt);
            expect(queuedAt).toBeGreaterThan(txidAt);
            expect(CLAIMS_SUCCESS.test(src.slice(txidAt, queuedAt)),
                `${rel}: a success claim renders before the queued check, so the queued branch `
                + 'is unreachable for the case it exists to handle.').toBe(false);
        });
    }
});

describe('submitFailureMessage says what actually happened', () => {
    it('turns a native-fee refusal into the actionable sentence, not the wire string', async () => {
        const { submitFailureMessage } =
            await import('../../../packages/core/src/shared/utils/submitFailureMessage.js');
        const { NativeFeeForfeitError } =
            await import('../../../packages/core/src/sdk/nativeFeePreflight.js');
        const wire = new NativeFeeForfeitError({
            reason: 'dust', quote: { requiredFeeNative: '0.00002000' },
        });
        // As it arrives across the messaging boundary: name + message only.
        const crossed = { name: wire.name, message: wire.message };

        const msg = submitFailureMessage(crossed, {
            coinTicker: 'LTC', mandatory: true, fallback: 'Issue failed.',
        });
        expect(msg).not.toContain('pre-flight failed');
        expect(msg).toContain('0.00002000 LTC');
        expect(msg).toContain('cannot be submitted here');
    });

    // The legacy sign path still THROWS a transient broadcast failure (only the confirm
    // pipeline converts it to a resolved `queued` result), and "Mint failed." is not what
    // happened: a signed copy exists and the user must not submit a second one.
    it('turns a transient post-sign broadcast failure into "signed, queued"', async () => {
        const { submitFailureMessage, SIGNED_NOT_BROADCAST_MESSAGE } =
            await import('../../../packages/core/src/shared/utils/submitFailureMessage.js');
        const { BROADCAST_FAILED_TRANSIENT_NAME } =
            await import('../../../packages/core/src/flows/broadcastPermanence.js');

        const err = { name: BROADCAST_FAILED_TRANSIENT_NAME, message: 'ECONNREFUSED' };
        const msg = submitFailureMessage(err, { coinTicker: 'BTC', fallback: 'Mint failed.' });
        expect(msg).toBe(SIGNED_NOT_BROADCAST_MESSAGE);
        expect(msg).toMatch(/signed/i);
        expect(msg).toMatch(/queued/i);
        expect(msg).toMatch(/not submit this again/i);
    });

    // A PERMANENT failure is the opposite case: nothing is queued, the user must re-compose,
    // so it must NOT be dressed up as "queued".
    it('leaves a permanent broadcast failure on the form\'s own copy', async () => {
        const { submitFailureMessage, SIGNED_NOT_BROADCAST_MESSAGE } =
            await import('../../../packages/core/src/shared/utils/submitFailureMessage.js');
        const { BROADCAST_FAILED_PERMANENT_NAME } =
            await import('../../../packages/core/src/flows/broadcastPermanence.js');

        const err = { name: BROADCAST_FAILED_PERMANENT_NAME, message: 'bad-txns-inputs-missingorspent' };
        const msg = submitFailureMessage(err, { fallback: "Couldn't mint. The network rejected this transaction." });
        expect(msg).not.toBe(SIGNED_NOT_BROADCAST_MESSAGE);
        expect(msg).toBe("Couldn't mint. The network rejected this transaction.");
    });

    it('passes everything else through to the caller\'s own copy', async () => {
        const { submitFailureMessage } =
            await import('../../../packages/core/src/shared/utils/submitFailureMessage.js');
        expect(submitFailureMessage(new Error('boom'), { fallback: 'Sweep failed.' }))
            .toBe('Sweep failed.');
        // With no fallback it still says something concrete rather than an empty string.
        expect(submitFailureMessage(new Error('boom'))).toBe('boom');
        expect(submitFailureMessage(null)).toBe('Something went wrong.');
    });
});
