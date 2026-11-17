// Copyright © 2025-2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC - https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Show Recovery Phrase is its own page for one wallet, opened from Wallet
// Details: one page with the warning card, the concealed word grid, the
// password under it and the Reveal Recovery Phrase button at the bottom. The
// right password reveals the grid in place, by the button or by a tap on the
// concealed area; no or a wrong password shows the error in the field. Back,
// 60 s and window blur wipe the phrase.

import { useCallback, useEffect, useRef, useState } from 'react';
import { FormPage, Icon, Input, Notice, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { FormAction } from '../components/formStandard/index.js';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useProtectedScreen } from '../utils/screenGuard.js';
import { useBackHandler } from '../../ui/backStack.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/createWallet.js';
import '../../i18n/locales/en/importWallet.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/settings.js';

const REVEAL_TIMEOUT_MS = 60_000;
// Until the password checks out the page holds no phrase at all: the grid gets
// only this stand-in for its cell count (twelve, since nothing outside the
// seed records a wallet's word count) and draws its own blurred filler words.
const PLACEHOLDER_PHRASE = Array(12).fill('x').join(' ');

/**
 * @param {object} props
 * @param {string} props.walletId
 * @param {string} [props.walletName]
 * @param {() => void} props.onBack
 */
export function ViewRecoveryPhrase({ walletId, walletName = '', onBack }) {
    useProtectedScreen();
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [stage, setStage] = useState(/** @type {'warning' | 'submitting' | 'shown'} */ ('warning'));
    const [password, setPassword] = useState('');
    const [submitError, setSubmitError] = useState(/** @type {string | null} */ (null));
    const [passwordWrong, setPasswordWrong] = useState(false);
    const [mnemonic, setMnemonic] = useState('');
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    const attemptRef = useRef(0);

    const clear = useCallback(() => {
        attemptRef.current += 1;
        setStage('warning');
        setPassword('');
        setSubmitError(null);
        setPasswordWrong(false);
        setMnemonic('');
    }, []);
    const leave = useCallback(() => { clear(); onBack(); }, [clear, onBack]);
    useBackHandler(stage === 'shown' ? leave : undefined);

    useEffect(() => {
        if (stage !== 'shown') return undefined;
        const id = setTimeout(clear, REVEAL_TIMEOUT_MS);
        const onBlur = () => clear();
        window.addEventListener('blur', onBlur);
        return () => { clearTimeout(id); window.removeEventListener('blur', onBlur); };
    }, [stage, clear]);

    async function handleSubmit(event) {
        event?.preventDefault?.();
        if (stage !== 'warning') return;
        if (!password) {
            setSubmitError('Enter your wallet password.');
            passwordRef.current?.focus();
            return;
        }
        if (typeof messaging?.revealMnemonicRequest !== 'function') {
            setSubmitError('Recovery phrase reveal is not wired in this shell yet.');
            return;
        }
        const attempt = ++attemptRef.current;
        setStage('submitting');
        setSubmitError(null);
        try {
            const r = await messaging.revealMnemonicRequest({ walletId, password });
            if (attempt !== attemptRef.current) return;
            setPassword('');
            setMnemonic(r?.mnemonic || '');
            setStage('shown');
        } catch (err) {
            if (attempt !== attemptRef.current) return;
            const name = err?.name || '';
            if (name === 'WrongPasswordError' || name === 'InvalidPasswordError' || name === 'AeadAuthError') {
                setSubmitError('The wallet password is not right.');
                setPasswordWrong(true);
            } else if (name === 'NoMnemonicForWifOnlyError') {
                setSubmitError('This wallet was imported from a private key only. There is no recovery phrase to show.');
            } else {
                setSubmitError('Could not show the recovery phrase. Try again.');
            }
            setStage('warning');
            setTimeout(() => passwordRef.current?.focus(), 0);
        }
    }

    const passwordError = submitError && (passwordWrong || !password) ? submitError : undefined;
    // An error the password field does not show goes in the form's status slot.
    const showFormLevelError = Boolean(submitError) && !passwordError;
    const header = <PageHeader onBack={leave} title={t('createWallet.showRecoveryPhraseTitle')} subtitle={walletName || null} />;

    const shown = stage === 'shown';

    // One page: the warning, the password and the concealed grid sit together.
    // The grid shows blurred placeholder words until the password checks out,
    // then the real words in the same box.
    return (
        <Screen variant={variant} header={header}>
            <FormPage
                label={t('importWallet.recoveryPhrase')}
                onSubmit={handleSubmit}
                actions={shown ? null : (
                    <FormAction icon={<Icon.EyeIcon />} loading={stage === 'submitting'}>
                        {t('settings.backup.revealRecoveryPhraseAction')}
                    </FormAction>
                )}
                status={showFormLevelError ? <Notice tone="danger">{submitError}</Notice> : null}
            >
                {/* The recovery phrase warning is a static danger notice (U71,
                    the Notice Standard): red, part of the page from the first paint. */}
                <Notice tone="danger" role="note">
                    {t('createWallet.recoveryPhraseNotice')} {t('createWallet.recoveryPhraseScreenShare')}
                </Notice>
                <MnemonicGrid
                    mnemonic={shown ? mnemonic : PLACEHOLDER_PHRASE}
                    variant={variant === 'popup' ? 'small' : 'full'}
                    startRevealed={shown}
                    onRevealRequest={handleSubmit}
                    revealLoading={stage === 'submitting'}
                    hideRevealAction
                />
                <Input
                    ref={passwordRef}
                    type="password"
                    label={t('send.gated.passwordLabel')}
                    help={t('createWallet.showRecoveryPhrasePasswordHelp')}
                    value={password}
                    error={passwordError}
                    onChange={(e) => { setPassword(e.target.value); setSubmitError(null); setPasswordWrong(false); }}
                    autoComplete="current-password"
                    disabled={stage === 'submitting' || shown}
                />
            </FormPage>
        </Screen>
    );
}
