// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useProtectedScreen } from '../utils/screenGuard.js';
import {
    Screen,
    Button,
    Checkbox,
    FieldIconButton,
    FormPage,
    Input,
    Textarea,
    Icon,
    PageHeader,
    QrScanner,
    StatusMessage,
    Tabs,
    FormErrorSummary,
    useFormErrors,
    IconSelect,
    Select,
    Switch,
} from '@xchain-wallet/core/ui';
import { useMessaging, screenVariantFor } from '../useMessaging.js';
import { useToast } from '../components/ToastHost.jsx';
import homeTabsStyles from '../components/HomeTabs.module.css';
import { AdsNotice } from '../components/AdsNotice.jsx';
import { FileField } from '../components/FileField.jsx';
import { IdentityAvatar } from '../components/WalletIdentity.jsx';
import { useDropZone } from '../hooks/useDropZone.js';
import { useSupportedChains } from '../hooks/useSupportedChains.js';
import { activeNetworkLabel } from '../utils/activeNetworkSwitch.js';
import { formatBytes } from '../utils/formatBytes.js';
import { parseBackupEnvelope } from '../../crypto/backup.js';
import { englishWordlist } from '../../crypto/mnemonic.js';
import { COUNTERWALLET_WORDLIST } from '../../crypto/counterwallet.js';
import { normalizeRecoveryPhrase } from '../../crypto/recoveryPhrase.js';
import * as branding from '../../branding/branding.js';
import {
    importPhraseFormat,
    importPhraseFormatArg,
    importPhraseRefusal,
} from '../utils/importPhraseCheck.js';
// The flows this screen calls throw function-prefixed preconditions
// ("importMnemonic: mnemonic is required"), and `|| fallback` only fires on an
// EMPTY message, so those reached the recovery screen verbatim.
import { isVaultConflictError, userFacingMessage } from '../utils/userFacingMessage.js';
import { isWalletExistsError } from '../utils/walletExistsError.js';
import { NAME_MAX_LENGTH, hasVisibleText, nameLength } from '../../util/display_name.js';
import { takeForgotPasswordRestoreLane } from '../utils/forgotPasswordRecovery.js';
import { useBackHandler } from '../../ui/backStack.js';
import { useDocumentTitleSection } from '../hooks/useDocumentTitle.js';
import { useOwnWalletWriteHold } from '../hooks/useOwnWalletWriteHold.js';
import { DURESS_PASSWORD_COLLISION_MESSAGE, walletPasswordCollidesWithDuress } from '../../flows/duressPassphrase.js';
import { addressTypeLabel } from '../utils/addressTypeLabel.js';
import {
    WIF_IMPORT_ADDRESS_TYPES,
    defaultWifImportAddressType,
    wifImportPreview,
    wifImportVersionByte,
} from '../utils/wifImportPreview.js';
// Which role refused a restore's password, read from the bare message the
// shell boundary leaves, so the screen can ask for exactly one more password.
import { restoreFailureKind } from '../../flows/restorePasswordCopy.js';
import styles from './ImportWallet.module.css';
import { formatOrList, getFormatLocale, t } from '../../i18n/index.js';
import '../../i18n/locales/en/adsNotice.js';
import '../../i18n/locales/en/importWallet.js';
import '../../i18n/locales/en/renameWallet.js';
import '../../i18n/locales/en/send.js';
import '../../i18n/locales/en/verifySignature.js';

const MIN_PASSWORD_LENGTH = 8;
const CONFIRM_PASSWORD_MESSAGE = 'Confirm your password.';
const ACCEPTED_WORD_COUNTS = [12, 15, 18, 21, 24];
const BIP39_WORDS = new Set(englishWordlist);
const COUNTERWALLET_WORDS = new Set(COUNTERWALLET_WORDLIST);
const MAX_WORD_SUGGESTIONS = 5;

function normalizePhraseEntry(value) {
    return normalizeRecoveryPhrase(value);
}

function wordRangeAt(value, cursor) {
    const safeCursor = Math.min(Math.max(cursor, 0), value.length);
    let start = safeCursor;
    let end = safeCursor;
    while (start > 0 && !/\s/.test(value[start - 1])) start -= 1;
    while (end < value.length && !/\s/.test(value[end])) end += 1;
    return { start, end, prefix: value.slice(start, safeCursor).toLowerCase() };
}

// The field ids a restore refusal points at, so focus lands on the field
// whose red sentence explains it.
const BACKUP_FIELD_IDS = Object.freeze({
    file: 'xc-backup-file',
    password: 'import-backup-file-password',
    wallet: 'import-backup-wallet-password',
    device: 'import-backup-device-password',
});

/**
 * What the chosen file's plaintext header says about it, for the summary card.
 * The header is not authenticated (only the payload is), so every field is
 * treated as untrusted display text: a missing, blank, invisible or overlong
 * name falls back, and a date that does not parse is left out.
 *
 * @param {{ walletName?: unknown, createdAt?: unknown }} envelope
 * @returns {{ walletName: string, backedUp: string | null }}
 */
function backupHeaderSummary(envelope) {
    const rawName = typeof envelope?.walletName === 'string' ? envelope.walletName.trim() : '';
    const walletName = rawName.length > 0 && hasVisibleText(rawName)
        ? Array.from(rawName).slice(0, NAME_MAX_LENGTH).join('')
        : t('importWallet.backup.unnamed');
    const created = typeof envelope?.createdAt === 'string' ? Date.parse(envelope.createdAt) : Number.NaN;
    let backedUp = null;
    if (Number.isFinite(created)) {
        try {
            backedUp = new Intl.DateTimeFormat(getFormatLocale(), {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
            }).format(new Date(created));
        } catch {
            backedUp = null;
        }
    }
    return { walletName, backedUp };
}

/**
 * The copy for a restore failure that is about the file rather than a
 * password, or null when the failure is not one of those.
 *
 * @param {import('../../flows/restorePasswordCopy.js').RestoreFailureKind} kind
 * @returns {string | null}
 */
function backupFileFailureCopy(kind) {
    if (kind === 'not-backup') return t('importWallet.backup.error.notBackup');
    if (kind === 'newer') return t('importWallet.backup.error.newer');
    if (kind === 'damaged' || kind === 'no-kdf') return t('importWallet.backup.error.damaged');
    return null;
}

/**
 * One line for the toast after an import, or null when there is nothing to
 * say. Only a restore that actually wrote something earns a message: a seed
 * that never published, a chain that was unreachable, and a payload whose
 * every record already matched all read as "nothing restored" to the user.
 *
 * @param {{ restored?: boolean, contactsAdded?: number, contactsUpdated?: number, addressesUpdated?: number } | null | undefined} labelSync
 * @returns {string | null}
 */
function labelSyncRestoredMessage(labelSync) {
    if (!labelSync || labelSync.restored !== true) return null;
    const contacts = Number(labelSync.contactsAdded || 0) + Number(labelSync.contactsUpdated || 0);
    const labels = Number(labelSync.addressesUpdated || 0);
    if (contacts === 0 && labels === 0) return null;
    const parts = [];
    if (contacts > 0) parts.push(contacts === 1 ? '1 contact' : `${contacts} contacts`);
    if (labels > 0) parts.push(labels === 1 ? '1 address label' : `${labels} address labels`);
    return `Restored ${parts.join(' and ')} from your published labels.`;
}

/**
 * Import an existing wallet via mnemonic. Accepts BIP39 (12/15/18/21/24
 * words) and Counterwallet-legacy (12 words). The core
 * `importMnemonic` flow auto-detects format.
 *
 * The Wallet type field selects BIP39 or the legacy Counterwallet format.
 * `variant="freewallet"` remains as a deep-link compatibility input and only
 * preselects the combined FreeWallet / PartyWallet choice in that field.
 *
 * @param {object} props
 * @param {() => void} props.onBack
 * @param {(wallet?: { id: string, name: string }) => void | Promise<void>} props.onImported refreshes App.jsx state
 * @param {'default' | 'freewallet'} [props.variant]
 * @param {'fresh' | 'add'} [props.mode]   'fresh' → first wallet (pre-host `wallet.import`); 'add' → adds to an open vault (`wallet.add.import`). Defaults to 'fresh'.
 * @param {'mnemonic' | 'backup'} [props.initialLane]
 * @param {(state: { lane: 'mnemonic' | 'backup' }) => void} [props.onOpenInTab]
 * @param {{ report: (holding: boolean) => void }} [props.ownWriteGuard]   told while this lane's own first-wallet write runs or its notice shows
 */
export function ImportWallet({
    onBack,
    onImported: handleImported,
    variant: importVariant = 'default',
    mode = 'fresh',
    initialLane = 'mnemonic',
    onOpenInTab,
    ownWriteGuard,
}) {
    // S4: The phrase is TYPED here, and a keyboard-visible screen recording is
    // as good as a screenshot of it.
    // No-op on every shell that installs no screen guard (web, extension,
    // desktop): a browser tab cannot stop a screenshot and must not pretend to.
    useProtectedScreen();

    const { messaging, shell } = useMessaging();
    const { showToast } = useToast();
    const variant = screenVariantFor(shell);
    const isFull = variant === 'full';

    const [walletType, setWalletType] = useState(() => (
        importVariant === 'freewallet' ? 'freewallet' : 'bip39'
    ));
    const isLegacyType = walletType === 'freewallet';
    const acceptedWordCounts = isLegacyType ? [12] : ACCEPTED_WORD_COUNTS;
    // Recovery phrase, private-key, and encrypted-backup imports share this
    // route. A legacy deep link starts on the phrase lane with its type chosen.
    const [lane, setLane] = useState(() =>
        /** @type {'mnemonic' | 'wif' | 'backup'} */ (
            importVariant !== 'freewallet' && takeForgotPasswordRestoreLane(initialLane) === 'backup'
                ? 'backup'
                : 'mnemonic'
        ),
    );
    const defaultWalletName = 'Imported Wallet';
    const [name, setName] = useState(defaultWalletName);
    // A cleared or blank name field names the wallet by its default; the vault refuses an empty name.
    const walletName = name.trim() || defaultWalletName;
    const [mnemonic, setMnemonic] = useState('');
    const [mnemonicCursor, setMnemonicCursor] = useState(0);
    const [wif, setWif] = useState('');
    const [wifCoin, setWifCoin] = useState('');
    const [wifNetwork, setWifNetwork] = useState('');
    const [wifAddressType, setWifAddressType] = useState('');
    const [wifWarningAck, setWifWarningAck] = useState(false);
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [backupContent, setBackupContent] = useState('');
    // What the summary card shows about the chosen file: its name and size,
    // and the wallet name and backup date from the file's plaintext header.
    const [backupFile, setBackupFile] = useState(
        /** @type {{ name: string, size: number, walletName: string, backedUp: string | null } | null} */ (null),
    );
    // A restore reaches up to three secrets: the one that opens the FILE, the
    // one that opens the WALLET's own seal inside it, and (adding to an open
    // vault) the one this device already unlocks with. Most people use one
    // password for all of them, so the screen asks once and tries it in every
    // role, and asks for another only when a role refuses it: the wallet field
    // after the file opened but the wallet stayed locked, the device field
    // after an open vault refused it. A fresh install has no device password
    // of its own: the restored wallet keeps its own password here.
    const [backupPassword, setBackupPassword] = useState('');
    const [backupWalletPassword, setBackupWalletPassword] = useState('');
    const [backupDevicePassword, setBackupDevicePassword] = useState('');
    const [backupNeedsWalletPassword, setBackupNeedsWalletPassword] = useState(false);
    const [backupNeedsDevicePassword, setBackupNeedsDevicePassword] = useState(false);
    // The form error standard: one error map for the whole form. A submit validates every
    // field into it, the notice at the top lists the problems, each failing field is
    // outlined on its border, and a field drops its own entry when it changes.
    const formErrors = useFormErrors();
    // The one field a restore refusal is about, shown as a red sentence under
    // that field (G22); it is that field's entry in the map. Form-level failures
    // use the map's 'form' entry (`error`).
    const backupFieldName = /** @type {keyof typeof BACKUP_FIELD_IDS | undefined} */ (
        Object.keys(BACKUP_FIELD_IDS).find((field) => formErrors.errors[BACKUP_FIELD_IDS[field]])
    );
    const backupFieldError = backupFieldName
        ? { field: backupFieldName, message: formErrors.errors[BACKUP_FIELD_IDS[backupFieldName]] }
        : null;
    /** @param {{ field: keyof typeof BACKUP_FIELD_IDS, message: string } | null} entry  null drops every backup field's entry */
    function setBackupFieldError(entry) {
        if (entry) {
            formErrors.validate({ [BACKUP_FIELD_IDS[entry.field]]: entry.message });
            return;
        }
        for (const id of Object.values(BACKUP_FIELD_IDS)) formErrors.clear(id);
    }
    // §15.6: optional 25th-word BIP39 passphrase. Hidden behind a toggle so
    // users who never set one don't have to read the warning copy.
    // Legacy imports follow the Counterwallet code path, which
    // rejects a passphrase, so we don't expose the toggle there.
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [bip39Passphrase, setBip39Passphrase] = useState('');
    // §20: the imported wallet's mode, chosen once here; Normal by default.
    // A restored backup carries its own wallet's mode instead.
    // A failure that names no field (a refused scan or drop, the vault refusing the
    // import) is the map's 'form' entry; setting null drops only that entry.
    const error = formErrors.errors.form ?? null;
    function setError(message) {
        if (message) formErrors.fail(message);
        else formErrors.clear('form');
    }
    // The phrase also changes by a scan, a paste, a dropped file or a suggested word, none
    // of which fire the field's own change handler, so its entry leaves here.
    const clearFormError = formErrors.clear;
    useEffect(() => { clearFormError('xc-mnemonic'); }, [mnemonic, clearFormError]);
    const [validationAttempt, setValidationAttempt] = useState(0);
    const [busy, setBusy] = useState(false);
    const [continuing, setContinuing] = useState(false);
    const [noticeError, setNoticeError] = useState(/** @type {string | null} */ (null));
    // §36.1: an import ends on the same ADS notice a created wallet does,
    // and only its Continue hands control back to App.
    const [adsNotice, setAdsNotice] = useState(false);
    // Another window or tab made this device's first wallet while this one
    // was filled in: nothing typed here can be imported any more, and the way
    // on is that wallet's lock screen.
    const [walletElsewhere, setWalletElsewhere] = useState(false);
    useOwnWalletWriteHold(ownWriteGuard, mode === 'fresh' && (busy || adsNotice));
    const [scanning, setScanning] = useState(false);
    // The camera box holds a message (denied, no camera) instead of a picture.
    const [scanMessage, setScanMessage] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const textareaRef = useRef(/** @type {HTMLTextAreaElement | null} */ (null));
    const headingRef = useRef(/** @type {HTMLHeadingElement | null} */ (null));
    const adsContinuedRef = useRef(false);
    const activeLaneRef = useRef(lane);
    const inputGenerationRef = useRef(0);
    const busyRef = useRef(false);
    const continuePendingRef = useRef(false);
    const importedWalletRef = useRef(/** @type {{ id: string, name: string } | null} */ (null));
    const mountedRef = useRef(true);
    const inputGeneration = inputGenerationRef.current;
    const supportedChains = useSupportedChains();
    const wifChains = useMemo(
        () => supportedChains.filter(
            (descriptor) => Number.isInteger(descriptor.wifVersionByte),
        ),
        [supportedChains],
    );
    const wifCoinFamilies = useMemo(() => {
        const families = new Map();
        for (const descriptor of wifChains) {
            const current = families.get(descriptor.coin);
            if (!current || (descriptor.networkKind === 'mainnet' && current.networkKind !== 'mainnet')) {
                families.set(descriptor.coin, descriptor);
            }
        }
        const preferred = new Map(['bitcoin', 'litecoin', 'dogecoin'].map((coin, index) => [coin, index]));
        return [...families.values()].sort((a, b) => (
            (preferred.get(a.coin) ?? Number.MAX_SAFE_INTEGER)
            - (preferred.get(b.coin) ?? Number.MAX_SAFE_INTEGER)
        ));
    }, [wifChains]);
    const effectiveWifCoin = wifCoin || wifCoinFamilies[0]?.coin || '';
    const wifCoinChains = useMemo(() => {
        const networks = new Map();
        for (const descriptor of wifChains) {
            if (descriptor.coin === effectiveWifCoin && !networks.has(descriptor.networkKind)) {
                networks.set(descriptor.networkKind, descriptor);
            }
        }
        return [...networks.values()];
    }, [effectiveWifCoin, wifChains]);
    const effectiveWifNetwork = wifCoinChains.some(
        (descriptor) => descriptor.networkKind === wifNetwork,
    )
        ? wifNetwork
        : (wifCoinChains.find((descriptor) => descriptor.networkKind === 'mainnet')?.networkKind
            || wifCoinChains[0]?.networkKind
            || '');
    const wifDescriptor = wifCoinChains.find(
        (descriptor) => descriptor.networkKind === effectiveWifNetwork,
    ) || null;
    const effectiveWifChainId = wifDescriptor?.id || '';
    const wifAddressTypes = wifDescriptor
        ? wifDescriptor.addressTypes.filter((type) => WIF_IMPORT_ADDRESS_TYPES.includes(type))
        : [];
    const effectiveWifAddressType = wifDescriptor
        ? (wifAddressTypes.includes(wifAddressType)
            ? wifAddressType
            : defaultWifImportAddressType(wifDescriptor, wif))
        : '';
    const wifAddress = wifDescriptor && effectiveWifAddressType
        ? wifImportPreview({
            wif,
            descriptor: wifDescriptor,
            addressType: effectiveWifAddressType,
        }) || ''
        : '';
    const coinIcon = (descriptor) => (
        <img
            src={branding.chainIconSmallUrl(descriptor.id)}
            alt=""
            className={styles.walletTypeIcon}
        />
    );
    const wifNetworkOptions = wifCoinChains.map((descriptor) => ({
        value: descriptor.networkKind,
        label: activeNetworkLabel(descriptor.networkKind),
        icon: coinIcon(descriptor),
    }));

    useEffect(() => {
        headingRef.current?.focus();
    }, [lane, adsNotice]);

    // A restore refusal or a newly shown password field puts the cursor in
    // that field (G22). Keyed on a counter so the same field refusing twice
    // still moves focus back to it.
    const [backupFocus, setBackupFocus] = useState(
        /** @type {{ field: keyof typeof BACKUP_FIELD_IDS, seq: number } | null} */ (null),
    );
    useEffect(() => {
        if (!backupFocus) return;
        document.getElementById(BACKUP_FIELD_IDS[backupFocus.field])?.focus();
    }, [backupFocus]);

    function focusBackupField(field) {
        setBackupFocus((current) => ({ field, seq: (current?.seq ?? 0) + 1 }));
    }

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            inputGenerationRef.current += 1;
        };
    }, []);

    // A flow step, not an overlay: backgrounding the app keeps what was typed.
    // An open camera makes it an overlay, so a pause runs handleBack, which
    // closes only the camera and releases it while the form stays.
    useBackHandler(handleBack, busy || adsNotice, scanning ? 'overlay' : 'screen');

    function clearSensitiveState() {
        setMnemonic('');
        setMnemonicCursor(0);
        setWif('');
        setWifCoin('');
        setWifNetwork('');
        setWifAddressType('');
        setWifWarningAck(false);
        setPassword('');
        setConfirm('');
        setShowPassphrase(false);
        setBip39Passphrase('');
        setBackupContent('');
        setBackupFile(null);
        setBackupPassword('');
        setBackupWalletPassword('');
        setBackupDevicePassword('');
        setBackupNeedsWalletPassword(false);
        setBackupNeedsDevicePassword(false);
        setBackupFieldError(null);
        setScanning(false);
        setDragOver(false);
    }

    function invalidatePendingInput() {
        inputGenerationRef.current += 1;
    }

    function changeLane(nextLane) {
        if (nextLane === activeLaneRef.current) return;
        activeLaneRef.current = nextLane;
        invalidatePendingInput();
        clearSensitiveState();
        setLane(nextLane);
        formErrors.reset();
    }

    function beginBusy() {
        if (busyRef.current) return false;
        busyRef.current = true;
        setBusy(true);
        return true;
    }

    function endBusy() {
        busyRef.current = false;
        setBusy(false);
    }

    function handleBack() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        // Back first closes an open scanner, as the iOS swipe and Android
        // Back expect; only a second Back leaves the import flow.
        if (scanning) {
            setScanning(false);
            return;
        }
        invalidatePendingInput();
        clearSensitiveState();
        formErrors.reset();
        if (walletElsewhere) {
            openExistingWallet();
            return;
        }
        onBack();
    }

    // A fresh import refused because a wallet now exists drops what was typed
    // and offers that wallet instead. Returns whether it took the refusal.
    function takeWalletElsewhere(err) {
        if (mode !== 'fresh' || !isWalletExistsError(err)) return false;
        invalidatePendingInput();
        clearSensitiveState();
        formErrors.reset();
        setWalletElsewhere(true);
        endBusy();
        return true;
    }

    function openExistingWallet() {
        try {
            void onImported().catch(() => { /* Unlock or Back tries again */ });
        } catch {
            // Unlock or Back tries again.
        }
    }

    function handleQrFrame(text) {
        if (inputGeneration !== inputGenerationRef.current || activeLaneRef.current !== 'mnemonic') return;
        if (typeof text !== 'string' || text.length === 0) return;
        // Strip an optional `bip39:` prefix that some QR generators emit.
        const cleaned = normalizePhraseEntry(text.replace(/^\s*bip39:\s*/i, ''));
        setMnemonic(cleaned);
        setMnemonicCursor(cleaned.length);
        setScanning(false);
        if (error) setError(null);
    }

    function handleMnemonicPaste(event) {
        const pasted = event.clipboardData?.getData('text');
        const normalized = normalizePhraseEntry(pasted);
        if (normalized.split(' ').length < 2) return;
        event.preventDefault();
        const textarea = event.currentTarget;
        const start = textarea.selectionStart ?? mnemonic.length;
        const end = textarea.selectionEnd ?? start;
        const combined = normalizePhraseEntry(
            `${mnemonic.slice(0, start)} ${normalized} ${mnemonic.slice(end)}`,
        );
        setMnemonic(combined);
        setMnemonicCursor(combined.length);
        if (error) setError(null);
    }

    // Backup file drop zone: the area, and the summary card that replaces it,
    // both take a dropped file the same way as a picked one.
    const backupDrop = useDropZone({
        accept: ['.xchain-wallet', 'application/json', '.json', 'text/plain', '.txt'],
        readAs: 'text',
        disabled: busy,
        onError: (message) => {
            if (inputGeneration !== inputGenerationRef.current || activeLaneRef.current !== 'backup') return;
            const validation = typeof message === 'string'
                && /^(?:File is too large|File type not accepted)/.test(message);
            setBackupFieldError({
                field: 'file',
                message: validation
                    ? t('importWallet.backup.error.fileRejected', { reason: message })
                    : t('importWallet.backup.error.unreadable'),
            });
        },
        onFile: ({ file, content }) => {
            if (inputGeneration !== inputGenerationRef.current || activeLaneRef.current !== 'backup') return;
            const text = typeof content === 'string' ? content : '';
            // Read the plaintext header now, so a file that is not a backup is
            // refused where it was chosen rather than after a password is typed.
            let envelope;
            try {
                envelope = parseBackupEnvelope(text);
            } catch (err) {
                setBackupContent('');
                setBackupFile(null);
                setBackupFieldError({
                    field: 'file',
                    message: backupFileFailureCopy(restoreFailureKind(err))
                        || t('importWallet.backup.error.notBackup'),
                });
                return;
            }
            setBackupContent(text);
            setBackupFile({ name: file.name, size: file.size, ...backupHeaderSummary(envelope) });
            // Another file may need other passwords, so a field shown for the
            // last one goes until this one asks for it.
            setBackupNeedsWalletPassword(false);
            setBackupNeedsDevicePassword(false);
            setBackupWalletPassword('');
            setBackupDevicePassword('');
            setBackupFieldError(null);
            if (error) setError(null);
        },
    });

    function refuseBackupField(field, message) {
        setBackupFieldError({ field, message });
        focusBackupField(field);
    }

    async function handleBackupSubmit(event) {
        event.preventDefault();
        setValidationAttempt((attempt) => attempt + 1);
        if (busyRef.current) return;
        // Each empty field is named on the field itself (G22).
        if (backupContent.trim().length === 0) {
            refuseBackupField('file', t('importWallet.backup.error.noFile'));
            return;
        }
        if (backupPassword.length === 0) {
            refuseBackupField('password', t('importWallet.backup.error.passwordRequired'));
            return;
        }
        if (backupNeedsWalletPassword && backupWalletPassword.length === 0) {
            refuseBackupField('wallet', t('importWallet.backup.error.walletPasswordRequired'));
            return;
        }
        if (backupNeedsDevicePassword && backupDevicePassword.length === 0) {
            refuseBackupField('device', t('importWallet.backup.error.devicePasswordRequired'));
            return;
        }
        // One password, tried in every role until a role refuses it. The
        // wallet keeps the password that opened it: on a fresh install that
        // becomes this device's unlock password, so nothing new is chosen.
        // An open vault can only hold wallets under its own password, so an
        // add re-locks the wallet with that one: the main field's, which the
        // vault already accepted unless it refused it and the device field
        // was shown. Never the wallet field's: that one opened the old seal,
        // and offering it to the vault would ask for a password it has.
        const walletPassword = backupNeedsWalletPassword ? backupWalletPassword : backupPassword;
        let devicePassword = walletPassword;
        if (mode === 'add') {
            devicePassword = backupNeedsDevicePassword ? backupDevicePassword : backupPassword;
        }
        setError(null);
        setBackupFieldError(null);
        if (!beginBusy()) return;
        try {
            // A fresh install has no vault, so it has no host, so the
            // host-registered restore has nothing to answer it. `fresh` goes to
            // the pre-host lane, which creates the vault under the wallet's
            // password and then merges. A failed attempt leaves the install
            // fresh, so asking for a second password and trying again is safe.
            if (mode === 'fresh') {
                if (typeof messaging.importBackupFresh !== 'function') {
                    setError(t('importWallet.backup.error.unavailable'));
                    endBusy();
                    return;
                }
                const result = await messaging.importBackupFresh({
                    password: devicePassword,
                    backupPassword,
                    walletPassword,
                    fileContent: backupContent,
                });
                finishWalletImport(result, { discover: true });
                return;
            }
            if (typeof messaging.importBackupRequest !== 'function') {
                setError(t('importWallet.backup.error.unavailable'));
                endBusy();
                return;
            }
            const result = await messaging.importBackupRequest({
                fileContent: backupContent,
                password: backupPassword,
                // The seal travels with the record, so it has to be opened
                // with the wallet's own password and moved onto this vault's
                // before anything is written.
                walletPassword,
                devicePassword,
                // A contact or site this device already has stays as it is;
                // the restored wallet itself gets fresh ids in 'add' mode, so
                // it never collides.
                onConflict: 'preserve',
                mode,
            });
            finishWalletImport(result, { discover: true });
        } catch (err) {
            if (takeWalletElsewhere(err)) return;
            endBusy();
            if (isVaultConflictError(err)) {
                setError(userFacingMessage(err, t('importWallet.backup.error.generic')));
                return;
            }
            const kind = restoreFailureKind(err);
            switch (kind) {
                case 'file-password':
                case 'required-file':
                    refuseBackupField('password', t('importWallet.backup.error.wrongPassword'));
                    return;
                case 'wallet-password':
                case 'required-wallet':
                    // The file opened with this password but the wallet did not:
                    // ask for the wallet's own password, once, in a field of its own.
                    if (!backupNeedsWalletPassword) {
                        setBackupNeedsWalletPassword(true);
                        focusBackupField('wallet');
                        return;
                    }
                    refuseBackupField('wallet', t('importWallet.backup.error.wrongWalletPassword'));
                    return;
                case 'device-password':
                case 'required-device':
                    if (!backupNeedsDevicePassword) {
                        setBackupNeedsDevicePassword(true);
                        focusBackupField('device');
                        return;
                    }
                    refuseBackupField('device', t('importWallet.backup.error.wrongDevicePassword'));
                    return;
                default: {
                    const fileCopy = backupFileFailureCopy(kind);
                    if (fileCopy) {
                        setError(fileCopy);
                        return;
                    }
                    setError(userFacingMessage(err, t('importWallet.backup.error.generic')));
                }
            }
        }
    }

    // Cluster H FOLLOWUP 2: image-QR drop branch. The mnemonic
    // dropzone keeps its plain-text fast path for `.txt` / `.asc` /
    // `text/*` MIME types, but now also accepts a printed-paper-wallet
    // photo: PNG / JPEG renders into a canvas, the global
    // `BarcodeDetector` (Chrome / Edge / Android Chrome) extracts a
    // `qr_code` rawValue, and the result feeds `handleQrFrame` so the
    // mnemonic textarea fills exactly the way a live `<QrScanner>`
    // capture would. Browsers without `BarcodeDetector` (Safari /
    // Firefox today) surface a friendly hint instead of silently
    // failing. PDFs are still out of scope (they need a third-party
    // PDF render layer.
    function handleFileDrop(event) {
        event.preventDefault();
        setDragOver(false);
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;

        const isImage = (file.type && file.type.startsWith('image/'))
            || /\.(png|jpe?g)$/i.test(file.name);
        if (isImage) {
            if (typeof globalThis.BarcodeDetector !== 'function') {
                setError('Image-QR decoding requires a browser with BarcodeDetector support. Try Chrome or Edge, or use the Scan QR button instead.');
                return;
            }
            decodeImageQrFile(file)
                .then((text) => {
                    if (typeof text === 'string' && text.length > 0) {
                        handleQrFrame(text);
                    } else {
                        setError('No QR code found in the dropped image.'
                            + ' Choose another image or use Scan QR.');
                    }
                })
                .catch(() => {
                    if (inputGeneration !== inputGenerationRef.current || activeLaneRef.current !== 'mnemonic') return;
                    setError(
                        'Could not read a QR code from that image. Choose another image or use Scan QR.',
                    );
                });
            return;
        }

        // Plain-text path. PDFs and unknown MIME types fall through here
        // and surface an explicit rejection rather than a silent miss.
        if (file.type && !file.type.startsWith('text/') && !/\.(txt|asc)$/i.test(file.name)) {
            setError('Only plain-text files (.txt / .asc) or QR images (.png / .jpg) can be dropped here.');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            if (inputGeneration !== inputGenerationRef.current || activeLaneRef.current !== 'mnemonic') return;
            const raw = typeof reader.result === 'string' ? reader.result : '';
            // Strip common surrounding text; many users paste a paragraph
            // they wrote around the seed. We pick the longest line whose
            // tokens look like wordlist words.
            const candidate = raw
                .split(/\r?\n/)
                .map((line) => line.trim().replace(/\s+/g, ' '))
                .filter((line) => /^[a-zA-Z\s]+$/.test(line) && line.split(' ').length >= 12)
                .sort((a, b) => b.length - a.length)[0];
            setMnemonic((candidate || raw).trim());
            if (error) setError(null);
        };
        reader.onerror = () => {
            if (inputGeneration !== inputGenerationRef.current || activeLaneRef.current !== 'mnemonic') return;
            setError('Could not read that file. Choose another file and try again.');
        };
        reader.readAsText(file);
    }

    // A blank name takes the default; a name that draws no mark or runs past the
    // cap would read as nothing in every list, so it is refused as Create does.
    function walletNameError() {
        const trimmedName = name.trim();
        if (trimmedName.length > 0 && !hasVisibleText(trimmedName)) {
            return 'Wallet name must include a visible character.';
        }
        if (nameLength(trimmedName) > NAME_MAX_LENGTH) {
            return `Wallet name must be ${NAME_MAX_LENGTH} characters or fewer.`;
        }
        return null;
    }

    async function handleSubmit(event) {
        event.preventDefault();
        setValidationAttempt((attempt) => attempt + 1);
        if (busyRef.current) return;
        // Every field is checked in one pass, one message per field (its first failing
        // rule), so the notice at the top lists everything to fix at once.
        const trimmed = normalizePhraseEntry(mnemonic);
        const wordCount = trimmed.length === 0 ? 0 : trimmed.split(' ').length;
        const acceptedFormat = trimmed.length === 0 || !acceptedWordCounts.includes(wordCount)
            ? null
            : importPhraseFormat(trimmed, isLegacyType);
        let phraseProblem = null;
        if (trimmed.length === 0) {
            phraseProblem = 'Enter a recovery phrase.';
        } else if (!acceptedWordCounts.includes(wordCount)) {
            phraseProblem = t('importWallet.phrase.wrongWordCount', {
                expected: formatOrList(acceptedWordCounts),
                count: wordCount,
            });
        } else if (!acceptedFormat) {
            phraseProblem = importPhraseRefusal(trimmed, isLegacyType);
        }
        let passwordProblem = null;
        if (password.length < MIN_PASSWORD_LENGTH) {
            passwordProblem = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        } else if (walletPasswordCollidesWithDuress(password)) {
            passwordProblem = DURESS_PASSWORD_COLLISION_MESSAGE;
        }
        let confirmProblem = null;
        if (confirm.length === 0) {
            confirmProblem = CONFIRM_PASSWORD_MESSAGE;
        } else if (password !== confirm) {
            confirmProblem = 'Passwords do not match.';
        }
        // A checked box with an empty field used to collapse to "no
        // passphrase" and silently derive the passphrase-less wallet, the
        // same wrong addresses the user was ticking the box to avoid. The
        // box is a claim that a passphrase exists, so an empty one is a
        // contradiction to refuse, not a default to fill in.
        const passphraseProblem = !isLegacyType && showPassphrase && bip39Passphrase.length === 0
            ? t('importWallet.passphrase.empty')
            : null;
        if (!formErrors.validate({
            'xc-mnemonic': phraseProblem,
            'import-name': walletNameError(),
            'import-password': passwordProblem,
            'import-confirm': confirmProblem,
            'import-bip39-passphrase': passphraseProblem,
        })) return;
        if (!beginBusy()) return;
        try {
            const passphraseArg = !isLegacyType && showPassphrase
                ? bip39Passphrase
                : '';
            // The format this lane accepted rides the request, so no shell
            // re-detects the phrase as the other format: about 1 in 30,000
            // FreeWallet phrases also passes the BIP39 checksum, and a BIP39
            // phrase with a typo can still parse as FreeWallet.
            const formatArg = importPhraseFormatArg(acceptedFormat);
            let result;
            if (mode === 'add') {
                if (typeof messaging.addImportedWallet !== 'function') {
                    throw new Error('messaging.addImportedWallet is not available in this shell.');
                }
                result = await messaging.addImportedWallet({ password, mnemonic: trimmed, name: walletName, bip39Passphrase: passphraseArg, walletMode: 'full',...formatArg });
            } else {
                result = await messaging.importMnemonic({ password, mnemonic: trimmed, name: walletName, bip39Passphrase: passphraseArg, walletMode: 'full',...formatArg });
            }
            finishWalletImport(result, { discover: true });
            const showRestoredLabels = (labelSync) => {
                const restoredMessage = labelSyncRestoredMessage(labelSync);
                if (restoredMessage) showToast({ message: restoredMessage });
                // Home reads labels when it mounts. If the user has already
                // continued past the notice, refresh it after the vault write.
                if (labelSync?.restored && adsContinuedRef.current) {
                    void Promise.resolve().then(() => onImported()).catch(() => {});
                }
            };
            if (result?.labelSyncToken && typeof messaging.labelSyncRestoreResult === 'function') {
                void messaging.labelSyncRestoreResult({ token: result.labelSyncToken })
                    .then(showRestoredLabels)
                    .catch(() => { /* the import already succeeded */ });
            } else {
                showRestoredLabels(result?.labelSync);
            }
        } catch (err) {
            if (takeWalletElsewhere(err)) return;
            setError(userFacingMessage(
                err,
                'Could not import the wallet. Check the recovery phrase and try again.',
            ));
            endBusy();
        }
    }

    function finishWalletImport(result, { discover = false } = {}) {
        const walletId = result?.wallet?.id || result?.walletId || null;
        importedWalletRef.current = mode === 'add' && walletId
            ? { id: walletId, name: result?.wallet?.name || result?.walletName || walletName }
            : null;
        invalidatePendingInput();
        clearSensitiveState();
        endBusy();
        setNoticeError(null);
        setAdsNotice(true);
        // A restored seed shows only address 0 per chain until the used-address
        // check runs. It runs in the background once the vault is written; a
        // restore that names no single wallet checks every unlocked one.
        if (discover && typeof messaging.discoverAddresses === 'function') {
            void Promise.resolve()
                .then(() => messaging.discoverAddresses(walletId ? { walletId } : {}))
                .catch(() => { /* Wallet details offers the check again */ });
        }
    }

    function onImported() {
        const wallet = importedWalletRef.current || undefined;
        const result = handleImported(wallet);
        importedWalletRef.current = null;
        return Promise.resolve(result).catch((err) => {
            importedWalletRef.current = wallet || null;
            throw err;
        });
    }

    async function handleWifSubmit(event) {
        event.preventDefault();
        // The submit is always enabled (G22), so a refused press is a submit
        // attempt and its error joins the linked summary like the other lanes.
        setValidationAttempt((attempt) => attempt + 1);
        if (busyRef.current) return;
        // Every field is checked in one pass, one message per field.
        const trimmedWif = wif.trim();
        let passwordProblem = null;
        if (password.length < MIN_PASSWORD_LENGTH) {
            passwordProblem = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
        } else if (walletPasswordCollidesWithDuress(password)) {
            passwordProblem = DURESS_PASSWORD_COLLISION_MESSAGE;
        }
        let confirmProblem = null;
        if (confirm.length === 0) {
            confirmProblem = CONFIRM_PASSWORD_MESSAGE;
        } else if (password !== confirm) {
            confirmProblem = 'Passwords do not match.';
        }
        const versionByte = wifImportVersionByte(trimmedWif);
        const networkProblem = Number.isInteger(versionByte)
            && wifDescriptor
            && versionByte !== wifDescriptor.wifVersionByte
            ? t('importWallet.wif.networkMismatch')
            : null;
        if (!formErrors.validate({
            'import-wif-coin': effectiveWifCoin ? null : t('importWallet.wif.coinRequired'),
            'import-wif-network': effectiveWifChainId
                ? networkProblem
                : t('importWallet.wif.networkRequired'),
            'import-wif': trimmedWif.length === 0 ? 'WIF private key is required.' : null,
            'import-name': walletNameError(),
            'import-password': passwordProblem,
            'import-confirm': confirmProblem,
            'import-wif-ack': wifWarningAck ? null : 'Acknowledge the backup warning before importing this private key.',
            ...(typeof messaging.importMnemonic === 'function'
                ? {}
                : { form: 'Private-key import is not available in this shell.' }),
        })) return;
        if (!beginBusy()) return;
        try {
            const result = await messaging.importMnemonic({
                password,
                wif: trimmedWif,
                chainId: effectiveWifChainId,
                addressType: effectiveWifAddressType,
                name: walletName,
                walletMode: 'full',
            });
            finishWalletImport(result);
        } catch (err) {
            if (takeWalletElsewhere(err)) return;
            setError(userFacingMessage(
                err,
                'Could not import that private key. Check the key and the network, then try again.',
            ));
            endBusy();
        }
    }

    const backupErrorFor = (field) => (backupFieldError?.field === field ? backupFieldError.message : undefined);
    const normalizedMnemonic = normalizePhraseEntry(mnemonic);
    const mnemonicWordCount = normalizedMnemonic.length === 0
        ? 0
        : normalizedMnemonic.split(' ').length;
    const detectedPhraseFormat = importPhraseFormat(normalizedMnemonic, isLegacyType);
    const phraseHelp = isLegacyType
        ? t('importWallet.phrase.legacyHelp')
        : t('importWallet.phrase.help');
    const phraseHint = isLegacyType
        ? t('importWallet.phrase.legacyWordList')
        : t('importWallet.phrase.bip39WordList');
    const phraseWordlist = isLegacyType ? COUNTERWALLET_WORDLIST : englishWordlist;
    const phraseWords = isLegacyType ? COUNTERWALLET_WORDS : BIP39_WORDS;
    const activeWord = wordRangeAt(mnemonic, mnemonicCursor);
    const wordSuggestions = activeWord.prefix.length < 2 || phraseWords.has(activeWord.prefix)
        ? []
        : phraseWordlist
            .filter((word) => word.startsWith(activeWord.prefix))
            .slice(0, MAX_WORD_SUGGESTIONS);

    function useWordSuggestion(word) {
        const before = mnemonic.slice(0, activeWord.start);
        const after = mnemonic.slice(activeWord.end);
        const separator = after.length === 0 ? ' ' : '';
        const next = `${before}${word}${separator}${after}`;
        const nextCursor = activeWord.start + word.length + separator.length;
        setMnemonic(next);
        setMnemonicCursor(nextCursor);
        if (error) setError(null);
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
            textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
        });
    }

    // A tab shows one short word so the three fit one line at 360px (G42);
    // a screen reader still hears the full lane name.
    const tabLabel = (IconGlyph, text, fullName = null) => (
        <span className={homeTabsStyles.tabWithIcon}>
            <span className={homeTabsStyles.tabIcon} aria-hidden="true"><IconGlyph /></span>
            {fullName ? (
                <>
                    <span aria-hidden="true">{text}</span>
                    <span className="sr-only">{fullName}</span>
                </>
            ) : text}
        </span>
    );
    const laneSwitcher = (
        <Tabs
            items={[
                { id: 'mnemonic', label: tabLabel(Icon.DocumentIcon, t('importWallet.tab.phrase'), t('importWallet.recoveryPhrase')) },
                ...(mode === 'fresh'
                    ? [{ id: 'wif', label: tabLabel(Icon.KeyIcon, t('importWallet.wif.tab')) }]
                    : []),
                { id: 'backup', label: tabLabel(Icon.UploadIcon, t('importWallet.tab.backup'), t('importWallet.encryptedBackup')) },
            ]}
            value={lane}
            onChange={changeLane}
            disabled={busy}
            aria-label={t('importWallet.lane')}
            // A tab row sits 8px above the content it switches (G81). The form
            // stack already adds its gap between children, so the margin is the
            // 8px less that gap (negative on the 16px default), never 8px more.
            style={{ marginBottom: 'calc(var(--xc-space-2) - var(--xc-form-gap, var(--xc-space-4)))' }}
        />
    );

    const passwordHelp = `${t('importWallet.password.fullHelp')} ${t('importWallet.password.hint', { count: MIN_PASSWORD_LENGTH })}`;

    // G22: the submit is always enabled. Each handler refuses an empty
    // required field by name, so there is no standing "Enter X to continue"
    // notice. Every lane's problems are entries of the form's error map (`formErrors`):
    // the notice at the top of the page lists them, and the failing fields are outlined.
    // A failure that names no field (a rejected scan, an unreadable file or drop, the
    // vault refusing the import) is a plain line in the same notice.
    const formStatus = walletElsewhere ? (
        <FormErrorSummary
            errors={[{ message: t('importWallet.walletElsewhere') }]}
            focusKey={validationAttempt || 1}
            recovery={{ label: t('importWallet.unlockExisting'), onAction: openExistingWallet }}
        />
    ) : null;

    const formActions = lane === 'backup' ? (
        <Button
            type="submit"
            variant="success"
            loading={busy}
            icon={<Icon.KeyIcon />}
        >
            {t('send.draft.restore')}
        </Button>
    ) : (
        <Button
            type="submit"
            variant="success"
            loading={busy}
            icon={<Icon.KeyIcon />}
        >
            {t('importWallet.import')}
        </Button>
    );

    const pageTitle = adsNotice
        ? t('adsNotice.title')
        : lane === 'backup'
                ? t('importWallet.backup.title')
                : lane === 'wif'
                    ? t('importWallet.wif.title')
                    : t('importWallet.title');
    // The window title names the lane the heading shows.
    useDocumentTitleSection(pageTitle);

    const form = (
        <FormPage
            label={t('importWallet.title')}
            onSubmit={lane === 'backup'
                ? handleBackupSubmit
                : lane === 'wif'
                    ? handleWifSubmit
                    : handleSubmit}
            status={formStatus}
            errors={formErrors}
            actions={formActions}
        >
            {laneSwitcher}
            {lane === 'backup' ? (
                <>
                    {backupFile ? (
                        /* The chosen file's summary takes the drop area's place, and
                           still takes a dropped file, so another can replace it. */
                        <section
                            {...backupDrop.rootProps}
                            className={styles.backupCard}
                            aria-label={t('importWallet.backup.summary')}
                        >
                            {/* The hidden native picker remains raw because the kit has no file-input primitive. */}
                            <input
                                {...backupDrop.pickerProps}
                                aria-label={t('importWallet.backup.file')}
                                disabled={busy}
                            />
                            <IdentityAvatar
                                name={backupFile.walletName}
                                context="hero"
                                variant="asset"
                                tone="var(--xc-accent-primary)"
                            />
                            <p className={styles.backupCardName}>{backupFile.walletName}</p>
                            {backupFile.backedUp ? (
                                <p className={styles.backupCardDate}>
                                    {t('importWallet.backup.backedUp', { date: backupFile.backedUp })}
                                </p>
                            ) : null}
                            <p className={styles.backupCardFile}>
                                {t('importWallet.backup.fileMeta', {
                                    name: backupFile.name,
                                    size: formatBytes(backupFile.size),
                                })}
                            </p>
                            <Button
                                id={BACKUP_FIELD_IDS.file}
                                type="button"
                                variant="secondary"
                                size="sm"
                                icon={<Icon.RefreshIcon />}
                                onClick={backupDrop.openFilePicker}
                                disabled={busy}
                            >
                                {t('importWallet.backup.changeFile')}
                            </Button>
                            {backupErrorFor('file') ? (
                                // A dropped file refused while this one stays chosen.
                                <StatusMessage variant="error">{backupErrorFor('file')}</StatusMessage>
                            ) : null}
                        </section>
                    ) : (
                        <FileField
                            variant="area"
                            id={BACKUP_FIELD_IDS.file}
                            label={t('importWallet.backup.choose')}
                            hint={t('importWallet.backup.orDrop')}
                            inputLabel={t('importWallet.backup.file')}
                            drop={backupDrop}
                            error={backupErrorFor('file')}
                            errorKey={validationAttempt}
                            disabled={busy}
                        />
                    )}
                    <Input
                        id={BACKUP_FIELD_IDS.password}
                        type="password"
                        revealable
                        label={t('importWallet.backup.password')}
                        help={mode === 'add'
                            ? t('importWallet.backup.passwordHelpAdd')
                            : t('importWallet.backup.passwordHelp')}
                        value={backupPassword}
                        error={backupErrorFor('password')}
                        errorKey={validationAttempt}
                        onChange={(e) => {
                            setBackupPassword(e.target.value);
                            if (backupFieldError?.field === 'password') setBackupFieldError(null);
                            if (error) setError(null);
                        }}
                        autoComplete="off"
                        disabled={busy}
                    />
                    {backupNeedsWalletPassword ? (
                        <Input
                            id={BACKUP_FIELD_IDS.wallet}
                            type="password"
                            revealable
                            label={t('importWallet.backup.walletPassword')}
                            help={t('importWallet.backup.walletPasswordHelp')}
                            hint={t('importWallet.backup.walletPasswordReason')}
                            value={backupWalletPassword}
                            error={backupErrorFor('wallet')}
                            errorKey={validationAttempt}
                            onChange={(e) => {
                                setBackupWalletPassword(e.target.value);
                                if (backupFieldError?.field === 'wallet') setBackupFieldError(null);
                                if (error) setError(null);
                            }}
                            autoComplete="off"
                            disabled={busy}
                        />
                    ) : null}
                    {backupNeedsDevicePassword ? (
                        <Input
                            id={BACKUP_FIELD_IDS.device}
                            type="password"
                            revealable
                            label={t('importWallet.backup.devicePassword')}
                            help={t('importWallet.backup.devicePasswordHelp')}
                            hint={t('importWallet.backup.devicePasswordReason')}
                            value={backupDevicePassword}
                            error={backupErrorFor('device')}
                            errorKey={validationAttempt}
                            onChange={(e) => {
                                setBackupDevicePassword(e.target.value);
                                if (backupFieldError?.field === 'device') setBackupFieldError(null);
                                if (error) setError(null);
                            }}
                            autoComplete="off"
                            disabled={busy}
                        />
                    ) : null}
                </>
            ) : null}
            {lane === 'mnemonic' ? (
            <>
            <IconSelect
                id="import-wallet-type"
                label={t('importWallet.walletType')}
                help={t('importWallet.walletTypeHelp')}
                value={walletType}
                onChange={(nextType) => {
                    setWalletType(nextType);
                    setShowPassphrase(false);
                    setBip39Passphrase('');
                    formErrors.clear('xc-mnemonic');
                    if (error) setError(null);
                }}
                disabled={busy}
                options={[
                    {
                        value: 'bip39',
                        label: t('importWallet.walletType.bip39'),
                        sub: t('importWallet.walletType.bip39Description'),
                        icon: <Icon.DocumentIcon />,
                    },
                    {
                        value: 'freewallet',
                        label: t('importWallet.walletType.legacy'),
                        sub: t('importWallet.walletType.legacyDescription'),
                        icon: <img src={branding.freeWalletWallyUrl()} alt="" className={styles.walletTypeIcon} />,
                    },
                ]}
            />
            {scanning ? (
                <div className={scanMessage ? styles.scannerNotice : styles.scannerBox}>
                    <QrScanner
                        onFrame={handleQrFrame}
                        alt={t('importWallet.phrase.scannerAlt')}
                        noticeInPlace
                        onNoticeChange={setScanMessage}
                    />
                </div>
            ) : null}
            <div
                className={`${styles.dropZone}${dragOver ? ` ${styles.dropZoneActive}` : ''}`}
                onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragOver) setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
            >
                <Textarea
                    label={t('importWallet.recoveryPhrase')}
                    help={phraseHelp}
                    hint={phraseHint}
                    counter={isLegacyType
                        ? t('importWallet.phrase.legacyCount', { count: mnemonicWordCount })
                        : t('importWallet.phrase.wordCount', { count: mnemonicWordCount })}
                    id="xc-mnemonic"
                    ref={textareaRef}
                    size={isFull ? 'lg' : 'md'}
                    className={styles.mnemonicText}
                    value={mnemonic}
                    onChange={(e) => {
                        setMnemonic(e.target.value);
                        setMnemonicCursor(e.target.selectionStart ?? e.target.value.length);
                        if (error) setError(null);
                    }}
                    onPaste={handleMnemonicPaste}
                    onSelect={(e) => setMnemonicCursor(e.currentTarget.selectionStart ?? 0)}
                    onKeyUp={(e) => setMnemonicCursor(e.currentTarget.selectionStart ?? 0)}
                    placeholder={
                        isFull
                            ? t('importWallet.phrase.fullPlaceholder')
                            : t('importWallet.phrase.placeholder')
                    }
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    rows={3}
                    disabled={busy}
                    aria-describedby={detectedPhraseFormat === 'bip39' || detectedPhraseFormat === 'counterwallet' ? 'xc-mnemonic-status' : undefined}
                    fieldAction={(
                        <FieldIconButton
                            icon={<Icon.QrCodeIcon />}
                            label={scanning ? t('importWallet.cancelScan') : t('importWallet.scanQr')}
                            onClick={() => {
                                setScanning((current) => !current);
                                setScanMessage(false);
                                if (error) setError(null);
                            }}
                            disabled={busy}
                            aria-pressed={scanning}
                        />
                    )}
                />
                {detectedPhraseFormat === 'bip39' || detectedPhraseFormat === 'counterwallet' ? (
                    <div id="xc-mnemonic-status" className={styles.phraseMeta} aria-live="polite">
                        {detectedPhraseFormat === 'bip39' ? <span>{t('importWallet.phrase.bip39Detected')}</span> : null}
                        {detectedPhraseFormat === 'counterwallet' ? <span>{t('importWallet.phrase.legacyDetected')}</span> : null}
                    </div>
                ) : null}
                {wordSuggestions.length > 0 ? (
                    /* The transient word-completion group has no style-guide list primitive. */
                    <div className={styles.wordSuggestions} aria-label={t('importWallet.phrase.suggestions')}>
                        {wordSuggestions.map((word) => (
                            <Button
                                key={word}
                                type="button"
                                variant="secondary"
                                size="sm"
                                icon={null}
                                onClick={() => useWordSuggestion(word)}
                                disabled={busy}
                                aria-label={t('importWallet.phrase.useWord', { word })}
                            >
                                {word}
                            </Button>
                        ))}
                    </div>
                ) : null}
                {dragOver ? (
                    <p className={styles.dropHint}>{t('importWallet.phrase.releaseToLoad')}</p>
                ) : null}
            </div>
            <Input
                id="import-name"
                label={t('renameWallet.name')}
                help={t('importWallet.walletNameHelp')}
                value={name}
                onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
                autoComplete="off"
                disabled={busy}
            />
            <Input
                id="import-password"
                type="password"
                label={t('common.password')}
                // U57: the length rule is static help, so it lives in the tip.
                help={passwordHelp}
                value={password}
                onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError(null);
                }}
                autoComplete="new-password"
                disabled={busy}
            />
            <Input
                id="import-confirm"
                type="password"
                label={isFull ? t('importWallet.confirmPassword') : t('common.confirm')}
                help={t('importWallet.confirmPasswordHelp')}
                value={confirm}
                onChange={(e) => {
                    setConfirm(e.target.value);
                    if (error) setError(null);
                }}
                autoComplete="new-password"
                disabled={busy}
            />
            {!isLegacyType ? (
                <div className={styles.advancedRow}>
                    <Switch
                        label={t('importWallet.passphrase.toggle')}
                        help={t('importWallet.passphrase.helpBody')}
                        checked={showPassphrase}
                        onChange={(e) => {
                            setShowPassphrase(e.target.checked);
                            if (!e.target.checked) setBip39Passphrase('');
                        }}
                        disabled={busy}
                    />
                    {showPassphrase ? (
                        <Input
                            id="import-bip39-passphrase"
                            type="password"
                            label={t('importWallet.passphrase.label')}
                            help={t('importWallet.passphrase.hint')}
                            value={bip39Passphrase}
                            onChange={(e) => {
                                setBip39Passphrase(e.target.value);
                                if (error) setError(null);
                            }}
                            autoComplete="off"
                            disabled={busy}
                        />
                    ) : null}
                </div>
            ) : null}
            </>
            ) : null}
            {lane === 'wif' ? (
                <>
                    <IconSelect
                        id="import-wif-coin"
                        label={t('importWallet.wif.coin')}
                        help={t('importWallet.wif.coinHelp')}
                        value={effectiveWifCoin}
                        onChange={(coin) => {
                            setWifCoin(coin);
                            setWifAddressType('');
                            formErrors.clear('import-wif-network');
                            if (error) setError(null);
                        }}
                        options={wifCoinFamilies.map((descriptor) => ({
                            value: descriptor.coin,
                            label: descriptor.displayName,
                            icon: coinIcon(descriptor),
                        }))}
                        disabled={busy}
                    />
                    <IconSelect
                        id="import-wif-network"
                        label={t('importWallet.wif.chain')}
                        help={t('importWallet.wif.chainHelp')}
                        value={effectiveWifNetwork}
                        onChange={(nextNetwork) => {
                            setWifNetwork(nextNetwork);
                            setWifAddressType('');
                            if (error) setError(null);
                        }}
                        options={wifNetworkOptions}
                        disabled={busy}
                    />
                    {wifDescriptor ? (
                        <Select
                            label={t('importWallet.wif.addressType')}
                            help={t('importWallet.wif.addressTypeHelp')}
                            value={effectiveWifAddressType}
                            onChange={(e) => {
                                setWifAddressType(e.target.value);
                                if (error) setError(null);
                            }}
                            disabled={busy}
                        >
                            {wifAddressTypes.map((type) => (
                                <Select.Option key={type} value={type} icon={<Icon.AddressIcon />}>{addressTypeLabel(type)}</Select.Option>
                            ))}
                        </Select>
                    ) : null}
                    <Input
                        id="import-wif"
                        type="password"
                        label={t('importWallet.wif.key')}
                        help={t('importWallet.wif.keyHelp')}
                        value={wif}
                        onChange={(e) => {
                            const nextWif = e.target.value;
                            setWif(nextWif);
                            const versionByte = wifImportVersionByte(nextWif);
                            const matchingChains = wifChains.filter(
                                (descriptor) => descriptor.wifVersionByte === versionByte,
                            );
                            const matchingCoins = new Set(matchingChains.map((descriptor) => descriptor.coin));
                            const matchedChain = matchingChains.find(
                                (descriptor) => descriptor.id === effectiveWifChainId,
                            ) || matchingChains.find(
                                (descriptor) => descriptor.coin === effectiveWifCoin,
                            ) || (matchingCoins.size === 1 ? matchingChains[0] : null);
                            if (matchedChain && matchedChain.id !== effectiveWifChainId) {
                                setWifCoin(matchedChain.coin);
                                setWifNetwork(matchedChain.networkKind);
                                setWifAddressType('');
                            }
                            formErrors.clear('import-wif-network');
                            if (error) setError(null);
                        }}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                    />
                    <Input
                        label={t('verifySignature.address')}
                        value={wifAddress}
                        readOnly
                        autoComplete="off"
                        spellCheck={false}
                    />
                    <Input
                        id="import-name"
                        label={t('renameWallet.name')}
                        help={t('importWallet.walletNameHelp')}
                        value={name}
                        onChange={(e) => { setName(e.target.value); if (error) setError(null); }}
                        autoComplete="off"
                        disabled={busy}
                    />
                    <Input
                        id="import-password"
                        type="password"
                        label={t('common.password')}
                        help={passwordHelp}
                        value={password}
                        onChange={(e) => {
                            setPassword(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="new-password"
                        disabled={busy}
                    />
                    <Input
                        id="import-confirm"
                        type="password"
                        label={isFull ? t('importWallet.confirmPassword') : t('common.confirm')}
                        help={t('importWallet.confirmPasswordHelp')}
                        value={confirm}
                        onChange={(e) => {
                            setConfirm(e.target.value);
                            if (error) setError(null);
                        }}
                        autoComplete="new-password"
                        disabled={busy}
                    />
                    <Checkbox
                        id="import-wif-ack"
                        className={styles.advancedToggle}
                        label={t('importWallet.wif.ack')}
                        help={t('importWallet.wif.ackHelp')}
                        checked={wifWarningAck}
                        onChange={(e) => {
                            setWifWarningAck(e.target.checked);
                            formErrors.clear('import-wif-ack');
                            if (error) setError(null);
                        }}
                        disabled={busy}
                    />
                </>
            ) : null}
        </FormPage>
    );

    const pageHeader = (
        <PageHeader
            // Every step sits inside Add wallet (or onboarding), so Back
            // always steps back within the flow.
            nested
            onBack={handleBack}
            backLabel={t('importWallet.backToSetup')}
            backDisabled={busy || adsNotice}
            title={pageTitle}
            titleRef={headingRef}
            trailing={onOpenInTab && !adsNotice ? (
                <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon.ExternalLinkIcon />}
                    onClick={() => onOpenInTab({ lane })}
                    disabled={busy}
                    aria-label={t('importWallet.openInTab')}
                    title={t('importWallet.openInTab')}
                />
            ) : null}
        />
    );
    // Before a wallet exists, onboarding shows only this page header. In add
    // mode the unlocked shell supplies its app header above the same page header.
    const screenHeader = pageHeader;

    const continueAfterNotice = () => {
        if (continuePendingRef.current) return;
        continuePendingRef.current = true;
        setContinuing(true);
        setNoticeError(null);
        adsContinuedRef.current = true;
        let result;
        try {
            result = onImported();
        } catch (err) {
            handleContinueError(err);
            finishContinue();
            return;
        }
        void Promise.resolve(result)
            .catch((err) => {
                handleContinueError(err);
            })
            .finally(finishContinue);

        function handleContinueError(err) {
            adsContinuedRef.current = false;
            if (mountedRef.current) {
                setNoticeError(userFacingMessage(
                    err,
                    'The wallet was imported, but the app could not continue. Try again.',
                ));
            }
        }

        function finishContinue() {
            continuePendingRef.current = false;
            if (mountedRef.current) setContinuing(false);
        }
    };

    if (adsNotice) {
        return (
            <Screen variant={variant} header={screenHeader}>
                <AdsNotice
                    onContinue={continueAfterNotice}
                    busy={continuing}
                    status={noticeError ? <StatusMessage variant="error">{noticeError}</StatusMessage> : null}
                />
            </Screen>
        );
    }

    return (
        <Screen variant={variant} header={screenHeader}>
            {form}
        </Screen>
    );
}

// Cluster H FOLLOWUP 2: image-QR decode helper. Loads a dropped
// image into an <img>, paints it onto a same-sized off-screen
// canvas, runs the global BarcodeDetector for `qr_code` formats,
// and returns the first match's rawValue (or null when no match
// exists). All resources are released in a finally so a failure
// midway doesn't leak object URLs. The caller has already verified
// `globalThis.BarcodeDetector` is present.
//
// @param {File} file
// @returns {Promise<string | null>}
async function decodeImageQrFile(file) {
    const url = URL.createObjectURL(file);
    let img = null;
    try {
        img = await loadImageFromUrl(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        if (canvas.width === 0 || canvas.height === 0) {
            throw new Error('Dropped image has no decodable dimensions.');
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not allocate a 2D drawing context.');
        ctx.drawImage(img, 0, 0);
        const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
        const codes = await detector.detect(canvas);
        if (Array.isArray(codes) && codes.length > 0) {
            const raw = codes[0]?.rawValue;
            return typeof raw === 'string' ? raw : null;
        }
        return null;
    } finally {
        URL.revokeObjectURL(url);
        if (img) img.src = '';
    }
}

// Promise wrapper for HTMLImageElement.onload. Rejects on the next
// tick if the image fails to decode (corrupt PNG / unsupported
// format / etc).
function loadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load the dropped image.'));
        img.src = url;
    });
}
