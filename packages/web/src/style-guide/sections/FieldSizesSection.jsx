// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Button, ChainPicker, Input, Select, Textarea } from '@xchain-wallet/core/ui';
import { registry as registryLib } from '@xchain-wallet/core';
import { NetworkFilter } from '@xchain-wallet/core/shared/components/NetworkFilter.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const chainRegistry = registryLib.defaultRegistry();
const chainIds = ['bitcoin-mainnet', 'litecoin-mainnet', 'dogecoin-mainnet'];
const coinFamilies = ['bitcoin', 'litecoin', 'dogecoin'];
const sizeRow = { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 'var(--xc-space-2)' };
const sizeCell = { width: 160, minWidth: 0 };
const sizeTag = { width: 56, paddingBlock: 'var(--xc-space-2)', color: 'var(--xc-text-muted)' };
const sizeStack = { display: 'flex', flexDirection: 'column', gap: 'var(--xc-space-3)' };

export function FieldSizesSection() {
    return (
        <Section
            id="field-sizes"
            title="Field sizes"
            tag="CANONICAL sizing contract"
            kicker="Fields, selects, pickers, filters, and buttons share sm (32px), md (40px), and lg (48px). The default is md; touch hit areas remain at least 44px."
        >
            <Guidance
                what={<>One <code>size</code> prop across text fields, native selects, custom pickers, the network filter, and buttons. Every control uses the shared height, font, radius, and horizontal-padding tokens.</>}
                when={<>Use <code>md</code> by default. Use <code>sm</code> in dense toolbars and rows where its expanded touch target cannot overlap another action. Use <code>lg</code> for one or two hero controls, including Send's To and Amount fields.</>}
                whenNot={<>Do not invent a nearby height, mix arbitrary dimensions within a row, or enlarge a painted control to satisfy touch. The coarse-pointer hit area expands around <code>sm</code> and <code>md</code> without changing layout.</>}
                sizing={<><code>sm</code>: 32px visual, 44px touch target. <code>md</code>: 40px visual, 44px touch target. <code>lg</code>: 48px visual and touch target. All share <code>--xc-control-font</code>, <code>--xc-control-radius</code>, and <code>--xc-control-pad-x</code>.</>}
                variants={<><code>size="sm" | "md" | "lg"</code>. Default is <code>md</code>. Composed fields forward the size to their shared primitive.</>}
                doRule={<>✓ Pick one size per form · mark only optional fields with the exact <code>(optional)</code> suffix · use <code>optional</code> when the base label is translated or dynamic · pair an inline action (Max, address book) with the field via the component</>}
                dontRule={<>✗ Mix required and optional markers · write <code>(required)</code> in labels · put units inside the optional marker · use literal control heights</>}
                supersedes={<>Literal component heights and one-off field padding. The contract lives in <code>tokens.css</code> and the shared control primitives.</>}
            />

            <Markup>
{`<Input label="Amount" size="lg" />   // 48px hero field
<Input label="Memo" optional />       // 40px default field
<Select label="Network" size="lg">…</Select>
<Textarea label="Message" size="lg" rows={3} />
<AmountField size="lg" … />          // composed fields take the same prop`}
            </Markup>

            <LiveExample label="All control families align at each size">
                <div style={sizeStack}>
                    {['sm', 'md', 'lg'].map((size) => (
                        <div key={size} style={sizeRow}>
                            <span style={sizeTag}>{size}</span>
                            <div style={sizeCell}>
                                <Input aria-label={`${size} field`} size={size} value="Field" readOnly />
                            </div>
                            <div style={sizeCell}>
                                <Select aria-label={`${size} select`} size={size} defaultValue="one">
                                    <option value="one">Select</option>
                                    <option value="two">Second option</option>
                                </Select>
                            </div>
                            <div style={sizeCell}>
                                <ChainPicker
                                    size={size}
                                    value="bitcoin-mainnet"
                                    onChange={() => {}}
                                    chainIds={chainIds}
                                    chainRegistry={chainRegistry}
                                />
                            </div>
                            <div style={sizeCell}>
                                <NetworkFilter
                                    size={size}
                                    value="all"
                                    onChange={() => {}}
                                    coinFamilies={coinFamilies}
                                    chainRegistry={chainRegistry}
                                    ariaLabel={`${size} network filter`}
                                />
                            </div>
                            <Button size={size} variant="primary">Button</Button>
                        </div>
                    ))}
                </div>
            </LiveExample>

            <LiveExample label="Same contract on Textarea">
                <Textarea
                    label="Message (md, default)"
                    rows={2}
                    placeholder="Optional message"
                    defaultValue=""
                />
                <Textarea
                    label="Message (lg, hero)"
                    size="lg"
                    rows={2}
                    placeholder="Optional message"
                    defaultValue=""
                />
            </LiveExample>
        </Section>
    );
}
