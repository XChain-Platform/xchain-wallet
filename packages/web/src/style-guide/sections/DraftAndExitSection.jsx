// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { DemoExitConfirm } from '@xchain-wallet/core/shared/components/DemoExitConfirm.jsx';
import { DraftDiscardButton } from '@xchain-wallet/core/shared/components/DraftDiscardButton.jsx';
import { DraftNotice } from '@xchain-wallet/core/shared/components/DraftNotice.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const noop = () => {};
const DIALOG_H = 320;

export function DraftAndExitSection() {
    return (
        <Section
            id="draft-exit"
            title="Draft restore and demo exit"
            tag="CANONICAL · DraftNotice / DemoExitConfirm"
            kicker="Saved form input is offered in one top notice with a Restore action and a discard X. Demo exit remains a destructive confirmation."
        >
            <Guidance
                what={<><code>DraftNotice</code> is the G120 info notice for a saved form draft. Restore spans the notice inner width, while its X deletes the draft and hides the notice. <code>DemoExitConfirm</code> is a danger <code>ConfirmModal</code> whose message states what is deleted and what is not.</>}
                when={<>Draft: the top of every form that offers saved input. Demo exit: every user-triggered way out of the demo wallet.</>}
                whenNot={<>Real wallets: removing one is its own flow with a recovery check.</>}
                doRule={<>✓ Use the X to discard the saved draft</>}
                dontRule={<>✗ Build draft actions locally or put the notice below fields</>}
                supersedes={<>Source: <code>DraftNotice.jsx</code>, <code>DemoExitConfirm.jsx</code> in <code>shared/components</code>. <code>DraftDiscardButton</code> remains documented for older callers.</>}
            />
            <Markup>
{`<DraftNotice onRestore={restore} onDiscard={discard}>
    Your unfinished payment was saved as a draft. Restore it to continue. Nothing was sent.
</DraftNotice>
<DemoExitConfirm busy={false} error={null} onConfirm={exit} onCancel={stay} />`}
            </Markup>
            <LiveExample label="DraftNotice">
                <DraftNotice onRestore={noop} onDiscard={noop}>
                    Your unfinished payment was saved as a draft. Restore it to continue. Nothing was sent.
                </DraftNotice>
            </LiveExample>
            <LiveExample label="DraftDiscardButton">
                <DraftDiscardButton onClick={noop} label="Discard the saved draft">Discard draft</DraftDiscardButton>
            </LiveExample>
            <LiveExample label="DemoExitConfirm" minHeight={DIALOG_H + 120} padded={false}>
                <DemoExitConfirm busy={false} error={null} onConfirm={noop} onCancel={noop} />
            </LiveExample>
        </Section>
    );
}
