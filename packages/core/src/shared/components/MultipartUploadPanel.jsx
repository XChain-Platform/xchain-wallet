// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/components.js';
import { Button } from '../../ui/Button.jsx';
import cardStyles from '../../ui/Card.module.css';

const layout = {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--xc-space-3)',
};

const cardLayout = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 'var(--xc-space-3)',
};

const body = { flex: '1 1 14rem', minWidth: 0 };
const heading = {
    margin: 0,
    color: 'var(--xc-text)',
    fontSize: 'var(--xc-type-card-title-size)',
    fontWeight: 'var(--xc-type-card-title-weight)',
};
const copy = {
    margin: 'var(--xc-space-1) 0 0',
    color: 'var(--xc-text-muted)',
    fontSize: 'var(--xc-type-body-size)',
};
const actions = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--xc-space-2)',
};

function ActiveUpload({ totalParts, transactions, currentPart, stage }) {
    if (stage !== 'sending' && stage !== 'assembling') return null;
    const title = stage === 'sending'
        ? `Uploading part ${currentPart} of ${totalParts}`
        : 'Waiting for file assembly';
    const detail = stage === 'assembling'
        ? `All ${totalParts} parts uploaded. Waiting for the file to finish assembling.`
        : `${totalParts} parts, ${transactions} transactions`;
    return (
        <section className={cardStyles.card} style={cardLayout} role="status" aria-live="polite">
            <div style={body}>
                <h2 style={heading}>{title}</h2>
                <p style={copy}>{detail}</p>
                {stage === 'assembling' ? (
                    <p style={copy}>{t('components.multipartUploadPanel.partsAndTransactions', { parts: totalParts, transactions })}</p>
                ) : null}
            </div>
        </section>
    );
}

function paidTransactionText(count) {
    return `${count} ${count === 1 ? 'transaction' : 'transactions'} already paid`;
}

function UnfinishedUpload({ upload, onContinue, onDiscard }) {
    return (
        <article className={cardStyles.card} style={cardLayout} aria-label={upload.name}>
            <div style={body}>
                <h3 style={heading}>{upload.name}</h3>
                <p style={copy}>{t('components.multipartUploadPanel.partsUploaded', { done: upload.partsSent, total: upload.totalParts })}</p>
                <p style={copy}>{t('components.multipartUploadPanel.chooseSameFile')}</p>
            </div>
            <div style={actions}>
                <Button size="sm" variant="primary" onClick={() => onContinue?.(upload.id)}>
                    {t('adsNotice.continue')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => onDiscard?.(upload.id)}>
                    {t('components.multipartUploadPanel.discard', { paid: paidTransactionText(upload.paidTransactions) })}
                </Button>
            </div>
        </article>
    );
}

function UnfinishedUploads({ unfinished, onContinue, onDiscard }) {
    if (!unfinished?.length) return null;
    return (
        <section style={layout} aria-label={t('components.multipartUploadPanel.unfinishedUploads')}>
            <h2 style={heading}>{t('components.multipartUploadPanel.unfinishedUploads')}</h2>
            {unfinished.map((upload) => (
                <UnfinishedUpload
                    key={upload.id}
                    upload={upload}
                    onContinue={onContinue}
                    onDiscard={onDiscard}
                />
            ))}
        </section>
    );
}

export function MultipartUploadPanel({
    totalParts,
    transactions,
    currentPart,
    stage,
    unfinished = [],
    onContinue,
    onDiscard,
}) {
    const hasActiveUpload = stage === 'sending' || stage === 'assembling';
    if (!hasActiveUpload && unfinished.length === 0) return null;
    return (
        <div style={layout}>
            <ActiveUpload
                totalParts={totalParts}
                transactions={transactions}
                currentPart={currentPart}
                stage={stage}
            />
            <UnfinishedUploads
                unfinished={unfinished}
                onContinue={onContinue}
                onDiscard={onDiscard}
            />
        </div>
    );
}
