// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { t } from '../../../core/src/i18n/index.js';
import { addEnglish } from '../../../core/src/i18n/store.js';
import { linkHandoffModel } from './linkHandoffModel.js';

const KEYS = Object.freeze({
    action: Object.freeze({
        send: 'linkHandoff.action.send',
        receive: 'linkHandoff.action.receive',
        execute: 'linkHandoff.action.execute',
        request: 'linkHandoff.action.request',
        other: 'linkHandoff.action.other',
    }),
    title: 'linkHandoff.title',
    intro: 'linkHandoff.intro',
    walletLink: 'linkHandoff.walletLink',
    choices: 'linkHandoff.choices',
    openApp: 'linkHandoff.openApp',
    continueWeb: 'linkHandoff.continueWeb',
    getApp: 'linkHandoff.getApp',
    safety: 'linkHandoff.safety',
});

addEnglish({
    [KEYS.action.send]: 'This link fills in a payment for you to review.',
    [KEYS.action.receive]: 'This link opens a receiving address.',
    [KEYS.action.execute]: 'This link fills in a contract call for you to review.',
    [KEYS.action.request]: 'This link asks you to review and approve a request from a site.',
    [KEYS.action.other]: 'This link opens something in the wallet.',
    [KEYS.title]: 'Open in the wallet',
    [KEYS.intro]: '{action} It has not done anything yet, and it will not until you open it and confirm.',
    [KEYS.walletLink]: 'Wallet link',
    [KEYS.choices]: 'Choose where to open the wallet link',
    [KEYS.openApp]: 'Open in the XChain Wallet app',
    [KEYS.continueWeb]: 'Continue in the web wallet',
    [KEYS.getApp]: 'Get the app',
    [KEYS.safety]:
        'A link never unlocks, signs, sends or shares anything by itself; a request link lands on the approval page, where the only ways forward are Approve, with the password, and Reject, and the answer goes only to the site that page names.',
});

export function LinkHandoff() {
    const model = linkHandoffModel(location.search);
    if (!model) return null;

    return (
        <main aria-labelledby="link-handoff-title">
            <section data-link-action={model.action}>
                <h1 id="link-handoff-title">{t(KEYS.title)}</h1>
                <p>{t(KEYS.intro, { action: t(KEYS.action[model.action]) })}</p>
                <p aria-label={t(KEYS.walletLink)}><code>{model.payload}</code></p>
                <nav aria-label={t(KEYS.choices)}>
                    <a href={model.appHref}>{t(KEYS.openApp)}</a>
                    <a href={model.webHref}>{t(KEYS.continueWeb)}</a>
                    <a href={model.getHref}>{t(KEYS.getApp)}</a>
                </nav>
                <p>{t(KEYS.safety)}</p>
            </section>
        </main>
    );
}
