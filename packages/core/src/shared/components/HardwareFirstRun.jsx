// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// Connect Hardware Wallet on a fresh install: the three connect steps, then
// the standard Set Password page (outside the step count), then the vault is
// created holding the hardware wallet. The connect form stays mounted while
// the password page shows, so Back from it returns to step 3 as it was.

import { useEffect, useRef, useState } from 'react';
import { Button, FormErrorSummary, FormPage, Icon, Input, PageHeader, Screen } from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { PairSignerForm } from '../routes/PairSignerForm.jsx';
import { userFacingMessage } from '../utils/userFacingMessage.js';
import { useDocumentTitleSection } from '../hooks/useDocumentTitle.js';
import { DURESS_PASSWORD_COLLISION_MESSAGE, walletPasswordCollidesWithDuress } from '../../flows/duressPassphrase.js';
import { pairedSessionSigner } from '../../signers/hardwareReconnect.js';
import { t } from '../../i18n/index.js';
import '../../i18n/locales/en/createWallet.js';
import '../../i18n/locales/en/hardwareConnect.js';
import '../../i18n/locales/en/importWallet.js';

const MIN_PASSWORD_LENGTH = 8;
const SET_PASSWORD_TITLE = 'Set Password';
const PASSWORD_HELP = 'Your password opens this app on this device. Your keys stay on your hardware wallet, '
    + `so if you forget the password you can connect it again. At least ${MIN_PASSWORD_LENGTH} characters.`;
const CONFIRM_HELP = 'Type the same password again so a typo never locks you out.';

/**
 * @param {object} props
 * @param {null | (() => Promise<any>)} [props.pairTrezor]
 * @param {null | (() => Promise<any>)} [props.pairLedger]
 * @param {() => void} props.onBack        leaves the flow (back to Welcome)
 * @param {(walletId: string | null) => void} props.onCreated  the vault exists and is unlocked
 * @param {(signerId: string, signer: any) => void} [props.onSignerPaired]  hands the open device to the shell's signer bridge
 * @param {() => void} [props.onOpenInTab]  the extension popup moves the flow to a tab, where WebHID can prompt
 */
export function HardwareFirstRun({ pairTrezor, pairLedger, onBack, onCreated, onSignerPaired, onOpenInTab }) {
    const { messaging, shell } = useMessaging();
    const variant = screenVariantFor(shell);
    const [draft, setDraft] = useState(/** @type {any} */ (null));

    return (
        <>
            <div hidden={Boolean(draft)} data-hardware-first-run="connect">
                <PairSignerForm
                    mode="first"
                    pairTrezor={pairTrezor}
                    pairLedger={pairLedger}
                    onBack={onBack}
                    onDeviceReady={setDraft}
                    onOpenInTab={onOpenInTab}
                />
            </div>
            {draft ? (
                <HardwareSetPassword
                    variant={variant}
                    messaging={messaging}
                    draft={draft}
                    onBack={() => setDraft(null)}
                    onCreated={onCreated}
                    onSignerPaired={onSignerPaired}
                />
            ) : null}
        </>
    );
}

function HardwareSetPassword({ variant, messaging, draft, onBack, onCreated, onSignerPaired }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState(/** @type {{ id: string, label: string, message: string } | null} */ (null));
    const [attempt, setAttempt] = useState(0);
    const [saving, setSaving] = useState(false);
    const passwordRef = useRef(/** @type {HTMLInputElement | null} */ (null));
    useDocumentTitleSection(SET_PASSWORD_TITLE);

    useEffect(() => {
        passwordRef.current?.focus();
    }, []);

    function fail(id, label, message) {
        setError({ id, label, message });
        setAttempt((n) => n + 1);
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (saving) return;
        if (password.length < MIN_PASSWORD_LENGTH) {
            fail('hw-password', t('common.password'), `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
        }
        if (!confirm) {
            fail('hw-confirm', t('importWallet.confirmPassword'), 'Confirm your password.');
            return;
        }
        if (password !== confirm) {
            fail('hw-confirm', t('importWallet.confirmPassword'), 'Passwords do not match.');
            return;
        }
        if (walletPasswordCollidesWithDuress(password)) {
            fail('hw-password', t('common.password'), DURESS_PASSWORD_COLLISION_MESSAGE);
            return;
        }
        if (typeof messaging?.createHardwareWallet !== 'function') {
            fail('hw-password', t('common.password'), 'This app cannot create a hardware wallet here.');
            return;
        }
        setError(null);
        setSaving(true);
        try {
            const result = await messaging.createHardwareWallet({
                name: draft.name,
                device: draft.device,
                accounts: draft.accounts,
                password,
            });
            const signerId = result?.signer?.id;
            if (onSignerPaired && signerId && draft.signer) {
                // The saved record rides along, so the bridge has the Ledger's
                // per-chain identities before the shell lists signers again.
                try { onSignerPaired(signerId, pairedSessionSigner(result.signer, draft.signer)); } catch { /* the bridge reopens the device on the first sign */ }
            }
            setSaving(false);
            onCreated(result?.walletId ?? result?.wallet?.id ?? null);
        } catch (err) {
            setSaving(false);
            fail('hw-password', t('common.password'), userFacingMessage(err, 'Could not create the wallet. Try again.'));
        }
    }

    const header = (
        <PageHeader
            nested
            onBack={onBack}
            backDisabled={saving}
            backLabel={t('hardwareConnect.accounts.backToAccounts')}
            title={SET_PASSWORD_TITLE}
        />
    );

    return (
        <Screen variant={variant} header={header}>
            <FormPage
                label={SET_PASSWORD_TITLE}
                onSubmit={handleSubmit}
                status={error ? (
                    <FormErrorSummary
                        errors={[{ id: error.id, label: error.label, message: error.message }]}
                        focusKey={attempt}
                    />
                ) : null}
                actions={(
                    <Button
                        type="submit"
                        variant="success"
                        loading={saving}
                        disabled={saving}
                        icon={<Icon.CheckIcon />}
                    >
                        {t('createWallet.createWallet')}
                    </Button>
                )}
            >
                <Input
                    id="hw-password"
                    ref={passwordRef}
                    type="password"
                    label={t('common.password')}
                    help={PASSWORD_HELP}
                    value={password}
                    onChange={(e) => {
                        setPassword(e.target.value);
                        if (error) setError(null);
                    }}
                    autoComplete="new-password"
                />
                <Input
                    id="hw-confirm"
                    type="password"
                    label={t('importWallet.confirmPassword')}
                    help={CONFIRM_HELP}
                    value={confirm}
                    onChange={(e) => {
                        setConfirm(e.target.value);
                        if (error) setError(null);
                    }}
                    autoComplete="new-password"
                />
            </FormPage>
        </Screen>
    );
}
