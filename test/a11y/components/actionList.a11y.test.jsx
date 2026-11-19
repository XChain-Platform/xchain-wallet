// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// The action list (G101) and the Actions | Details toggle (G102) under axe:
// the list with every row state, and both of the toggle's panels after a
// keyboard switch, so neither panel ships a serious violation.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionList, ActionListItem } from '../../../packages/core/src/shared/components/ActionList.jsx';
import { ActionsDetailsToggle } from '../../../packages/core/src/shared/components/ActionsDetailsToggle.jsx';
import { CopyIcon, ExternalLinkIcon, XIcon } from '../../../packages/core/src/ui/icons/index.jsx';
import { expectNoSeriousAxeViolations } from '../helpers/axe.js';

const noop = () => {};

function OrderActions() {
    return (
        <ActionList label="Order actions">
            <ActionListItem icon={<ExternalLinkIcon />} title="View on the explorer" description="The order's transaction" href="https://explorer.xchain.io/tx/ab" />
            <ActionListItem icon={<CopyIcon />} title="Copy transaction ID" description="a3f9...c21e" onClick={noop} />
            <ActionListItem icon={<CopyIcon />} title="Edit order" description="Change the price" onClick={noop} disabled disabledReason="A filled order cannot change" />
            <ActionListItem icon={<XIcon />} title="Cancel order" description="Returns the 380 XCHAIN still escrowed" tone="danger" onClick={noop} />
        </ActionList>
    );
}

afterEach(cleanup);

describe('action list accessibility', () => {
    it('has no serious violations with link, button, disabled and danger rows', async () => {
        const { container } = render(<OrderActions />);
        expect(screen.getAllByRole('listitem')).toHaveLength(4);
        await expectNoSeriousAxeViolations(container);
    });

    it('has no serious violations on either panel of the Actions | Details toggle', async () => {
        const { container } = render(
            <ActionsDetailsToggle
                actions={<OrderActions />}
                details={(
                    <dl>
                        <dt>Price</dt><dd>0.000004 BTC each</dd>
                        <dt>Filled</dt><dd>620 of 1,000 XCHAIN</dd>
                    </dl>
                )}
            />,
        );
        await expectNoSeriousAxeViolations(container);
        const actionsTab = screen.getByRole('tab', { name: /Actions/ });
        fireEvent.keyDown(actionsTab, { key: 'ArrowRight' });
        expect(screen.getByRole('tab', { name: /Details/ }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getByText('620 of 1,000 XCHAIN')).toBeTruthy();
        await expectNoSeriousAxeViolations(container);
    });
});
