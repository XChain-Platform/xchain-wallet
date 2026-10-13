// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { NoticeModal } from '@xchain-wallet/core/shared/components/NoticeModal.jsx';
import { ConfirmModal } from '@xchain-wallet/core/shared/components/ConfirmModal.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

// Dialogs are fixed overlays; each example's frame is its own viewport, so
// the overlay covers the frame and not the guide.
const FRAME_H = 300;

export function DialogsSection() {
    const noop = () => {};
    return (
        <Section
            id="dialogs"
            title="Dialogs and notices"
            tag="CANONICAL · NoticeModal / ConfirmModal"
            kicker="The two shared dialogs: NoticeModal for an 'it happened' confirmation with one OK, ConfirmModal for a yes / no question. Both are small centred panels over a dimmed screen; Escape and the backdrop dismiss (Cancel for ConfirmModal)."
        >
            <Guidance
                what={<><code>&lt;NoticeModal title message confirmLabel onClose /&gt;</code> and <code>&lt;ConfirmModal title message confirmLabel cancelLabel danger onConfirm onCancel /&gt;</code> from <code>@xchain-wallet/core/shared/components/</code>. ConfirmModal focuses Cancel first, so a destructive action is never one stray Enter away; <code>useConfirmModal</code> gives <code>await confirm(...)</code> at the call site.</>}
                when={<>NoticeModal: a quick result where a result screen would be overkill (message sent, order placed). ConfirmModal: replace every <code>window.confirm()</code>.</>}
                whenNot={<>Signing or approving a transaction (the full ConfirmActionModal screen) · an error the user must fix in a form (StatusMessage in the form) · a result the user has already moved on from (toast).</>}
                sizing={<>Panel 320px max, <code>--xc-space-4</code> padding, buttons full width. The same size on every platform; on a phone it is inset by <code>--xc-space-4</code> from the edges.</>}
                doRule={<>✓ Title is the question or the result ("Remove this contact?") · <code>danger</code> when confirming removes or spends something</>}
                dontRule={<>✗ Native <code>alert()</code> / <code>confirm()</code> · a long message (link to a screen instead) · three buttons</>}
            />
            <Markup>
{`const { confirm, request, onConfirm, onCancel } = useConfirmModal();
if (await confirm({ title: 'Remove this contact?', message: 'It is deleted from this device.', confirmLabel: 'Remove', danger: true })) {
    removeContact(id);
}
{request ? <ConfirmModal {...request} onConfirm={onConfirm} onCancel={onCancel} /> : null}

<NoticeModal title="Message sent" message="It confirms in about 10 minutes." onClose={close} />`}
            </Markup>
            <LiveExample label="NoticeModal" minHeight={FRAME_H} padded={false}>
                <NoticeModal title="Message sent" message="It confirms in about 10 minutes." onClose={noop} />
            </LiveExample>
            <LiveExample label="ConfirmModal" minHeight={FRAME_H} padded={false}>
                <ConfirmModal title="Leave this screen?" message="The form you started is not saved." confirmLabel="Leave" onConfirm={noop} onCancel={noop} />
            </LiveExample>
            <LiveExample label="ConfirmModal, danger" minHeight={FRAME_H} padded={false}>
                <ConfirmModal title="Remove this contact?" message="It is deleted from this device." confirmLabel="Remove" danger onConfirm={noop} onCancel={noop} />
            </LiveExample>
        </Section>
    );
}
