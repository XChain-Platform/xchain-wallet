// Copyright © 2025–2026 Dankest, LLC
// Based on XChain Platform by Dankest, LLC – https://dankest.llc
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// This file is part of XChain Platform. Licensed under the GNU Affero
// General Public License v3.0 or later; see LICENSE.md. A commercial
// license (without AGPL source-disclosure terms) is available -
// contact legal@dankest.llc.

// English copy for the `governance.*` keys. Every module that renders one of
// these keys imports this file, so the copy arrives with that module's
// chunk and is registered before the module renders.

import { addEnglish } from '../../store.js';

const messages = {
    // --- governance ----------------------------------------------
    'governance.title': 'Governance Polls',
    'governance.noAddress.title': 'No governance address',
    'governance.noAddress.body': 'Governance requires an address on a supported network.',
    'governance.createPoll': 'Create poll',
    'governance.delegateVotes': 'Delegate votes',
    // Submit-button labels on the governance forms, one per signing path.
    'governance.action.createPoll': 'Create Poll',
    'governance.action.submitVote': 'Submit Vote',
    'governance.action.addOption': 'Add Option',
    'governance.action.delegateVotes': 'Delegate Votes',
    'governance.action.clearDelegation': 'Clear Vote Delegation',
    'governance.action.createUnsigned': 'Create Unsigned Transaction',
    'governance.action.createUnsignedFor': 'Create Unsigned Transaction: {action}',
    'governance.loadingAddresses': 'Loading governance addresses…',
    'governance.loadingAddressesLabel': 'Loading governance addresses',
    'governance.loadingPolls': 'Loading governance polls…',
    'governance.loadingPollsLabel': 'Loading governance polls',
    'governance.error.addresses': "Couldn't load governance addresses. Try again.",
    'governance.error.polls': "Couldn't load governance polls. Try again.",
    'governance.empty.title': 'No polls yet',
    'governance.empty.body': 'Create the first poll for this network.',
    'governance.closesAtBlock': 'Closes at block {block}',
    'governance.filterPolls': 'Filter polls',
    'governance.searchPlaceholder': 'Search polls',
    'governance.searchLabel': 'Search polls by question, token or number',
    'governance.newMenu': 'New poll or delegation',
    'governance.pollNumber': 'Poll #{id}',
    'governance.pollOnNetwork': '{tick} on {network}',
    // --- my delegations -------------------------------------------
    'governance.myDelegations': 'My delegations',
    'governance.delegations.title': 'My Delegations',
    'governance.delegations.address': 'Delegating address',
    'governance.delegations.addressHelp': 'The address whose delegations are listed. Each token it holds can have one delegate.',
    'governance.delegations.addressTitle': 'Delegating Address',
    'governance.delegations.chooseAddress': 'Choose address',
    'governance.delegations.loading': 'Loading delegations…',
    'governance.delegations.loadingLabel': 'Loading delegations',
    'governance.delegations.error': "Couldn't load your delegations. Try again.",
    'governance.delegations.empty.title': 'No delegations',
    'governance.delegations.empty.body': "This address hasn't delegated its votes on any token.",
    'governance.delegations.to': 'To {delegate}',
    'governance.delegations.since': 'Since {when}',
    'governance.delegations.sinceBlock': 'Since block {block}',
    'governance.delegations.clearLabel': 'Clear the {tick} delegation',
    // --- poll page (results first) ------------------------------
    'governance.detail.notAvailable': 'n/a',
    'governance.detail.votingClosed': 'Voting closed',
    'governance.detail.finalBlock': 'Final voting block',
    'governance.detail.closesIn': 'Closes in {time}',
    'governance.detail.awaitingFinal': 'Awaiting finalization',
    'governance.detail.results': 'Poll results',
    'governance.detail.outcome.approved': 'Approved',
    'governance.detail.outcome.rejected': 'Rejected',
    'governance.detail.outcome.noQuorum': 'No quorum',
    'governance.detail.outcome.decided': 'Decided',
    'governance.detail.leading': 'Leading: {option}, {share}%',
    'governance.detail.winner': 'Winner: {option}, {share}%',
    'governance.detail.tied': 'Tied at the top',
    'governance.detail.weight': '{weight} weight',
    'governance.detail.voter': '{count} voter',
    'governance.detail.voters': '{count} voters',
    'governance.detail.countedAtClose': 'Voting is open. Results are counted when voting closes.',
    'governance.detail.finalizing': 'Final results are being finalized.',
    'governance.detail.noResults': 'No finalized results are available.',
    'governance.detail.turnoutVoters': 'Turnout: {count} voters',
    'governance.detail.quorumMet': 'Quorum {quorum} met',
    'governance.detail.quorumNotMet': 'Quorum {quorum} not met',
    'governance.detail.quorumNeeded': 'Quorum {quorum} of supply needed',
    'governance.detail.yourVoteLabel': 'Your vote',
    'governance.detail.yourVote': 'Your vote: {choice}',
    'governance.detail.notVoted': 'Not voted yet',
    'governance.detail.castVote': 'Cast Your Vote',
    'governance.detail.vote': 'Vote',
    'governance.detail.changeVote': 'Change Vote',
    'governance.detail.networkHelp': 'The chain this poll lives on. Ballots are cast from an address on it.',
    'governance.detail.rules': 'Rules to Pass',
    'governance.detail.noRules': 'This poll sets no turnout rules.',
    'governance.detail.quorum': 'Quorum',
    'governance.detail.quorumShort': 'Quorum {quorum}',
    'governance.detail.ofSupply': '{share} of supply',
    'governance.detail.minVoters': 'Minimum voters',
    'governance.detail.minBalance': 'Minimum vote balance',
    'governance.detail.minBalanceShort': 'Min balance {amount}',
    'governance.detail.earlyDecide': 'Early-decide threshold',
    'governance.detail.earlyDecideShort': 'Early decide {share}',
    'governance.detail.pollNumber': 'Poll number',
    'governance.detail.creator': 'Creator',
    'governance.detail.createdAt': 'Created at block',
};

addEnglish(messages);

export default messages;
