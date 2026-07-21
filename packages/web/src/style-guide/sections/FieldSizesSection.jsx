// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { Input, Select } from '@xchain-wallet/core/ui';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

// This section documents the sizing CONTRACT, not a component. It replaces the
// old "Big-field input" section, whose lead demo ("Amount + Max") duplicated
// what the Amount field now owns and made the catalog look like it had two
// amount fields.

export function FieldSizesSection() {
    return (
        <Section
            id="field-sizes"
            title="Field sizes"
            tag="CANONICAL sizing contract"
            kicker="Every form control (Input, Select, Textarea, and the composed Amount / Address / Token fields) shares one size prop: 'md' (36px, the default) and 'lg' (48px, the hero field). Pick a size per form so all its fields line up; reach for 'lg' only on the one or two primary fields of a screen."
        >
            <Guidance
                what={<>A single <code>size</code> prop on the field primitives: <code>md</code> (default, <code>min-height: 36px</code>, <code>--xc-text-md</code>) and <code>lg</code> (<code>48px</code>, <code>--xc-text-lg</code>, weightier label). Mirrors <code>Button</code>'s <code>size</code> API. The <code>lg</code> rule lives once in <code>Input.module.css</code>; <code>Select</code> and <code>Textarea</code> share it, and the composed fields (<code>AmountField</code>, <code>AddressCombobox</code>, <code>TokenField</code>) forward the same prop.</>}
                when={<>Choose one size for a form so its fields are visually consistent. Default <code>md</code> for dense forms and secondary fields. Use <code>lg</code> for the one or two primary fields of a focused screen (Send's To + Amount, Receive's Amount) to signal "this is what you're here to fill in".</>}
                whenNot={<>Don't mix sizes within one form's field stack: a 48px field next to 36px fields is the exact clash this contract removes. Don't hand-roll big-field styling with inline <code>style</code> objects (the old pattern); pass <code>size="lg"</code>.</>}
                sizing={<>md: <code>36px</code> / 14px text / 8-12px padding / 13px label. lg: <code>48px</code> / 16px text / 12-16px padding / 14px-600 label. Both share the same border, radius (<code>--xc-radius-md</code>), and focus ring, so only the scale changes.</>}
                variants={<><code>size="md" | "lg"</code> on <code>Input</code>, <code>Select</code>, <code>Textarea</code>, <code>AmountField</code>, <code>AddressCombobox</code>, and <code>TokenField</code>. Default is <code>md</code> everywhere; omit the prop for compact.</>}
                doRule={<>✓ Pick one size per form · use <code>lg</code> only for the primary fields · pass <code>size</code> instead of an inline style · pair an inline action (Max, address book) with the field via the component, not a bespoke wrapper</>}
                dontRule={<>✗ Mix 36px and 48px fields in one stack · duplicate the big-field values inline · use <code>lg</code> for every field (loses the "this is what matters" signal)</>}
                supersedes={<>The old ad-hoc big-field inline <code>style</code> objects and the duplicated <code>.bigField</code> CSS that used to live in <code>AmountField.module.css</code>, <code>Send.module.css</code>, and this section. The contract now lives once in <code>Input.module.css</code> (<code>.lg</code>).</>}
            />

            <Markup>
{`<Input label="Amount" size="lg" />   // 48px hero field
<Input label="Memo" />               // 36px default (md)
<Select label="Network" size="lg">…</Select>
<AmountField size="lg" … />          // composed fields take the same prop`}
            </Markup>

            <LiveExample label="Default (md, 36px) vs hero (lg, 48px): Input">
                <Input label="Memo (md, default)" placeholder="Optional note" defaultValue="" />
                <Input label="Amount (lg, hero)" size="lg" placeholder="0.00" defaultValue="" />
            </LiveExample>

            <LiveExample label="Same contract on Select">
                <Select label="Network (md, default)" defaultValue="btc">
                    <option value="btc">Bitcoin</option>
                    <option value="ltc">Litecoin</option>
                    <option value="doge">Dogecoin</option>
                </Select>
                <Select label="Network (lg, hero)" size="lg" defaultValue="btc">
                    <option value="btc">Bitcoin</option>
                    <option value="ltc">Litecoin</option>
                    <option value="doge">Dogecoin</option>
                </Select>
            </LiveExample>
        </Section>
    );
}
