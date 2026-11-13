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
// Details and laid out like Show Private Key: a form with the warning card,
// password and I understand, then the phrase. Back wipes the phrase.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, FormPage, Icon, Input, ListPage, PageHeader, Screen, StatusMessage } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useProtectedScreen } from '../utils/screenGuard.js';
import { RECOVERY_PHRASE_WARNING } from '../utils/securityMomentCopy.js';
import { useBackHandler } from '../../ui/backStack.js';
import { MnemonicGrid } from '../components/MnemonicGrid.jsx';
import { WarningCard, WarningLine } from '../components/WarningCard.jsx';

const REVEAL_TIMEOUT_MS = 60_000;

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
        event.preventDefault();
        if (stage === 'submitting') return;
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
    const header = <PageHeader onBack={leave} title="Show Recovery Phrase" />;

    if (stage === 'shown') {
        return (
            <Screen variant={variant} header={header}>
                <FormPage label="Recovery phrase" onSubmit={(e) => e.preventDefault()}>
                    {walletName ? <WarningLine style={{ textAlign: 'center' }}>{walletName}</WarningLine> : null}
                    <MnemonicGrid mnemonic={mnemonic} variant={variant === 'popup' ? 'small' : 'full'} startRevealed />
                    <WarningLine critical>{RECOVERY_PHRASE_WARNING}</WarningLine>
                </FormPage>
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={header}>
            <FormPage
                label="Before you continue"
                onSubmit={handleSubmit}
                status={showFormLevelError ? <StatusMessage variant="error">{submitError}</StatusMessage> : null}
                actions={(
                    <Button type="submit" variant="success" icon={<Icon.ThumbsUpIcon />} loading={stage === 'submitting'} disabled={stage === 'submitting'}>
                        I Understand
                    </Button>
                )}
            >
                <WarningCard>
                    <WarningLine>
                        You are about to see the recovery phrase for {walletName ? <strong>{walletName}</strong> : 'this wallet'}.
                    </WarningLine>
                    <WarningLine>
                        Enter your wallet password below and press I understand to see it.
                    </WarningLine>
                    <WarningLine critical>{RECOVERY_PHRASE_WARNING}</WarningLine>
                    <WarningLine critical>
                        If you are screen-sharing or recording, stop now before you reveal the phrase.
                    </WarningLine>
                </WarningCard>
                <Input
                    ref={passwordRef}
                    type="password"
                    label="Wallet password"
                    value={password}
                    error={passwordError}
                    onChange={(e) => { setPassword(e.target.value); setSubmitError(null); setPasswordWrong(false); }}
                    autoComplete="current-password"
                    disabled={stage === 'submitting'}
                />
            </FormPage>
        </Screen>
    );
}
