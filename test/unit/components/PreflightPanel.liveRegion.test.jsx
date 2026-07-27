// Copyright © 2025–2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// PreflightPanel live-region announcement contract ( §5.2.4).
//
// This is the automatable half of §8.6's "manual screen-reader pass". What a
// screen reader actually SPEAKS still needs a human with NVDA or VoiceOver;
// what can be pinned here is the DOM contract that decides whether it speaks
// at all, which is where the defect was.
//
// The bug: a screen reader registers a live region's politeness when it first
// observes the node and does not reliably honour an aria-live value changed in
// place. Every branch of PreflightPanel renders a div at the same position
// with no key, so React reconciles them to the SAME node - so a pass -> fail
// transition flipped the attribute on a node the AT had already registered as
// polite, and the interrupt never happened.
//
// axe-core is green on this component and always was: it audits static
// violations, not announcement dynamics.

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

const FAIL_FINDING = {
    code: 'DRYRUN_INVALID',
    severity: 'error',
    message: 'The network reports this will fail: insufficient funds',
    source: 'dryrun',
    overridable: true,
};

const panel = () => screen.getByTestId('preflight-panel');

describe('PreflightPanel live region (§5.2.4)', () => {

    it('is polite for a passing verdict', () => {
        render(<PreflightPanel report={reportWith('pass')} acknowledged={new Set()} onAcknowledge={() => {}} />);
        expect(panel().getAttribute('aria-live')).toBe('polite');
    });

    it('is assertive for a failing verdict', () => {
        render(<PreflightPanel report={reportWith('fail', [FAIL_FINDING])} acknowledged={new Set()} onAcknowledge={() => {}} />);
        expect(panel().getAttribute('aria-live')).toBe('assertive');
    });

    // THE regression. Attribute value alone is not the contract: the node has
    // to be one the AT has not already registered at the weaker level.
    it('REMOUNTS the region when politeness changes, so the AT re-registers it', () => {
        const { rerender } = render(
            <PreflightPanel report={reportWith('pass')} acknowledged={new Set()} onAcknowledge={() => {}} />,
        );
        const before = panel();
        expect(before.getAttribute('aria-live')).toBe('polite');

        rerender(<PreflightPanel report={reportWith('fail', [FAIL_FINDING])} acknowledged={new Set()} onAcknowledge={() => {}} />);
        const after = panel();

        expect(after.getAttribute('aria-live')).toBe('assertive');
        // Different DOM node, not the same one with a mutated attribute.
        expect(after).not.toBe(before);
    });

    // The other half of the same rule: ordinary updates that do NOT change the
    // level must keep the node, or every content change would re-register the
    // region and behave like a fresh announcement.
    it('KEEPS the node when the verdict changes without changing politeness', () => {
        const { rerender } = render(
            <PreflightPanel report={reportWith('pass')} acknowledged={new Set()} onAcknowledge={() => {}} />,
        );
        const before = panel();

        rerender(<PreflightPanel report={reportWith('warn')} acknowledged={new Set()} onAcknowledge={() => {}} />);
        const after = panel();

        expect(after.getAttribute('aria-live')).toBe('polite');
        expect(after).toBe(before);
    });

    it('re-registers again on the way BACK down from fail', () => {
        const { rerender } = render(
            <PreflightPanel report={reportWith('fail', [FAIL_FINDING])} acknowledged={new Set()} onAcknowledge={() => {}} />,
        );
        const failing = panel();
        rerender(<PreflightPanel report={reportWith('pass')} acknowledged={new Set()} onAcknowledge={() => {}} />);
        const passing = panel();

        expect(passing.getAttribute('aria-live')).toBe('polite');
        expect(passing).not.toBe(failing);
    });
});
