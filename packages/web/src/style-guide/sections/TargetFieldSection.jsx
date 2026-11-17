// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useState } from 'react';
import { TargetField } from '@xchain-wallet/core/shared/components/TargetField.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const CONTRACTS = [
    { name: 'Yield Vault', detail: '#868' },
    { name: 'Unnamed contract', detail: '#12' },
];

export function TargetFieldSection() {
    const [picked, setPicked] = useState(0);
    const next = () => setPicked((i) => (i + 1) % CONTRACTS.length);

    return (
        <Section
            id="target-field"
            title="Target field"
            tag="CANONICAL what-this-acts-on field"
            kicker="The read-only field that names what a form acts on: the contract on Execute, Deposit and Withdraw, and Stake On in the Staking form. It leads the main section, shows the target's name with its number muted after it, and carries a plain list icon inside to pick another target. The form's title never names the target."
        >
            <Guidance
                what={<>A field-height, muted, read-only box with the target's icon, name and identity, and a <code>FieldIconButton</code> list icon in the trailing slot that calls <code>onPick</code>. An optional <code>hint</code> line with a clock icon carries the one fact to read before acting, such as a stake's cooldown.</>}
                when={<>The first field of a form's main section whenever the page that opened the form fixed the target: a contract, or the network a stake is locked on.</>}
                whenNot={<>A value the user types or picks from their own balances (use <code>Input</code> or <code>TokenField</code>). Never put the target's name or number in the page title instead.</>}
                sizing={<>The md control height of every Input and IconSelect, so it lines up with the fields under it.</>}
                variants={<><code>label</code>, <code>help</code>, <code>name</code>, <code>detail</code> (text or a ChainBadge), <code>icon</code>, <code>hint</code>, <code>onPick</code>, <code>pickLabel</code>. Without <code>onPick</code> the icon stays, locked.</>}
                doRule={<>✓ Lead the main section with it · say the cooldown as the hint ("Unstaking takes about 2 days (288 blocks)") · open the host's picker page from the list icon</>}
                dontRule={<>✗ Name the target in the title · make the field editable · hide the list icon</>}
                supersedes={<>Contract numbers in form titles ("Stake on Contract #12") and the Target / Cooldown details list. Component at <code>packages/core/src/shared/components/TargetField.jsx</code>.</>}
            />

            <Markup>
{`import { TargetField } from '@xchain-wallet/core/shared/components/TargetField.jsx';

<TargetField
    label="Stake On"
    name="Yield Vault"
    detail="#868"
    hint="Unstaking takes about 2 days (288 blocks)"
    onPick={openTargetPicker}
    pickLabel="Choose what to stake on"
/>`}
            </Markup>

            <LiveExample label="Stake On with the cooldown hint. Select the list icon to cycle the demo target (in-app it opens the picker).">
                <TargetField
                    label="Stake On"
                    help="The contract this stake is locked in."
                    name={CONTRACTS[picked].name}
                    detail={CONTRACTS[picked].detail}
                    hint="Unstaking takes about 2 days (288 blocks)"
                    onPick={next}
                    pickLabel="Choose what to stake on"
                />
            </LiveExample>

            <LiveExample label="Contract on Execute, Deposit and Withdraw: no hint.">
                <TargetField
                    label="Contract"
                    name="Yield Vault"
                    detail="#868"
                    onPick={next}
                    pickLabel="Choose another contract"
                />
            </LiveExample>
        </Section>
    );
}
