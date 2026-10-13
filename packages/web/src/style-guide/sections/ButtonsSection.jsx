// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button, Icon, Input } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const VARIANTS = ['primary', 'secondary', 'ghost', 'danger', 'success'];
const LABELS = { primary: 'Send', secondary: 'Receive', ghost: 'Cancel', danger: 'Delete', success: 'Approve' };
const row = { display: 'flex', flexWrap: 'wrap', gap: 'var(--xc-space-2)', alignItems: 'center' };
const sizeRow = { ...row, alignItems: 'flex-start' };
const stack = { display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-3)' };
const tag = { fontSize: 11, color: 'var(--xc-text-muted)', minWidth: 72 };

export function ButtonsSection() {
    const noop = () => {};
    return (
        <Section
            id="buttons"
            title="Buttons"
            tag="CANONICAL · Button"
            kicker="Every button-shaped control is a <Button>. Five variants, three shared control sizes, a loading state that also disables, and an icon picked from the label unless you pass one."
        >
            <Guidance
                what={<>Props: <code>variant</code> (<code>primary</code> | <code>secondary</code> | <code>ghost</code> | <code>danger</code> | <code>success</code>), <code>size</code> (<code>sm</code> 32px | <code>md</code> 40px | <code>lg</code> 48px), <code>block</code> (full width), <code>loading</code> (spinner, disabled, <code>aria-busy</code>), <code>disabled</code>, <code>type</code> (default <code>button</code>, so it never submits by accident), <code>icon</code> (a node, or <code>null</code> for no icon).</>}
                when={<>Primary: the one action the screen exists for. Secondary: a second real action. Ghost: back out, cancel, less-used actions. Danger: destroys or spends irreversibly. Success: approve or confirm a pending request.</>}
                sizing={<>Labels never wrap; shorten a long label instead. In a FormPage action row buttons grow to share the row and wrap onto a new line; put the primary last.</>}
                doRule={<>✓ One primary per screen · <code>type="submit"</code> only on the form's submit · <code>loading</code> while the action runs</>}
                dontRule={<>✗ A styled <code>&lt;div&gt;</code> or <code>&lt;a&gt;</code> as a button · two primaries side by side · a variant name that does not exist (it renders unstyled)</>}
            />
            <Markup>
{`<Button variant="primary" type="submit" loading={busy}>Send</Button>
<Button variant="ghost" onClick={onBack}>Cancel</Button>
<Button variant="danger" size="sm" icon={null}>Delete</Button>
<Button block variant="secondary" icon={<Icon.ReceiveIcon />}>Receive</Button>`}
            </Markup>
            <LiveExample label="Buttons and inputs on the shared size scale">
                <div style={stack}>
                    {['sm', 'md', 'lg'].map((size) => (
                        <div key={size} style={sizeRow}>
                            <span style={tag}>size="{size}"</span>
                            <Input
                                aria-label={`${size} input`}
                                size={size}
                                value={`Input ${size}`}
                                readOnly
                                style={{ width: 140 }}
                            />
                            {VARIANTS.map((v) => (
                                <Button key={v} variant={v} size={size} onClick={noop}>{LABELS[v]}</Button>
                            ))}
                        </div>
                    ))}
                </div>
            </LiveExample>
            <LiveExample label="Loading and disabled">
                <div style={stack}>
                    <div style={row}>
                        <span style={tag}>loading</span>
                        {VARIANTS.map((v) => <Button key={v} variant={v} loading>{LABELS[v]}</Button>)}
                    </div>
                    <div style={row}>
                        <span style={tag}>disabled</span>
                        {VARIANTS.map((v) => <Button key={v} variant={v} disabled>{LABELS[v]}</Button>)}
                    </div>
                </div>
            </LiveExample>
            <LiveExample label="Icons and block width">
                <div style={stack}>
                    <div style={row}>
                        <Button onClick={noop}>Send</Button>
                        <Button onClick={noop} icon={null}>Send</Button>
                        <Button variant="secondary" onClick={noop} icon={<Icon.CameraIcon />}>Scan</Button>
                    </div>
                    <Button block variant="primary" onClick={noop}>Continue</Button>
                </div>
            </LiveExample>
        </Section>
    );
}
