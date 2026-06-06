// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available —
// contact legal@dankest.llc.

import { Icon } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

// Every icon exported from packages/core/src/ui/icons/index.jsx that
// renders a flat single-color SVG (skips FileTypeIcon — that one takes
// a `type` prop and renders a different glyph per file extension, not
// a stable single icon).
const ICON_NAMES = [
    'BackIcon', 'CheckIcon', 'XIcon', 'PlusIcon', 'MenuIcon', 'MoreIcon',
    'SendIcon', 'ReceiveIcon', 'SwapIcon', 'BroadcastIcon',
    'ScanIcon', 'CameraIcon', 'CopyIcon', 'PasteIcon', 'SearchIcon', 'FilterIcon',
    'BookIcon', 'AddressIcon', 'UsersIcon',
    'LockIcon', 'UnlockIcon', 'KeyIcon', 'SignIcon', 'EyeIcon', 'EyeOffIcon',
    'TokenIcon', 'MarketIcon', 'LineChartIcon', 'DollarIcon',
    'MessageIcon', 'HistoryIcon', 'ContractIcon', 'StakeIcon', 'MultisigIcon',
    'HomeIcon', 'GearIcon', 'InfoIcon', 'BookIcon',
    'PencilIcon', 'TrashIcon', 'RefreshIcon', 'MigrateIcon',
    'ForwardIcon', 'DocumentIcon', 'LinkIcon', 'UnlinkIcon', 'ExternalLinkIcon',
    'UsbIcon', 'DownloadIcon', 'UploadIcon',
    'PauseIcon', 'PlayIcon',
];

const SEEN = new Set();
const UNIQUE_ICONS = ICON_NAMES.filter((n) => {
    if (SEEN.has(n)) return false;
    SEEN.add(n);
    return Boolean(Icon[n]);
});

export function IconsSection() {
    return (
        <Section
            id="icons"
            title="Icon catalog"
            tag="single-color flat SVGs"
            kicker="Every icon the wallet ships, drawn at 18×18 with currentColor stroke. Most are Lucide wrappers; a few are hand-rolled when the Lucide glyph didn't quite fit. Always use these from @xchain-wallet/core/ui — never inline a one-off SVG."
        >
            <Guidance
                what={<>One icon set, 18×18 default, single-color via <code>stroke="currentColor"</code> so each icon inherits the surrounding text color (and the same Icon glyph can render in the muted-text-color of a balance row OR the accent-blue of a header at zero cost). The set lives at <code>packages/core/src/ui/icons/index.jsx</code>.</>}
                when={<>Buttons, headers, list-row affordances, status indicators — anywhere a glyph is needed. <code>iconForLabel(label)</code> auto-resolves a fitting glyph from a button's text (Send button → SendIcon) so most callers don't pass an explicit <code>icon</code> prop.</>}
                whenNot={<>Emoji icons for wayfinding (sidebar / breadcrumb chrome) are fine where they convey identity better than a generic glyph; the rest of the app uses flat SVG.</>}
                doRule={<>✓ Always import via <code>{`import { Icon } from '@xchain-wallet/core/ui'`}</code> and reference <code>&lt;Icon.SendIcon /&gt;</code> · let icons inherit color from the surrounding text (don't force a fill / stroke at the call site) · use the concept-mapping (SendIcon for any "send" affordance, BookIcon for address book, etc.) so a glyph always means the same thing</>}
                dontRule={<>✗ Inline a one-off SVG · pull a Lucide icon directly bypassing the wrapper (defeats the icon-swap point of having a catalog) · resize past 18-24px without checking — bigger icons need different stroke weights to read right</>}
            />
            <Markup>
{`import { Icon } from '@xchain-wallet/core/ui';

<Icon.SendIcon />        // 18×18 by default
<Icon.ReceiveIcon />
<Icon.FilterIcon />

// Auto-resolve from label (Button does this automatically):
import { iconForLabel } from '@xchain-wallet/core/ui';
const SendGlyph = iconForLabel('Send');`}
            </Markup>
            <LiveExample label="All shipped icons (currentColor — drag your OS to dark mode to see)">
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                    gap: 12,
                }}>
                    {UNIQUE_ICONS.map((name) => {
                        const Glyph = Icon[name];
                        return (
                            <div key={name} style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 6,
                                padding: 10,
                                border: '1px solid var(--xc-border)',
                                borderRadius: 6,
                                background: 'var(--xc-surface)',
                            }}>
                                <Glyph />
                                <code style={{ fontSize: 11, color: 'var(--xc-text-muted)' }}>{name}</code>
                            </div>
                        );
                    })}
                </div>
            </LiveExample>
            <LiveExample label="currentColor inheritance — same icon, three colors">
                <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
                    <span style={{ color: 'var(--xc-text)' }}><Icon.SendIcon /></span>
                    <span style={{ color: 'var(--xc-text-muted)' }}><Icon.SendIcon /></span>
                    <span style={{ color: 'var(--xc-accent-primary)' }}><Icon.SendIcon /></span>
                    <span style={{ color: 'var(--xc-danger)' }}><Icon.SendIcon /></span>
                </div>
            </LiveExample>
        </Section>
    );
}
