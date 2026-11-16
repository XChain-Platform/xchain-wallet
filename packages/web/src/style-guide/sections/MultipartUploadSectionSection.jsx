// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// The multi-part upload section: the running upload, the unfinished uploads
// list and the failure message the file forms share.

import { MultipartUploadSection } from '@xchain-wallet/core/shared/components/MultipartUploadSection.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const SENDING = { totalParts: 26, transactions: 55, currentPart: 9, stage: 'sending', unfinished: [] };
const UNFINISHED = {
    totalParts: null,
    transactions: null,
    currentPart: null,
    stage: null,
    unfinished: [{ id: 'sg-upload', name: 'artwork.png', partsSent: 12, totalParts: 26, paidTransactions: 25 }],
    onContinue: () => {},
    onDiscard: () => {},
};
const FALLBACK = 'The multi-part upload could not continue.';

export function MultipartUploadSectionSection() {
    return (
        <Section
            id="multipart-upload-section"
            title="Multi-part upload section"
            tag="CANONICAL · MultipartUploadSection"
            kicker="A file larger than one transaction: its running upload, the unfinished uploads it can resume, and why it stopped."
        >
            <Guidance
                what={<>The running part and stage (<code>MultipartUploadPanel</code>), the unfinished uploads with Continue and Discard, the hidden file input a resume re-picks into, and one error message: a mapped failure, a resume refusal, or the form's fallback.</>}
                when={<>Publish file, Gated publish and Attach artwork, whenever the Upload method picks a multi-part upload.</>}
                whenNot={<>A file that fits one transaction: it goes through the confirm screen instead.</>}
                doRule={<>✓ Pass the form's own fallback message · keep the section mounted while the upload runs</>}
                dontRule={<>✗ Show the raw error text · start a second upload while one runs</>}
                supersedes={<>Source: <code>MultipartUploadSection.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<MultipartUploadSection panelProps={panel.panelProps} fileInput={panel.fileInput}
    resumeReason={panel.resumeReason} error={panel.error} listError={panel.listError}
    fallbackMessage="The multi-part upload could not continue." />`}
            </Markup>
            <LiveExample label="Sending part 9 of 26">
                <MultipartUploadSection panelProps={SENDING} fallbackMessage={FALLBACK} />
            </LiveExample>
            <LiveExample label="An unfinished upload to continue or discard">
                <MultipartUploadSection panelProps={UNFINISHED} fallbackMessage={FALLBACK} />
            </LiveExample>
            <LiveExample label="An upload that stopped with no mapped reason">
                <MultipartUploadSection panelProps={null} error={new Error('stopped')} fallbackMessage={FALLBACK} />
            </LiveExample>
        </Section>
    );
}
