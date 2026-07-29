// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PreflightPanel Tier-1 notice contract (; spec §4.2 "which party said
// what", §5.2.4 panel).
//
// The defect: `PreflightPanel` rendered only `error` and `warning` findings
// plus the unverified list, and the SDK emits `DRYRUN_UNAVAILABLE` at severity
// `info` - so a report whose dry-run TIMED OUT rendered nothing at all about
// the network and fell back to the same "Looks good" chip a real network
// approval produces. Two materially different states, one pixel-identical
// screen, and the lie runs in the unsafe direction: the user is told the
// network is happy about an action the network never saw.
//
// Found by the  drive on the devhost regtest venue, where a cold
// dry-run costs 1.2s-5.0s and the SDK budget is 4000ms
// (xchain-sdk/src/preflight/constants.js DEFAULT_TIMEOUT_MS). The missing
// verdict read as a wallet defect to an experienced reader and cost most of
// that session, which is the strongest evidence the surface was wrong.
//
// The report fixtures below are the SHAPES the SDK actually produces; the
// `unreachedReport` findings array was captured from a live `sdk.preflight`
// run against a mock explorer whose `getFeeQuote` never resolves.
//
// NOT covered here, deliberately: reports with no Tier-1 finding at ALL
// (`local` mode, the DEPLOY/EXECUTE/XEXEC/BATCH denylist, `feeExempt`
// responses like DISPENSE). Those are spec §4.3 cases where Tier 1 was never
// asked rather than asked-and-silent; the panel exposes them as
// `data-dryrun="none"` if that ever needs its own copy.

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PreflightPanel } from '../../../packages/core/src/shared/components/PreflightPanel.jsx';

afterEach(cleanup);

const reportWith = (verdict, findings = []) => ({
    schemaVersion: 1,
    verdict,
    restricted: false,
    checksRun: [],
    findings,
    unverified: [],
    quote: null,
    stateHeight: 100,
    elapsedMs: 5,
});

// Exactly what applyTier1 pushes when runTier1 returns { kind: 'unavailable' }.
const DRYRUN_UNAVAILABLE_FINDING = {
    code: 'DRYRUN_UNAVAILABLE',
    severity: 'info',
    source: 'dryrun',
    message: 'The network dry-run was unavailable (tier1 timeout after 4000ms); relying on client checks.',
    data: {},
};

// ...and what it pushes on a genuine network approval.
const DRYRUN_VALID_FINDING = {
    code: 'DRYRUN_VALID',
    severity: 'info',
    source: 'dryrun',
    message: 'The network dry-run accepted this action.',
    data: {},
};

const mount = (report) =>
    render(<PreflightPanel report={report} acknowledged={new Set()} onAcknowledge={() => {}} />);

const panel = () => screen.getByTestId('preflight-panel');
const chip = () => screen.getByTestId('preflight-chip');

describe('PreflightPanel Tier-1 notice (§4.2, )', () => {

    // THE regression. One assertion, and it is the whole item.
    it('does NOT call an unreached network "Looks good"', () => {
        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(chip().textContent).not.toContain('Looks good');
    });

    it('says on the surface that the network was not reached', () => {
        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        const notice = screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE');
        expect(notice.textContent).toMatch(/not reached/i);
        // And it says what the absence MEANS, since "unavailable" alone reads
        // as a shrug rather than as "this is not an approval".
        expect(notice.textContent).toMatch(/not a network approval/i);
    });

    // The reason is the half that cost the  session: "timeout after
    // 4000ms" is what tells a reader the venue was slow, not the wallet broken.
    it('keeps the SDK reason visible as the diagnostic detail', () => {
        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE').textContent)
            .toContain('timeout after 4000ms');
    });

    it('states the network verdict when the network DID answer', () => {
        mount(reportWith('pass', [DRYRUN_VALID_FINDING]));
        expect(chip().textContent).toBe('Looks good');
        expect(screen.getByTestId('preflight-notice-DRYRUN_VALID').textContent)
            .toMatch(/network checked this action/i);
    });

    // The property the item is really about: two different states must not
    // produce the same screen. Comparing whole rendered text pins it against
    // any future refactor that drops one of the two branches.
    it('renders visibly DIFFERENT text for approved vs never-answered', () => {
        const { unmount } = mount(reportWith('pass', [DRYRUN_VALID_FINDING]));
        const approvedText = panel().textContent;
        unmount();

        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(panel().textContent).not.toBe(approvedText);
    });

    it('exposes the Tier-1 state machine-readably for e2e', () => {
        const { unmount } = mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(panel().getAttribute('data-dryrun')).toBe('unreached');
        unmount();

        const second = mount(reportWith('pass', [DRYRUN_VALID_FINDING]));
        expect(panel().getAttribute('data-dryrun')).toBe('approved');
        second.unmount();

        mount(reportWith('pass', []));
        expect(panel().getAttribute('data-dryrun')).toBe('none');
    });

    // Tier-1 precedence demotes a contradicting Tier-2 ERROR to info and keeps
    // it for diagnostics (`_downgradedBy`). Those must stay unrendered: putting
    // "insufficient balance" under a chip that says the network accepted the
    // action would contradict the verdict on the same screen, and the SDK
    // demoted it precisely because the network outranks it.
    it('does not render findings Tier-1 precedence demoted to info', () => {
        mount(reportWith('pass', [
            DRYRUN_VALID_FINDING,
            {
                code: 'BALANCE_INSUFFICIENT',
                severity: 'info',
                source: 'client',
                message: 'Insufficient JDOG balance',
                _downgradedBy: 'dryrun-valid',
                data: {},
            },
        ]));
        expect(screen.queryByTestId('preflight-notice-BALANCE_INSUFFICIENT')).toBeNull();
        expect(panel().textContent).not.toContain('Insufficient JDOG balance');
    });

    // A warn or fail verdict already has a chip that demands attention, so the
    // chip keeps its wording; the notice still has to appear, because "warnings
    // AND nobody checked with the network" is strictly worse than "warnings".
    it('keeps the warn chip but still declares the unreached network', () => {
        mount(reportWith('warn', [
            DRYRUN_UNAVAILABLE_FINDING,
            { code: 'NATIVE_FEE_FORFEIT', severity: 'warning', source: 'client', message: 'Fee may be forfeited', data: {} },
        ]));
        expect(chip().textContent).toBe('Review warnings');
        expect(screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE')).toBeTruthy();
    });

    it('keeps the fail chip and its assertive live region when unreached', () => {
        mount(reportWith('fail', [
            DRYRUN_UNAVAILABLE_FINDING,
            { code: 'DEST_ADDRESS_INVALID', severity: 'error', source: 'client', overridable: false, message: 'Bad address', data: {} },
        ]));
        expect(chip().textContent).toBe('Will likely fail');
        expect(panel().getAttribute('aria-live')).toBe('assertive');
        expect(screen.getByTestId('preflight-notice-DRYRUN_UNAVAILABLE')).toBeTruthy();
        // A failing chip keeps the danger palette. The unreached style is
        // declared after the verdict styles, so an ungated class would win the
        // cascade and mute the loudest chip on the surface.
        expect(chip().className).not.toMatch(/chip_unreached/);
    });

    // Severity must never be carried by colour alone (§5.2.4). The unreached
    // state changes the WORDS in the chip, not just its palette.
    it('carries the unreached state in words, not only in styling', () => {
        mount(reportWith('pass', [DRYRUN_UNAVAILABLE_FINDING]));
        expect(chip().textContent.trim().length).toBeGreaterThan(0);
        expect(chip().textContent).toMatch(/local checks only/i);
        // The palette moves too, and the pass arm is the one that must: this is
        // the other side of the fail-chip assertion above.
        expect(chip().className).toMatch(/chip_unreached/);
    });
});
