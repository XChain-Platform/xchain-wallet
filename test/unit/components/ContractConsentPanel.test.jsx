// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md.

// PC-39: the consent panel's three trust states.
//
// The load-bearing rule under test is that a manifest the wallet could
// NOT look up never renders as an assurance, and never borrows the copy
// of a contract that genuinely declared no limits. Those two cases used
// to share one `permissions: null` shape; `status` splits them.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ContractConsentPanel } from '../../../packages/core/src/shared/components/ContractConsentPanel.jsx';

function renderPanel(manifest) {
    return render(
        <dl>
            <ContractConsentPanel
                manifest={manifest}
                labelClassName="lbl"
                valueClassName="val"
            />
        </dl>,
    );
}

describe('<ContractConsentPanel>', () => {
    it('lists plain-language verbs and the fee cap for a declared manifest', () => {
        const { container } = renderPanel({
            permissions: ['SEND', 'ISSUE'],
            maxTakeBps: 250,
            status: 'declared',
        });
        const text = container.textContent;
        expect(text).toContain('It can send your tokens.');
        expect(text).toContain('It can issue tokens.');
        expect(text).toContain('2.5%');
        expect(text).toContain('Reported by the XChain index');
    });

    it('says the contract can do nothing for an empty declared allowlist', () => {
        const { container } = renderPanel({
            permissions: [],
            maxTakeBps: null,
            status: 'declared',
        });
        expect(container.textContent).toContain('can take no actions on your behalf');
    });

    it('falls back to the network fee limit when the contract declared no cap', () => {
        const { container } = renderPanel({
            permissions: ['SEND'],
            maxTakeBps: null,
            status: 'declared',
        });
        expect(container.textContent).toContain('the network limit applies');
    });

    it('states an undeclared allowlist as unrestricted, not as a missing field', () => {
        const { container } = renderPanel({
            permissions: null,
            maxTakeBps: null,
            status: 'unrestricted',
        });
        const text = container.textContent;
        expect(text).toContain('Anything.');
        expect(text).toContain('any action the protocol allows');
        // Still an answered state, so it carries the provenance caveat.
        expect(text).toContain('Reported by the XChain index');
    });

    it('says the lookup failed - and offers no assurance - when unavailable', () => {
        const { container } = renderPanel({
            permissions: null,
            maxTakeBps: null,
            status: 'unavailable',
        });
        const text = container.textContent;
        expect(text).toContain("couldn’t look up");
        // The unrestricted copy would be a claim the wallet cannot make here.
        expect(text).not.toContain('Anything.');
        // No fee row either: "no limit of its own" would be equally unfounded.
        expect(text).not.toContain('Max fee it can take');
    });

    it('treats a status-less legacy manifest with null permissions as unavailable', () => {
        const { container } = renderPanel({ permissions: null, maxTakeBps: null });
        expect(container.textContent).toContain("couldn’t look up");
    });

    it('treats a missing manifest as unavailable', () => {
        const { container } = renderPanel(null);
        expect(container.textContent).toContain("couldn’t look up");
    });
});
