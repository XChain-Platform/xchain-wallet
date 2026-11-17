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
    'governance.action.addOption': 'Add Option',
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
    'governance.statusFilter.label': 'Status',
    'governance.statusFilter.help': 'Shows polls in the status you pick.',
    'governance.statusFilter.all': 'All statuses',
    'governance.statusFilter.open': 'Open',
    'governance.statusFilter.pending': 'Not started',
    'governance.statusFilter.closed': 'Closed',
    'governance.newMenu': 'New poll or delegation',
    'governance.pollNumber': 'Poll #{id}',
    // --- my delegations -------------------------------------------
    'governance.myDelegations': 'My delegations',
    'governance.delegations.title': 'My Delegations',
    'governance.delegations.loading': 'Loading delegations…',
    'governance.delegations.loadingLabel': 'Loading delegations',
    'governance.delegations.error': "Couldn't load your delegations. Try again.",
    'governance.delegations.empty.title': 'No delegations',
    'governance.delegations.empty.body': "This address hasn't delegated its votes on any token.",
    'governance.delegations.clearLabel': 'Clear the {tick} delegation',
    'governance.delegations.filter': 'Filter delegations',
    'governance.delegations.searchPlaceholder': 'Search delegations',
    'governance.delegations.searchLabel': 'Search delegations by token or delegate',
    'governance.delegations.noMatch.title': 'No matching delegations',
    'governance.delegations.noMatch.body': 'No delegation matches this search.',
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
    'governance.detail.countedAtCloseShort': 'Counted at close',
    'governance.detail.finalizing': 'Final results are being finalized.',
    'governance.detail.noResults': 'No finalized results are available.',
    'governance.detail.turnoutVoters': 'Turnout: {count} voters',
    'governance.detail.quorumMet': 'Quorum {quorum} met',
    'governance.detail.quorumNotMet': 'Quorum {quorum} not met',
    'governance.detail.quorumNeeded': 'Quorum {quorum} of supply needed',
    'governance.detail.yourVoteLabel': 'Your vote',
    'governance.detail.vote': 'Vote',
    // The Vote tab's choice list, one row per choice, like the bet market's
    // outcome list: a row opens Cast Vote with that choice.
    'governance.detail.choiceList': 'Choice to vote for',
    'governance.detail.voteFor': 'Vote for {option}',
    'governance.detail.networkHelp': 'The chain this poll lives on. Ballots are cast from an address on it.',
    'governance.detail.noRules': 'This poll sets no turnout rules.',
    'governance.detail.quorum': 'Quorum',
    'governance.detail.ofSupply': '{share} of supply',
    'governance.detail.minVoters': 'Minimum voters',
    'governance.detail.minBalance': 'Minimum vote balance',
    'governance.detail.earlyDecide': 'Early-decide threshold',
    'governance.detail.pollNumber': 'Poll number',
    'governance.detail.creator': 'Creator',
    'governance.detail.createdAt': 'Created at block',
    // --- poll page toggle and the Cast Vote step -----------------
    'governance.detail.sections': 'Poll sections',
    'governance.detail.youVoted': 'You voted: {choice}',
    'governance.detail.castVoteTitle': 'Cast Vote',
    'governance.detail.signVote': 'Sign Vote',
    'governance.detail.change': 'Change',
    'governance.detail.changeChoice': 'Change your choice',
    'governance.detail.votingWeight': 'Voting weight: {amount} {tick}, measured at the close block',
    // --- the shared outcome hero and Details, as the bet page draws them ---
    'governance.detail.pageTitle': 'Poll',
    'governance.detail.voteUnit': 'vote',
    'governance.detail.votesUnit': 'votes',
    'governance.detail.voterUnit': 'voter',
    'governance.detail.votersUnit': 'voters',
    'governance.detail.final': 'Final',
    'governance.detail.finalResult': 'Final result',
    'governance.detail.shareOfEach': 'Share of each option',
    'governance.detail.detailsLabel': 'Poll details',
    'governance.detail.countedLabel': 'Results counted',
    'governance.detail.countedValue': 'At the close block',
    'governance.detail.votesCast': 'Votes cast',
    'governance.detail.votersLabel': 'Voters',
    'governance.detail.weightLabel': 'Voting weight',
    'governance.detail.weightBalance': '{tick} balance at the close block',
    'governance.detail.ballotLabel': 'Ballot',
    'governance.detail.ballotChooseOne': 'Choose 1',
    'governance.detail.ballotChooseUpTo': 'Choose up to {count}',
    'governance.detail.ballotSplit': 'Split weight across options',
};

addEnglish(messages);

export default messages;
