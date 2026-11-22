// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { Input, Select } from '@xchain-wallet/core/ui';
import { EXPIRATION_OPTIONS } from '@xchain-wallet/core/shared/components/expirationChoice.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

export function ExpirationChoiceSection() {
    const [mode, setMode] = useState('default');
    const [expires, setExpires] = useState('');
    return (
        <Section
            id="expiration-choice"
            title="Expiration choice"
            tag="CANONICAL · EXPIRATION_OPTIONS"
            kicker="The Expiration choice on the trade forms' terms: the standard icon dropdown with an icon per option (G44), never radio buttons."
        >
            <Guidance
                what={<><code>EXPIRATION_OPTIONS</code> from <code>expirationChoice.jsx</code> is the shared option list (Default window, Expire at a specific time) for the kit <code>Select</code>. Choosing <code>custom</code> shows the form's own Expires date and time field under it.</>}
                when={<>The terms of Swap, Create Order, Cross-Chain Swap and Cross-Chain Order, and the dispenser form's expiry.</>}
                whenNot={<>An expiry with other choices: give that field its own options.</>}
                doRule={<>✓ Import the shared options so every trade form reads alike · show the Expires field only for <code>custom</code></>}
                dontRule={<>✗ Copy the options into a route · draw the choice as radio buttons</>}
                supersedes={<>Source: <code>expirationChoice.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<Select label="Expiration" value={expMode} onChange={(e) => setExpMode(e.target.value)} options={EXPIRATION_OPTIONS} />
{expMode === 'custom' ? <Input label="Expires" type="datetime-local" value={expInput} onChange={...} /> : null}`}
            </Markup>
            <LiveExample label="Default window, then a specific time">
                <div style={{ display: 'grid', gap: 'var(--xc-form-gap)' }}>
                    <Select
                        label="Expiration"
                        help="How long the order stays open for matching."
                        value={mode}
                        onChange={(event) => setMode(event.target.value)}
                        options={EXPIRATION_OPTIONS}
                    />
                    {mode === 'custom' ? (
                        <Input
                            label="Expires"
                            type="datetime-local"
                            value={expires}
                            onChange={(event) => setExpires(event.target.value)}
                        />
                    ) : null}
                </div>
            </LiveExample>
        </Section>
    );
}
