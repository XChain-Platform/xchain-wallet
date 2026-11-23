// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { FileField } from '@xchain-wallet/core/shared/components/FileField.jsx';
import { Section, Guidance, Markup, LiveExample } from '../StyleGuidePage.jsx';
import { SharedComponentExampleProvider } from './sharedComponentExamples.jsx';

const noop = () => {};

export function FileFieldSection() {
    const [fileName, setFileName] = useState('');
    return (
        <Section
            id="file-field"
            title="File field"
            tag="CANONICAL · FileField"
            kicker="The one control for choosing a file: a field that shows the file's name, a choose button, a clear button and a drop target."
        >
            <Guidance
                what={<><code>FileField</code> wraps a hidden file input in the standard field anatomy (label, help, Optional tag, error). The host keeps the file; the field reports it through <code>onFile</code> and shows <code>fileName</code>.</>}
                when={<>Any form that takes a file: an image to publish, a backup to import, a PSBT to load.</>}
                whenNot={<>Pasting text (use Textarea) or scanning a code (the QR scanner).</>}
                doRule={<>✓ Pass <code>accept</code> as a default filter only · show the size limit in the label · pass <code>onClear</code> so the X appears once a file is picked</>}
                dontRule={<>✗ Render a raw file input · treat <code>accept</code> as validation</>}
                supersedes={<>Source: <code>FileField.jsx</code> in <code>shared/components</code>.</>}
            />
            <Markup>
{`<FileField label="File (up to 7,792 bytes)" fileName={name} accept={['.png', '.jpg']}
    onFile={(file) => setName(file.name)} onClear={() => setName('')} />`}
            </Markup>
            <LiveExample label="Empty, then a picked file">
                <SharedComponentExampleProvider>
                    <FileField
                        label="File (up to 7,792 bytes)"
                        fileName={fileName}
                        onFile={(file) => setFileName(file.name)}
                        onClear={() => setFileName('')}
                    />
                    <FileField label="Backup" optional fileName="wallet-backup.json" onClear={noop} />
                </SharedComponentExampleProvider>
            </LiveExample>
            <LiveExample label="Area: a screen whose first step is choosing one file (Restore Backup)">
                <SharedComponentExampleProvider>
                    <FileField
                        variant="area"
                        label="Choose your backup file"
                        hint="or drop it here"
                        inputLabel="Backup file"
                        onFile={noop}
                    />
                </SharedComponentExampleProvider>
            </LiveExample>
        </Section>
    );
}
