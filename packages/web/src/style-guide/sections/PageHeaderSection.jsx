// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { PageHeader, Icon } from '@xchain-wallet/core/ui';
import { AppHeader } from '@xchain-wallet/core/shared/components/AppHeader.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

// The frame mimics the app shell: an AppHeader bar on top, then the
// Page header in the same padding context a routed Screen gives it
// (Screen.module.css `.header` pads space-3 / space-4). Stacking them
// is the only way to eyeball that the chevron lines up under the logo
// and the trailing action lines up under the AppHeader buttons.
const frame = {
    border: '1px solid var(--xc-border)',
    borderRadius: 'var(--xc-radius-md)',
    overflow: 'hidden',
    background: 'var(--xc-surface)',
};
const headerSlot = {
    padding: 'var(--xc-space-3) var(--xc-space-4)',
    background: 'var(--xc-surface-raised)',
    borderTop: '1px solid var(--xc-border)',
};
// The circular footprint comes from PageHeader.module.css `.trailing
// button`; the caller passes a plain button with just the icon + label.

export function PageHeaderSection() {
    const noop = () => {};
    return (
        <Section
            id="page-header"
            title="Page header"
            tag="CANONICAL secondary toolbar"
            kicker="Sits directly below the App header on every drilled-in screen: back chevron (left), centered text title, optional trailing actions (right). Its edges align with the App header above it."
        >
            <Guidance
                what={<>A three-column layout: leading slot (back chevron or spacer), centered title (text only), trailing slot (filter / scan / etc., or spacer). The back chevron renders in <code>--xc-accent-primary</code>.</>}
                when={<>Every routed screen below the global App header. Always use <code>&lt;PageHeader /&gt;</code> from <code>@xchain-wallet/core/ui</code>; never roll your own <code>.header</code> / <code>.back</code> / <code>.title</code> CSS.</>}
                sizing={<>Because the App header and Page header are always stacked, their edges must agree. The chevron's point aligns with the logo's left edge and the trailing slot's right edge aligns with the App header buttons. The chevron carries a small left nudge (<code>--xc-page-header-chevron-nudge</code>) because the glyph sits ~10px inside its own SVG; tune it there if the chevron is swapped.</>}
                doRule={<>✓ Keep the title to plain text · keep the trailing slot for ONE primary action (multiple actions go in a More menu)</>}
                dontRule={<>✗ Roll your own header CSS · pass JSX into <code>title</code> beyond a string (breaks centering math) · put an icon in the title (page titles carry no icon; an icon belongs in the page content)</>}
                supersedes={<>Per-route header CSS in the picker / form routes still on a bespoke <code>.header</code> (AccountPicker, WalletPicker, the Rename/Sign forms). Source of truth is <code>PageHeader.jsx</code> + <code>PageHeader.module.css</code>.</>}
            />

            <Markup>
{`import { PageHeader, Icon } from '@xchain-wallet/core/ui';

<PageHeader
    onBack={onBack}
    title="Send"
    trailing={<button onClick={openScan} aria-label="Scan QR"><Icon.CameraIcon /></button>}
/>`}
            </Markup>

            <LiveExample label="Stacked under the App header (edges should align)">
                <div style={frame}>
                    <AppHeader onScan={noop} onLock={noop} onMenuOpen={noop} />
                    <div style={headerSlot}>
                        <PageHeader
                            onBack={noop}
                            title="Send"
                            trailing={<button type="button" aria-label="Scan QR"><Icon.CameraIcon /></button>}
                        />
                    </div>
                </div>
            </LiveExample>

            <LiveExample label="Receive screen: bare title, no trailing action">
                <div style={frame}>
                    <div style={{ ...headerSlot, borderTop: 'none' }}>
                        <PageHeader
                            onBack={noop}
                            title="Receive"
                        />
                    </div>
                </div>
            </LiveExample>

            <LiveExample label="No back (root view): leading slot is a spacer">
                <div style={frame}>
                    <div style={{ ...headerSlot, borderTop: 'none' }}>
                        <PageHeader
                            title="Address book"
                        />
                    </div>
                </div>
            </LiveExample>
        </Section>
    );
}
