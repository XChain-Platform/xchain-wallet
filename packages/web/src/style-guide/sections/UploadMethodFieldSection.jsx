// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
import { registry as registryLib } from '@xchain-wallet/core';
import { UploadMethodField, useUploadMethod } from '@xchain-wallet/core/shared/components/UploadMethodField.jsx';
import { publicFileCompiledBytes } from '@xchain-wallet/core/flows/uploadMethod.js';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';

const chainRegistry = registryLib.defaultRegistry();

// A 2 KB file on Bitcoin from a software key at the Normal rate, so both
// options show a fee; the hardware example shows the disabled reason.
const UPLOAD_EXAMPLE_FILE = { name: 'art.png', type: 'image/png', bytes: new Uint8Array(2048) };
const UPLOAD_EXAMPLE_DESCRIPTOR = chainRegistry.get('bitcoin-mainnet');
const UPLOAD_EXAMPLE_FEE = { unit: 'sat/vB', rateValue: 6 };
const uploadExampleBytes = (file, meta) => publicFileCompiledBytes(
    { name: file.name, type: file.type, ...meta }, file.bytes.length,
);

function UploadMethodExample({ source }) {
    const upload = useUploadMethod({
        descriptor: UPLOAD_EXAMPLE_DESCRIPTOR,
        fromAddress: { id: `sg-${source}`, address: 'bc1qexample', source },
        feeEstimate: UPLOAD_EXAMPLE_FEE,
        coinTicker: 'BTC',
        file: UPLOAD_EXAMPLE_FILE,
        metadata: { title: '', memo: '' },
        compiledBytesFor: uploadExampleBytes,
        standardCap: 7792,
    });
    return <UploadMethodField upload={upload} />;
}

export function UploadMethodFieldSection() {
    return (
        <Section
            id="upload-method-field"
            title="Upload method field"
            tag="CANONICAL · UploadMethodField"
            kicker="How a file's bytes reach the chain: Taproot envelope (Cheapest, the default when it can be used) or Standard, each with its estimated network fee."
        >
            <Guidance
                what={<>The themed dropdown (<code>IconSelect</code>, G119) with an icon per option. Each option's second line is its description, or its one-line reason when it cannot be used, then its fee for the current file and rate. <code>useUploadMethod</code> owns the pick, the ceiling options and the compose request, so a form cannot size its file for one method and compose with another.</>}
                when={<>Every form that publishes a file: Publish file, Gated publish, Attach artwork.</>}
                whenNot={<>Actions without a file payload: their encoding is not the user's choice.</>}
                doRule={<>✓ Put it before the file field, whose ceiling follows the pick · name the method and its fee on the review</>}
                dontRule={<>✗ Hide an option that cannot be used (disable it with its reason) · re-estimate on every keystroke</>}
                supersedes={<>Source: <code>UploadMethodField.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`const upload = useUploadMethod({ descriptor, fromAddress, isWatcherMode, feeEstimate, coinTicker,
    file, metadata: { title, memo }, compiledBytesFor, standardCap });
<UploadMethodField upload={upload} />`}
            </Markup>
            <LiveExample label="A software key on Bitcoin: Taproot envelope picked">
                <UploadMethodExample source="hd" />
            </LiveExample>
            <LiveExample label="A hardware wallet: the envelope disabled with its reason">
                <UploadMethodExample source="trezor" />
            </LiveExample>
        </Section>
    );
}
