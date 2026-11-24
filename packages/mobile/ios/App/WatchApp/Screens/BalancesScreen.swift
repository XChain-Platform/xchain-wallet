// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct BalanceSelection: Hashable {
    let id: String
}

struct BalancesScreenRow: Identifiable {
    let selection: BalanceSelection
    let index: Int
    let row: SnapshotRow
    let line: BalanceLine

    var id: String { selection.id }
}

struct BalancesScreen: View {
    static let crownStep = 1

    let snapshot: Snapshot?
    let mode: WatchUnitsMode?
    let phoneReachable: Bool
    let now: Int64?
    let setMode: (WatchUnitsMode) -> Void
    let open: (WatchScreen) -> Void

    @State private var crownDetent = 0
    @State private var scrollTarget: Int?

    var display: BalancesDisplay {
        BalancesPresenter.present(
            snapshot: snapshot, mode: mode, phoneReachable: phoneReachable, now: now
        )
    }

    var rows: [BalancesScreenRow] {
        guard let snapshot else { return [] }
        return zip(snapshot.rows, display.lines).enumerated().compactMap { index, pair in
            guard pair.1.name != nil else { return nil }
            return BalancesScreenRow(
                selection: BalanceSelection(id: pair.0.id),
                index: index,
                row: pair.0,
                line: pair.1
            )
        }
    }

    var unread: Int { snapshot?.inbox.filter { !$0.read }.count ?? 0 }
    var crownUpperBound: Int { max(rows.count - 1, 0) }

    var resolvedMode: WatchUnitsMode {
        WatchUnitsMode.resolve(
            stored: mode,
            unitDefault: snapshot?.unitDefault,
            isTest: snapshot?.network.isTest ?? false
        )
    }

    func toggleUnits() {
        guard let target = BalancesToolbarRules.headerTap(
            mode: resolvedMode,
            isTest: snapshot?.network.isTest ?? false
        ) else { return }
        setMode(target)
    }

    var body: some View {
        List {
            ForEach(display.banners, id: \.self) {
                Text(LocalizedStringKey($0)).font(.caption2)
            }
            if let header = display.header { headerButton(header) }
            ForEach(rows) { row in rowLink(row).id(row.index) }
            ForEach(Array(display.lines.dropFirst(rows.count).enumerated()), id: \.offset) {
                _, line in
                if let key = line.key { Text(LocalizedStringKey(key)).font(.caption2) }
            }
            if let age = display.ageLine { Text(LocalizedStringKey(age)).font(.caption2) }
        }
        .scrollPosition(id: $scrollTarget)
        .digitalCrownRotation(
            detent: $crownDetent,
            from: 0,
            through: crownUpperBound,
            by: Self.crownStep,
            sensitivity: .medium,
            isContinuous: false,
            isHapticFeedbackEnabled: true
        ) { _ in
            scrollTarget = crownDetent
        }
        .navigationTitle("w1.title")
        .toolbar { toolbarContent }
        .overlay(alignment: .topLeading) { doubleTapShortcut }
    }

    func headerButton(_ header: BalanceText) -> BalancesHeaderButton {
        BalancesHeaderButton(header: header, action: toggleUnits)
    }

    @ViewBuilder
    var doubleTapShortcut: some View {
        if #available(watchOS 11, *) {
            Button(action: toggleUnits) { EmptyView() }
                .handGestureShortcut(.primaryAction)
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        }
    }

    var toolbarContent: BalancesToolbar {
        BalancesToolbar(unread: unread, open: open)
    }

    func rowLink(_ item: BalancesScreenRow) -> some View {
        NavigationLink(value: item.selection) {
            BalanceRowView(
                name: item.line.name ?? "",
                chainId: item.row.chainId,
                tick: item.row.tick,
                tickerColor: item.row.tickerColor,
                amountCell: (cellText(item.line.primary), item.line.secondary?.text)
            )
        }
    }

    private func cellText(_ text: BalanceText?) -> String {
        text?.text ?? text?.key.map { NSLocalizedString($0, comment: "") } ?? ""
    }
}

struct BalancesHeaderButton: View {
    let header: BalanceText
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(header.key.map { LocalizedStringKey($0) } ?? LocalizedStringKey(header.text ?? ""))
                .font(.headline)
        }
    }
}

struct BalancesToolbar: ToolbarContent {
    let controls: [BalancesToolbarRules.Control]
    let iconNames: [String]
    let unread: Int
    let open: (WatchScreen) -> Void

    init(unread: Int, open: @escaping (WatchScreen) -> Void) {
        controls = BalancesToolbarRules.controls
        iconNames = [unread > 0 ? "bell.badge" : "bell", "qrcode", "info.circle"]
        self.unread = unread
        self.open = open
    }

    var body: some ToolbarContent {
        ToolbarItemGroup {
            controlButton(.bell)
            controlButton(.qr)
            controlButton(.status)
        }
    }

    func controlButton(_ control: BalancesToolbarRules.Control) -> some View {
        Button { open(BalancesToolbarRules.destination(control)) } label: {
            Image(systemName: iconName(control))
        }
    }

    private func iconName(_ control: BalancesToolbarRules.Control) -> String {
        switch control {
        case .bell:
            return BalancesToolbarRules.showsUnreadDot(unread: unread) ? "bell.badge" : "bell"
        case .qr:
            return "qrcode"
        case .status:
            return "info.circle"
        }
    }
}
