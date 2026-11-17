// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Icon } from '@xchain-wallet/core/ui';
import { ActionList, ActionListItem } from '@xchain-wallet/core/shared/components/ActionList.jsx';
import { ActionsDetailsToggle } from '@xchain-wallet/core/shared/components/ActionsDetailsToggle.jsx';
import { XChainExplorerIcon } from '@xchain-wallet/core/shared/components/ExplorerFavicon.jsx';
import { Guidance, LiveExample, Markup, Section } from '../StyleGuidePage.jsx';

// G101 and G102 (operator 2026-11-13): every action section is this list,
// and a detail page with more than one action puts it under Actions | Details.
export function ActionListSection() {
    return (
        <Section
            id="action-list"
            title="Action list and Actions | Details"
            tag="SHARED · ActionList, ActionsDetailsToggle"
            kicker="Every set of actions is one wide list: icon, title, a line saying what it does, and a chevron."
        >
            <Guidance
                what={<><code>ActionList</code> holds <code>ActionListItem</code> rows: a bare icon with no tile behind it, a title, a one-line description and a right chevron. <code>ActionsDetailsToggle</code> puts the list under an Actions | Details toggle, Actions first.</>}
                when={<>Any action section, and every detail page with more than one action (G101, G102).</>}
                whenNot={<>A form's submit button, and the market page's Buy and Sell, which stay as buttons by ruling.</>}
                sizing={<>Full width inside the page gutter; one card with dividers between rows.</>}
                variants={<>Default, and disabled with its reason in place of the description.</>}
                doRule={<>Say what the action does in the description, in plain words.</>}
                dontRule={<>Do not draw actions as short round buttons, tiles or pills, and never colour a row red because it deletes or removes (every row is one colour).</>}
            />
            <Markup>
{`<ActionsDetailsToggle
    actions={(
        <ActionList>
            <ActionListItem icon={<Icon.PencilIcon />} title="Edit order" description="Change the price, amount or expiry" onClick={edit} />
            <ActionListItem icon={<Icon.XIcon />} title="Cancel order" description="Returns the 380 XCHAIN still escrowed" onClick={cancel} />
        </ActionList>
    )}
    details={facts}
/>`}
            </Markup>
            <LiveExample label="Actions chosen, with a disabled row">
                <ActionsDetailsToggle
                    actions={(
                        <ActionList>
                            <ActionListItem icon={<Icon.PencilIcon />} title="Edit order" description="Change the price, amount or expiry" onClick={() => {}} />
                            {/* An explorer row's icon is that explorer's own logo (ExplorerFavicon). */}
                            <ActionListItem icon={<XChainExplorerIcon />} title="View on the explorer" description="The order's transaction" onClick={() => {}} />
                            <ActionListItem icon={<Icon.LockIcon />} title="Transfer" description="Hand the ownership to another address" disabled disabledReason="Only the owner can transfer this." />
                            <ActionListItem icon={<Icon.XIcon />} title="Cancel order" description="Returns the 380 XCHAIN still escrowed" onClick={() => {}} />
                        </ActionList>
                    )}
                    details={<p>The facts list and history go here.</p>}
                />
            </LiveExample>
        </Section>
    );
}
