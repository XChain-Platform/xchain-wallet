// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI

struct WatchAmountFit: ViewModifier {
    func body(content: Content) -> some View {
        content
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}

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
    var onShown: () -> Void = { WatchEventLog.screenShown(.balances) }

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

    var requestModel: AlertsPresenter.RequestModel? {
        guard let snapshot, !snapshot.request.id.isEmpty else { return nil }
        return AlertsPresenter.request(snapshot.request, now: now ?? snapshot.builtAt)
    }

    func toggleUnits() {
        guard let target = BalancesToolbarRules.headerTap(
            mode: resolvedMode,
            isTest: snapshot?.network.isTest ?? false
        ) else { return }
        setMode(target)
    }

    func appeared() {
        onShown()
    }

    var body: some View {
        List {
            ForEach(display.banners, id: \.self) {
                banner($0)
            }
            if let header = display.header { headerButton(header) }
            if let requestModel { requestLink(requestModel) }
            ForEach(rows) { row in rowLink(row).id(row.index) }
            ForEach(Array(display.lines.dropFirst(rows.count).enumerated()), id: \.offset) {
                offset, line in
                if let key = line.key {
                    statusLine(key, index: rows.count + offset)
                }
            }
            if let age = display.ageLine {
                ageLine(age)
            }
        }
        .onAppear { appeared() }
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
        BalancesHeaderButton(
            header: header,
            accessibilityLabel: headerLabel(),
            action: toggleUnits
        )
    }

    func headerLabel() -> String {
        AccessibilityLabels.balanceHeader(display, text: localized)
    }

    func rowLabel(_ index: Int) -> String {
        AccessibilityLabels.balanceLine(display.lines[index], text: localized)
    }

    func requestLabel(_ model: AlertsPresenter.RequestModel) -> String {
        AccessibilityLabels.requestPinned(model, text: localized)
    }

    func controlLabel(_ key: String) -> String {
        AccessibilityLabels.control(key, text: localized)
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

    func requestLink(_ model: AlertsPresenter.RequestModel) -> some View {
        NavigationLink(value: AlertSelection(id: snapshot?.request.id ?? "")) {
            Text(LocalizedStringKey(display.requestKey ?? "w1.requestWaiting"))
        }
        .accessibilityLabel(Text(verbatim: requestLabel(model)))
    }

    func banner(_ key: String) -> some View {
        Text(LocalizedStringKey(key))
            .font(.caption2)
            .accessibilityLabel(Text(verbatim: controlLabel(key)))
    }

    func statusLine(_ key: String, index: Int) -> some View {
        Text(LocalizedStringKey(key))
            .font(.caption2)
            .accessibilityLabel(Text(verbatim: rowLabel(index)))
    }

    func ageLine(_ key: String) -> some View {
        Text(LocalizedStringKey(key))
            .font(.caption2)
            .accessibilityLabel(Text(verbatim: controlLabel(key)))
    }

    func rowLink(_ item: BalancesScreenRow) -> some View {
        NavigationLink(value: item.selection) {
            fittedRow(item)
        }
        .accessibilityLabel(Text(verbatim: rowLabel(item.index)))
    }

    func fittedRow(_ item: BalancesScreenRow) -> some View {
        rowView(item).modifier(WatchAmountFit())
    }

    func rowView(_ item: BalancesScreenRow) -> BalanceRowView {
        BalanceRowView(
            name: item.line.name ?? "",
            chainId: item.row.chainId,
            tick: item.row.tick,
            tickerColor: item.row.tickerColor,
            amountCell: (cellText(item.line.primary), item.line.secondary?.text)
        )
    }

    private func cellText(_ text: BalanceText?) -> String {
        text?.text ?? text?.key.map { NSLocalizedString($0, comment: "") } ?? ""
    }

    private func localized(_ key: String) -> String {
        NSLocalizedString(key, comment: "")
    }
}

struct BalancesHeaderButton: View {
    let header: BalanceText
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(header.key.map { LocalizedStringKey($0) } ?? LocalizedStringKey(header.text ?? ""))
                .font(.headline)
        }
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

struct BalancesToolbar: ToolbarContent {
    let unread: Int
    let open: (WatchScreen) -> Void

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
        .accessibilityLabel(Text(verbatim: controlLabel(control)))
    }

    func controlLabel(_ control: BalancesToolbarRules.Control) -> String {
        AccessibilityLabels.control(
            labelKey(control),
            text: { NSLocalizedString($0, comment: "") }
        )
    }

    private func labelKey(_ control: BalancesToolbarRules.Control) -> String {
        switch control {
        case .bell: return "w3.title"
        case .qr: return "w1.receive"
        case .status: return "state.status"
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
