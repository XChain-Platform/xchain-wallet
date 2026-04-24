// Popup top-level state machine.
//
// Primary state (from the background):
//   loading      -> no-wallet | locked | unlocked | error
//   locked       -> unlocked
//   unlocked     -> locked
//   no-wallet    -> locked  (onboarding → create/import → unlock)
//
// Sub-routes:
//   no-wallet   : welcome | create | import
//   unlocked    : home | send | receive
//
// All routes render from @xchain-wallet/core/shared/routes/* via the
// MessagingProvider context (shell="popup"). Popup-local wiring boils
// down to session-state polling and sub-route navigation.

import { useCallback, useEffect, useState } from 'react';
import { MessagingProvider } from '@xchain-wallet/core/shared/MessagingProvider.jsx';
import { Loading } from '@xchain-wallet/core/shared/routes/Loading.jsx';
import { Onboarding } from '@xchain-wallet/core/shared/routes/Onboarding.jsx';
import { CreateWallet } from '@xchain-wallet/core/shared/routes/CreateWallet.jsx';
import { ImportWallet } from '@xchain-wallet/core/shared/routes/ImportWallet.jsx';
import { Locked } from '@xchain-wallet/core/shared/routes/Locked.jsx';
import { Home } from '@xchain-wallet/core/shared/routes/Home.jsx';
import { Receive } from '@xchain-wallet/core/shared/routes/Receive.jsx';
import { Send } from '@xchain-wallet/core/shared/routes/Send.jsx';
import { TokenWizard } from '@xchain-wallet/core/shared/routes/TokenWizard.jsx';
import { ActionsMenu } from '@xchain-wallet/core/shared/routes/ActionsMenu.jsx';
import { IssueTokenForm } from '@xchain-wallet/core/shared/routes/IssueTokenForm.jsx';
import { MintForm } from '@xchain-wallet/core/shared/routes/MintForm.jsx';
import { DestroyForm } from '@xchain-wallet/core/shared/routes/DestroyForm.jsx';
import { TokenAdminForm } from '@xchain-wallet/core/shared/routes/TokenAdminForm.jsx';
import { BroadcastForm } from '@xchain-wallet/core/shared/routes/BroadcastForm.jsx';
import { DispenserForm } from '@xchain-wallet/core/shared/routes/DispenserForm.jsx';
import { DispensersList } from '@xchain-wallet/core/shared/routes/DispensersList.jsx';
import { DispenserDetail } from '@xchain-wallet/core/shared/routes/DispenserDetail.jsx';
import { DispenserExplorer } from '@xchain-wallet/core/shared/routes/DispenserExplorer.jsx';
import { DividendForm } from '@xchain-wallet/core/shared/routes/DividendForm.jsx';
import { AirdropForm } from '@xchain-wallet/core/shared/routes/AirdropForm.jsx';
import { AdvancedActionsForm } from '@xchain-wallet/core/shared/routes/AdvancedActionsForm.jsx';
import { MigrateToBip39 } from '@xchain-wallet/core/shared/routes/MigrateToBip39.jsx';
import { MarketsList } from '@xchain-wallet/core/shared/routes/MarketsList.jsx';
import { MarketView } from '@xchain-wallet/core/shared/routes/MarketView.jsx';
import { CoinpayForm } from '@xchain-wallet/core/shared/routes/CoinpayForm.jsx';
import { SwapForm } from '@xchain-wallet/core/shared/routes/SwapForm.jsx';
import { MessagingInbox } from '@xchain-wallet/core/shared/routes/MessagingInbox.jsx';
import { ComposeMessage } from '@xchain-wallet/core/shared/routes/ComposeMessage.jsx';
import { ContactsList } from '@xchain-wallet/core/shared/routes/ContactsList.jsx';
import { ContractsList } from '@xchain-wallet/core/shared/routes/ContractsList.jsx';
import { ContractDetail } from '@xchain-wallet/core/shared/routes/ContractDetail.jsx';
import { DeployContractForm } from '@xchain-wallet/core/shared/routes/DeployContractForm.jsx';
import { ExecuteContractForm } from '@xchain-wallet/core/shared/routes/ExecuteContractForm.jsx';
import { ContractFundsForm } from '@xchain-wallet/core/shared/routes/ContractFundsForm.jsx';
import { StakingDashboard } from '@xchain-wallet/core/shared/routes/StakingDashboard.jsx';
import { StakeForm } from '@xchain-wallet/core/shared/routes/StakeForm.jsx';
import { StakingActionForm } from '@xchain-wallet/core/shared/routes/StakingActionForm.jsx';
import { DelegationActionForm } from '@xchain-wallet/core/shared/routes/DelegationActionForm.jsx';
import { OperatorDashboard } from '@xchain-wallet/core/shared/routes/OperatorDashboard.jsx';
import { History } from '@xchain-wallet/core/shared/routes/History.jsx';
import { LinkForm } from '@xchain-wallet/core/shared/routes/LinkForm.jsx';
import { ParallelComposer } from '@xchain-wallet/core/shared/routes/ParallelComposer.jsx';
import { PairSignerForm } from '@xchain-wallet/core/shared/routes/PairSignerForm.jsx';
import { useBtcAddressesPresent } from '@xchain-wallet/core/shared/hooks/useBtcAddressesPresent.js';
import { pairTrezorSigner } from '../signers/trezorFactory.js';
import { pairLedgerSigner } from '../signers/ledgerFactory.js';
import { registerSigner as registerLocalSigner } from './signerBridge.js';
import * as messaging from './messaging.js';
import { getSessionStatus, listWallets } from './messaging.js';

export function App() {
    return (
        <MessagingProvider shell="popup" messaging={messaging}>
            <AppInner />
        </MessagingProvider>
    );
}

function AppInner() {
    const [status, setStatus] = useState(/** @type {any} */ ({ state: 'loading' }));
    const [onboardingStep, setOnboardingStep] = useState(
        /** @type {'welcome' | 'create' | 'import' | 'import-freewallet'} */ ('welcome'),
    );
    const [unlockedView, setUnlockedView] = useState(
        /** @type {'home' | 'send' | 'receive' | 'wizard' | 'actions' | 'issue' | 'mint' | 'destroy' | 'lock' | 'description' | 'transfer' | 'broadcast' | 'dispenser' | 'dispensers-list' | 'dispenser-detail' | 'dispenser-explorer' | 'dividend' | 'airdrop' | 'advanced' | 'migrate-bip39' | 'pair-signer' | 'markets' | 'market' | 'coinpay' | 'swap' | 'messaging' | 'compose-message' | 'contacts' | 'contracts-list' | 'contract-detail' | 'contract-deploy' | 'contract-execute' | 'contract-deposit' | 'contract-withdraw' | 'staking-dashboard' | 'stake-form' | 'staking-unstake' | 'staking-claim' | 'staking-delegate' | 'staking-revoke' | 'operator-dashboard' | 'history' | 'link-form' | 'parallel-compose'} */ ('home'),
    );
    const [resumeAirdropId, setResumeAirdropId] = useState(
        /** @type {string | null} */ (null),
    );
    const [resumeCoinpay, setResumeCoinpay] = useState(
        /** @type {{ chainId: string, address: string, orderMatchActionIndex: string } | null} */ (null),
    );
    const [composePrefill, setComposePrefill] = useState(
        /** @type {{ chainId?: string, fromAddressId?: string, toAddress?: string } | null} */ (null),
    );
    const [activeWalletId, setActiveWalletId] = useState(
        /** @type {string | null} */ (null),
    );
    const [dispenserRef, setDispenserRef] = useState(
        /** @type {{ chainId: string, actionIndex: string } | null} */ (null),
    );
    const [contractRef, setContractRef] = useState(
        /** @type {{ chainId: string, contractActionIndex: string } | null} */ (null),
    );
    const [stakingRef, setStakingRef] = useState(
        /** @type {{ chainId: string, address: string } | null} */ (null),
    );
    const [activeMarket, setActiveMarket] = useState(
        /** @type {{ chainId: string, tick1: string, tick2: string } | null} */ (null),
    );

    const refresh = useCallback(() => {
        setStatus({ state: 'loading' });
        setOnboardingStep('welcome');
        setUnlockedView('home');
        getSessionStatus()
            .then((next) => setStatus(next))
            .catch((err) =>
                setStatus({ state: 'error', error: err?.message || String(err) }),
            );
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    useEffect(() => {
        if (status.state !== 'unlocked') {
            setActiveWalletId(null);
            return;
        }
        let cancelled = false;
        listWallets()
            .then((list) => {
                if (cancelled) return;
                if (Array.isArray(list) && list.length > 0) {
                    setActiveWalletId(list[0].id);
                }
            })
            .catch(() => { /* Home surfaces load errors */ });
        return () => { cancelled = true; };
    }, [status.state]);

    // §42.2 Contracts nav — show only when a BTC wallet address exists
    // (VM actions are BTC-only at launch per BITCOIN_ACTIONS).
    const hasBtcAddress = useBtcAddressesPresent(activeWalletId);

    switch (status.state) {
        case 'loading':
            return <Loading />;
        case 'error':
            return <Loading error={status.error} />;
        case 'no-wallet':
            if (onboardingStep === 'create') {
                return (
                    <CreateWallet
                        onBack={() => setOnboardingStep('welcome')}
                        onCreated={refresh}
                    />
                );
            }
            if (onboardingStep === 'import') {
                return (
                    <ImportWallet
                        onBack={() => setOnboardingStep('welcome')}
                        onImported={refresh}
                    />
                );
            }
            if (onboardingStep === 'import-freewallet') {
                return (
                    <ImportWallet
                        variant="freewallet"
                        onBack={() => setOnboardingStep('welcome')}
                        onImported={refresh}
                    />
                );
            }
            return (
                <Onboarding
                    onCreate={() => setOnboardingStep('create')}
                    onImport={() => setOnboardingStep('import')}
                    onImportFromFreeWallet={() => setOnboardingStep('import-freewallet')}
                />
            );
        case 'locked':
            return <Locked onUnlocked={refresh} />;
        case 'unlocked':
            if (unlockedView === 'send' && activeWalletId) {
                return (
                    <Send
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'receive' && activeWalletId) {
                return (
                    <Receive
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'wizard' && activeWalletId) {
                return (
                    <TokenWizard
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'issue' && activeWalletId) {
                return (
                    <IssueTokenForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'mint' && activeWalletId) {
                return (
                    <MintForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'destroy' && activeWalletId) {
                return (
                    <DestroyForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (
                (unlockedView === 'lock'
                    || unlockedView === 'description'
                    || unlockedView === 'transfer')
                && activeWalletId
            ) {
                return (
                    <TokenAdminForm
                        walletId={activeWalletId}
                        mode={unlockedView}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'broadcast' && activeWalletId) {
                return (
                    <BroadcastForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'dispenser' && activeWalletId) {
                return (
                    <DispenserForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'dispensers-list' && activeWalletId) {
                return (
                    <DispensersList
                        walletId={activeWalletId}
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex, origin: 'list' });
                            setUnlockedView('dispenser-detail');
                        }}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'dispenser-detail' && activeWalletId && dispenserRef) {
                return (
                    <DispenserDetail
                        walletId={activeWalletId}
                        chainId={dispenserRef.chainId}
                        actionIndex={dispenserRef.actionIndex}
                        onBack={() => setUnlockedView(dispenserRef.origin === 'explorer' ? 'dispenser-explorer' : 'dispensers-list')}
                    />
                );
            }
            if (unlockedView === 'dispenser-explorer' && activeWalletId) {
                return (
                    <DispenserExplorer
                        onOpenDispenser={(chainId, actionIndex) => {
                            setDispenserRef({ chainId, actionIndex, origin: 'explorer' });
                            setUnlockedView('dispenser-detail');
                        }}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'dividend' && activeWalletId) {
                return (
                    <DividendForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'airdrop' && activeWalletId) {
                return (
                    <AirdropForm
                        walletId={activeWalletId}
                        resumeId={resumeAirdropId}
                        onBack={() => {
                            setResumeAirdropId(null);
                            setUnlockedView(resumeAirdropId ? 'home' : 'actions');
                        }}
                    />
                );
            }
            if (unlockedView === 'advanced' && activeWalletId) {
                return (
                    <AdvancedActionsForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'migrate-bip39' && activeWalletId) {
                return (
                    <MigrateToBip39
                        legacyWalletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                        onMigrated={refresh}
                    />
                );
            }
            if (unlockedView === 'pair-signer' && activeWalletId) {
                return (
                    <PairSignerForm
                        walletId={activeWalletId}
                        pairTrezor={pairTrezorSigner}
                        pairLedger={pairLedgerSigner}
                        onBack={() => setUnlockedView('actions')}
                        onPaired={() => setUnlockedView('actions')}
                        onSignerPaired={registerLocalSigner}
                    />
                );
            }
            if (unlockedView === 'markets' && activeWalletId) {
                return (
                    <MarketsList
                        walletId={activeWalletId}
                        onOpenMarket={(chainId, tick1, tick2) => {
                            setActiveMarket({ chainId, tick1, tick2 });
                            setUnlockedView('market');
                        }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'market' && activeMarket && activeWalletId) {
                return (
                    <MarketView
                        walletId={activeWalletId}
                        chainId={activeMarket.chainId}
                        tick1={activeMarket.tick1}
                        tick2={activeMarket.tick2}
                        onBack={() => {
                            setActiveMarket(null);
                            setUnlockedView('markets');
                        }}
                    />
                );
            }
            if (unlockedView === 'coinpay' && activeWalletId) {
                return (
                    <CoinpayForm
                        walletId={activeWalletId}
                        chainId={resumeCoinpay?.chainId}
                        address={resumeCoinpay?.address}
                        orderMatchActionIndex={resumeCoinpay?.orderMatchActionIndex}
                        onBack={() => {
                            const cameFromResume = resumeCoinpay !== null;
                            setResumeCoinpay(null);
                            setUnlockedView(cameFromResume ? 'home' : 'actions');
                        }}
                    />
                );
            }
            if (unlockedView === 'swap' && activeWalletId) {
                return (
                    <SwapForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'link-form' && activeWalletId) {
                return (
                    <LinkForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'parallel-compose' && activeWalletId) {
                return (
                    <ParallelComposer
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'messaging' && activeWalletId) {
                return (
                    <MessagingInbox
                        walletId={activeWalletId}
                        onCompose={(prefill) => {
                            setComposePrefill(prefill || null);
                            setUnlockedView('compose-message');
                        }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'compose-message' && activeWalletId) {
                return (
                    <ComposeMessage
                        walletId={activeWalletId}
                        chainId={composePrefill?.chainId}
                        fromAddressId={composePrefill?.fromAddressId}
                        toAddress={composePrefill?.toAddress}
                        onBack={() => {
                            const from = composePrefill?.__from || 'messaging';
                            setComposePrefill(null);
                            setUnlockedView(from);
                        }}
                    />
                );
            }
            if (unlockedView === 'contacts' && activeWalletId) {
                return (
                    <ContactsList
                        walletId={activeWalletId}
                        onSendMessage={(prefill) => {
                            setComposePrefill({ ...prefill, __from: 'contacts' });
                            setUnlockedView('compose-message');
                        }}
                        onBack={() => setUnlockedView('actions')}
                    />
                );
            }
            if (unlockedView === 'contracts-list' && activeWalletId) {
                return (
                    <ContractsList
                        walletId={activeWalletId}
                        onOpenContract={(cid, actionIndex) => {
                            setContractRef({ chainId: cid, contractActionIndex: String(actionIndex) });
                            setUnlockedView('contract-detail');
                        }}
                        onDeploy={() => setUnlockedView('contract-deploy')}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'contract-detail' && activeWalletId && contractRef) {
                return (
                    <ContractDetail
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onExecute={() => setUnlockedView('contract-execute')}
                        onDeposit={() => setUnlockedView('contract-deposit')}
                        onWithdraw={() => setUnlockedView('contract-withdraw')}
                        onBack={() => setUnlockedView('contracts-list')}
                    />
                );
            }
            if (unlockedView === 'contract-deploy' && activeWalletId) {
                return (
                    <DeployContractForm
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('contracts-list')}
                    />
                );
            }
            if (unlockedView === 'contract-execute' && activeWalletId && contractRef) {
                return (
                    <ExecuteContractForm
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onBack={() => setUnlockedView('contract-detail')}
                    />
                );
            }
            if (unlockedView === 'contract-deposit' && activeWalletId && contractRef) {
                return (
                    <ContractFundsForm
                        mode="deposit"
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onBack={() => setUnlockedView('contract-detail')}
                    />
                );
            }
            if (unlockedView === 'contract-withdraw' && activeWalletId && contractRef) {
                return (
                    <ContractFundsForm
                        mode="withdraw"
                        walletId={activeWalletId}
                        chainId={contractRef.chainId}
                        contractActionIndex={contractRef.contractActionIndex}
                        onBack={() => setUnlockedView('contract-detail')}
                    />
                );
            }
            if (unlockedView === 'staking-dashboard' && activeWalletId) {
                return (
                    <StakingDashboard
                        walletId={activeWalletId}
                        onStake={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('stake-form');
                        }}
                        onUnstake={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('staking-unstake');
                        }}
                        onClaimRewards={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('staking-claim');
                        }}
                        onDelegate={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('staking-delegate');
                        }}
                        onRevokeDelegation={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('staking-revoke');
                        }}
                        onOpenOperatorDashboard={(ref) => {
                            setStakingRef(ref);
                            setUnlockedView('operator-dashboard');
                        }}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'stake-form' && activeWalletId && stakingRef) {
                return (
                    <StakeForm
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'staking-unstake' && activeWalletId && stakingRef) {
                return (
                    <StakingActionForm
                        mode="unstake"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'staking-claim' && activeWalletId && stakingRef) {
                return (
                    <StakingActionForm
                        mode="claim-rewards"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'staking-delegate' && activeWalletId && stakingRef) {
                return (
                    <DelegationActionForm
                        mode="delegate"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'staking-revoke' && activeWalletId && stakingRef) {
                return (
                    <DelegationActionForm
                        mode="revoke"
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'operator-dashboard' && activeWalletId && stakingRef) {
                return (
                    <OperatorDashboard
                        walletId={activeWalletId}
                        chainId={stakingRef.chainId}
                        address={stakingRef.address}
                        onBack={() => setUnlockedView('staking-dashboard')}
                    />
                );
            }
            if (unlockedView === 'history' && activeWalletId) {
                return (
                    <History
                        walletId={activeWalletId}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            if (unlockedView === 'actions' && activeWalletId) {
                return (
                    <ActionsMenu
                        entries={buildActionEntries({
                            onIssue: () => setUnlockedView('issue'),
                            onMint: () => setUnlockedView('mint'),
                            onDestroy: () => setUnlockedView('destroy'),
                            onLock: () => setUnlockedView('lock'),
                            onUpdateDescription: () => setUnlockedView('description'),
                            onTransferOwnership: () => setUnlockedView('transfer'),
                            onBroadcast: () => setUnlockedView('broadcast'),
                            onCreateDispenser: () => setUnlockedView('dispenser'),
                            onMyDispensers: () => setUnlockedView('dispensers-list'),
                            onBrowseDispensers: () => setUnlockedView('dispenser-explorer'),
                            onPayDividend: () => setUnlockedView('dividend'),
                            onAirdrop: () => {
                                setResumeAirdropId(null);
                                setUnlockedView('airdrop');
                            },
                            onAdvanced: () => setUnlockedView('advanced'),
                            onPairSigner: () => setUnlockedView('pair-signer'),
                            onPayCoinpay: () => {
                                setResumeCoinpay(null);
                                setUnlockedView('coinpay');
                            },
                            onSwap: () => setUnlockedView('swap'),
                            onLink: () => setUnlockedView('link-form'),
                            onParallel: () => setUnlockedView('parallel-compose'),
                            onContacts: () => setUnlockedView('contacts'),
                        })}
                        onBack={() => setUnlockedView('home')}
                    />
                );
            }
            return (
                <Home
                    onLocked={refresh}
                    onSend={activeWalletId ? () => setUnlockedView('send') : undefined}
                    onReceive={activeWalletId ? () => setUnlockedView('receive') : undefined}
                    onCreateToken={activeWalletId ? () => setUnlockedView('wizard') : undefined}
                    onActions={activeWalletId ? () => setUnlockedView('actions') : undefined}
                    onMarkets={activeWalletId ? () => setUnlockedView('markets') : undefined}
                    onMessaging={activeWalletId ? () => setUnlockedView('messaging') : undefined}
                    onContracts={activeWalletId && hasBtcAddress ? () => setUnlockedView('contracts-list') : undefined}
                    onStaking={activeWalletId && hasBtcAddress ? () => setUnlockedView('staking-dashboard') : undefined}
                    onHistory={activeWalletId ? () => setUnlockedView('history') : undefined}
                    onResumeAirdrop={activeWalletId ? (id) => {
                        setResumeAirdropId(id);
                        setUnlockedView('airdrop');
                    } : undefined}
                    onResumeCoinpay={activeWalletId ? (ref) => {
                        setResumeCoinpay(ref);
                        setUnlockedView('coinpay');
                    } : undefined}
                    onMigrateToBip39={activeWalletId ? () => setUnlockedView('migrate-bip39') : undefined}
                />
            );
        default:
            return <Loading error={`unknown state "${status.state}"`} />;
    }
}

/**
 * Build the Actions menu entries shared across both shells. Each entry
 * maps a §40.2+ authoring surface to the host's sub-route. New entries
 * land here as the standalone forms ship (MINT, DESTROY, admin, …).
 */
function buildActionEntries({
    onIssue, onMint, onDestroy,
    onLock, onUpdateDescription, onTransferOwnership,
    onBroadcast,
    onCreateDispenser,
    onMyDispensers,
    onBrowseDispensers,
    onPayDividend,
    onAirdrop,
    onAdvanced,
    onPairSigner,
    onPayCoinpay,
    onSwap,
    onLink,
    onParallel,
    onContacts,
}) {
    return [
        {
            id: 'issue',
            label: 'Issue token',
            description: 'Advanced ISSUE form — every field exposed (§40.2).',
            onSelect: onIssue,
        },
        {
            id: 'mint',
            label: 'Mint',
            description: 'Mint additional supply of a token you own (§40.3).',
            onSelect: onMint,
        },
        {
            id: 'destroy',
            label: 'Destroy',
            description: 'Burn part of your balance — irreversible (§40.4).',
            onSelect: onDestroy,
        },
        {
            id: 'lock',
            label: 'Lock supply',
            description: 'Freeze supply + minting for a token you own — permanent (§40.5).',
            onSelect: onLock,
        },
        {
            id: 'description',
            label: 'Update description',
            description: 'Change a token\'s on-chain description (§40.5).',
            onSelect: onUpdateDescription,
        },
        {
            id: 'transfer',
            label: 'Transfer ownership',
            description: 'Hand token ownership to another address (§40.5).',
            onSelect: onTransferOwnership,
        },
        {
            id: 'broadcast',
            label: 'Broadcast',
            description: 'Publish text, oracle value, or feed reference on-chain (§40.6).',
            onSelect: onBroadcast,
        },
        {
            id: 'dispenser',
            label: 'Create dispenser',
            description: 'Open a vending machine that sells your token for coin or FIAT (§40.7.1).',
            onSelect: onCreateDispenser,
        },
        {
            id: 'dispensers-list',
            label: 'My dispensers',
            description: 'Manage dispensers you have opened — view + cancel (§40.7.1).',
            onSelect: onMyDispensers,
        },
        {
            id: 'dispenser-explorer',
            label: 'Browse dispensers',
            description: 'Search for open dispensers by token or address (§40.7.2).',
            onSelect: onBrowseDispensers,
        },
        {
            id: 'dividend',
            label: 'Pay dividend',
            description: 'Distribute a dividend asset to holders of a token pro rata (§40.8).',
            onSelect: onPayDividend,
        },
        {
            id: 'airdrop',
            label: 'Airdrop tokens',
            description: 'Distribute a token to a pasted or uploaded list of addresses — signs a LIST then an AIRDROP (§40.9).',
            onSelect: onAirdrop,
        },
        {
            id: 'coinpay',
            label: 'Pay COINPAY',
            description: 'Settle a pending token/coin order match by paying the native-coin leg (§41.4).',
            onSelect: onPayCoinpay,
        },
        {
            id: 'swap',
            label: 'Swap tokens',
            description: 'Atomic token-pair swap — no native coin, no COINPAY follow-up (§41.5).',
            onSelect: onSwap,
        },
        {
            id: 'link',
            label: 'Link cross-chain actions',
            description: 'Anchor two existing actions across chains with a LINK action (§42.8.1). Both sides thread together in History.',
            onSelect: onLink,
        },
        {
            id: 'parallel',
            label: 'Parallel cross-chain actions',
            description: 'Compose multiple independent actions across any chains and sign them sequentially (§42.8.2). Not atomic — failures do not roll back.',
            onSelect: onParallel,
        },
        {
            id: 'contacts',
            label: 'Contacts',
            description: 'Local address book — label counterparties, quick-compose to saved recipients (§41.7.4).',
            onSelect: onContacts,
        },
        {
            id: 'advanced',
            label: 'Advanced action',
            description: 'Submit any action the SDK supports — power-user surface for ADDRESS / CALLBACK / SLEEP / raw MESSAGE (§40.10).',
            onSelect: onAdvanced,
        },
        {
            id: 'pair-signer',
            label: 'Pair hardware signer',
            description: 'Add a Trezor or Ledger to this wallet (§17.6 / §18.3).',
            onSelect: onPairSigner,
        },
    ];
}
