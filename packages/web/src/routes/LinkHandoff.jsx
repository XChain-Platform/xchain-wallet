// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../../../core/src/i18n/index.js';
import '../../../core/src/i18n/locales/en/components.js';
import '../../../core/src/i18n/locales/en/execute.js';
import '../../../core/src/i18n/locales/en/extension.js';
import '../../../core/src/i18n/locales/en/settings.js';
import '../../../core/src/i18n/locales/en/walletMenu.js';
import '../../../core/src/i18n/locales/en/watch.js';
import { linkHandoffModel } from './linkHandoffModel.js';

function actionCopy(action) {
    if (action === 'send') return t('uri.intent.send');
    if (action === 'receive') return t('uri.intent.receive');
    if (action === 'execute') return t('execute.title');
    if (action === 'request') return t('extension.approval.title');
    return t('uri.intent.unknown');
}

export function LinkHandoff() {
    const model = linkHandoffModel(location.search);
    if (!model) return null;

    return (
        <main aria-labelledby="link-handoff-title">
            <section data-link-action={model.action}>
                <h1 id="link-handoff-title">{t('walletMenu.row.linkActions')}</h1>
                <p>{actionCopy(model.action)}</p>
                <p aria-label={t('components.confirmSummary.verbLink')}><code>{model.payload}</code></p>
                <nav aria-label={t('components.layoutModeToggle.openAs')}>
                    <a href={model.appHref}>{t('watch.openOnPhone')}</a>
                    <a href={model.webHref}>{t('settings.about.openWebWallet')}</a>
                    <a href={model.getHref}>{t('components.gatedFileViewer.download')}</a>
                </nav>
                <p>{t('extension.sign.trustSource')}</p>
            </section>
        </main>
    );
}
