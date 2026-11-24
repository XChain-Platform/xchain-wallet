// Copyright © 2025-2026 Dankest, LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import SwiftUI
import WatchConnectivity

@MainActor
final class RootViewModel: ObservableObject {
    @Published private(set) var snapshot: Snapshot?
    @Published private(set) var details: [String: Detail] = [:]
    @Published private(set) var hasSnapshot: Bool
    @Published private(set) var enabled: Bool
    @Published private(set) var phoneReachable = false
    @Published private(set) var mode: WatchUnitsMode?
    @Published private(set) var hideAmounts: Bool
    @Published private var imageRevision = 0

    let appVersion: String
    private let store: SnapshotStore
    private let prefs: WatchPrefs
    private let images: ImageCache
    private let session: PhoneSession

    private(set) lazy var phoneLink = PhoneLink(
        session: session,
        appVersion: appVersion,
        saveSnapshot: { [weak self] data in
            DispatchQueue.main.async { self?.saveSnapshot(data) }
        },
        saveDetail: { [weak self] detail in
            DispatchQueue.main.async { self?.saveDetail(detail) }
        },
        saveImage: { [weak self] data, hash in
            guard let self else { return }
            try images.store(data, hash: hash)
            DispatchQueue.main.async { self.imageRevision += 1 }
        }
    )

    init(
        store: SnapshotStore,
        prefs: WatchPrefs,
        images: ImageCache,
        session: PhoneSession,
        appVersion: String
    ) {
        self.store = store
        self.prefs = prefs
        self.images = images
        self.session = session
        self.appVersion = appVersion
        snapshot = store.latest
        hasSnapshot = store.latest != nil
        enabled = store.latest?.settings.enabled ?? false
        mode = store.latest.map {
            prefs.unitsMode(unitDefault: $0.unitDefault, isTest: $0.network.isTest)
        }
        hideAmounts = prefs.hideAmounts
        _ = phoneLink
    }

    static func live() -> RootViewModel {
        let base = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        )[0].appendingPathComponent("WatchApp", isDirectory: true)
        return RootViewModel(
            store: SnapshotStore(directory: base.appendingPathComponent("snapshots")),
            prefs: WatchPrefs(),
            images: ImageCache(directory: base.appendingPathComponent("images")),
            session: WCSession.default,
            appVersion: Bundle.main.object(
                forInfoDictionaryKey: "CFBundleShortVersionString"
            ) as? String ?? ""
        )
    }

    func activate() {
        phoneLink.activate()
        phoneReachable = phoneLink.isReachable
    }

    func setMode(_ newMode: WatchUnitsMode) {
        guard let snapshot else { return }
        mode = prefs.toggleUnits(
            unitDefault: snapshot.unitDefault,
            isTest: snapshot.network.isTest
        )
        assert(mode == newMode)
    }

    func setHideAmounts(_ hidden: Bool) {
        prefs.hideAmounts = hidden
        hideAmounts = hidden
    }

    func requestDetail(_ tokenId: String) {
        phoneLink.detailRequest(tokenId)
    }

    func markRead(_ intent: MarkReadIntent) {
        phoneLink.markRead(intent.id)
    }

    func openOnPhone(_ route: String) {
        OpenOnPhone(send: session.send)(OpenOnPhoneIntent(route: route))
    }

    func imageData(for hash: String?) -> Data? {
        _ = imageRevision
        return hash.flatMap(images.data)
    }

    private func saveSnapshot(_ data: Data) {
        guard let received = try? JSONDecoder().decode(Snapshot.self, from: data),
              received.session == "unlocked" || received.session == "locked" else { return }
        _ = store.save(data)
        snapshot = store.latest
        hasSnapshot = true
        enabled = received.settings.enabled
        mode = prefs.unitsMode(unitDefault: received.unitDefault, isTest: received.network.isTest)
        phoneReachable = phoneLink.isReachable
        pinImages()
    }

    private func saveDetail(_ detail: Detail) {
        details[detail.tokenId] = detail
        pinImages()
    }

    private func pinImages() {
        let snapshotHashes = Set((snapshot?.rows.map(\.iconHash) ?? []) + [snapshot?.request.iconHash ?? ""])
            .filter { !$0.isEmpty }
        let detailHashes = Set(details.values.compactMap(\.artworkHash))
        images.setPinned(snapshot: snapshotHashes, openDetail: detailHashes)
    }
}

@MainActor
struct RootView: View {
    @StateObject var model: RootViewModel
    @State private var path = NavigationPath()

    @MainActor
    init() {
        _model = StateObject(wrappedValue: RootViewModel.live())
    }

    init(model: RootViewModel) {
        _model = StateObject(wrappedValue: model)
    }

    var rootScreen: WatchScreen {
        WatchScreenGraph.root(hasSnapshot: model.hasSnapshot, enabled: model.enabled)
    }

    var body: some View {
        AmbientRedaction(
            phoneHidden: model.snapshot?.hidden ?? false,
            hideAmounts: model.hideAmounts
        ) { redaction in
            NavigationStack(path: $path) {
                root(redaction: redaction)
                    .navigationDestination(for: WatchScreen.self) {
                        destination($0, redaction: redaction)
                    }
                    .navigationDestination(for: BalanceSelection.self) {
                        tokenDetail($0.id, redaction: redaction)
                    }
                    .navigationDestination(for: AlertSelection.self) {
                        alertDetail($0.id)
                    }
            }
        }
        .task { model.activate() }
    }

    @ViewBuilder
    private func root(redaction: AmbientRedactionState) -> some View {
        if rootScreen == .balances {
            VStack(spacing: 0) {
                if model.snapshot?.request.id.isEmpty == false {
                    NavigationLink(value: WatchScreen.alertDetail) {
                        Label("w1.requestWaiting", systemImage: "iphone.badge.exclamationmark")
                    }
                    .buttonStyle(.bordered)
                }
                balances(redaction: redaction)
            }
        } else {
            NotSetUpScreen(textKey: WatchScreenGraph.notSetUpTextKey(
                hasSnapshot: model.hasSnapshot,
                enabled: model.enabled
            ) ?? "state.openWalletOnPhone")
        }
    }

    private func balances(redaction: AmbientRedactionState) -> some View {
        BalancesScreen(
            snapshot: redactedSnapshot(redaction.redacted),
            mode: model.mode,
            phoneReachable: model.phoneReachable,
            now: Int64(Date().timeIntervalSince1970 * 1_000),
            setMode: model.setMode,
            open: { path.append($0) }
        )
        .privacySensitive(redaction.redacted)
    }

    @ViewBuilder
    private func destination(_ screen: WatchScreen, redaction: AmbientRedactionState) -> some View {
        switch screen {
        case .balances:
            balances(redaction: redaction)
        case .alerts:
            AlertsScreen(
                inbox: model.snapshot?.inbox ?? [],
                now: Int64(Date().timeIntervalSince1970 * 1_000),
                markRead: model.markRead
            )
        case .alertDetail:
            if let request = model.snapshot?.request, !request.id.isEmpty {
                AlertDetailScreen(request: request) {
                    model.openOnPhone(Self.requestRoute(request.id))
                }
            }
        case .receive:
            ReceiveScreen(receive: model.snapshot?.receive)
        case .status:
            StatusScreen(
                reachable: model.phoneReachable,
                balancesAt: model.snapshot?.balancesAt,
                session: model.snapshot?.session,
                hideAmounts: model.hideAmounts,
                appVersion: model.appVersion,
                onToggleHideAmounts: model.setHideAmounts
            )
        case .notSetUp:
            NotSetUpScreen(textKey: "state.openWalletOnPhone")
        case .tokenDetail:
            EmptyView()
        }
    }

    @ViewBuilder
    private func tokenDetail(_ id: String, redaction: AmbientRedactionState) -> some View {
        if let row = model.snapshot?.rows.first(where: { $0.id == id }) {
            let artworkData = model.imageData(for: model.details[id]?.artworkHash)
            let display = TokenDetailPresenter.present(
                row: row,
                detail: model.details[id],
                phoneReachable: model.phoneReachable,
                availableArtworkHashes: artworkData == nil
                    ? [] : Set(model.details[id]?.artworkHash.map { [$0] } ?? []),
                redacted: redaction.redacted
            )
            TokenDetailScreen(
                display: display,
                imageData: artworkData,
                onOpenOnPhone: { model.openOnPhone(Self.tokenRoute(id)) }
            )
            .onAppear { model.requestDetail(id) }
        }
    }

    @ViewBuilder
    private func alertDetail(_ id: String) -> some View {
        if let item = model.snapshot?.inbox.first(where: { $0.id == id }) {
            AlertDetailScreen(item: item) {
                model.openOnPhone(Self.alertRoute(id))
            }
        }
    }

    static func tokenRoute(_ id: String) -> String { "/asset/\(id)" }
    static func alertRoute(_ id: String) -> String { "/alerts/\(id)" }
    static func requestRoute(_ id: String) -> String { "/request/\(id)" }

    private func redactedSnapshot(_ redacted: Bool) -> Snapshot? {
        guard redacted, let snapshot = model.snapshot else { return model.snapshot }
        return Snapshot(
            v: snapshot.v,
            builtAt: snapshot.builtAt,
            balancesAt: snapshot.balancesAt,
            pricesAt: snapshot.pricesAt,
            session: snapshot.session,
            network: snapshot.network,
            fiatCode: snapshot.fiatCode,
            hidden: true,
            unitDefault: snapshot.unitDefault,
            walletName: snapshot.walletName,
            totals: snapshot.totals,
            rows: snapshot.rows,
            capped: snapshot.capped,
            receive: snapshot.receive,
            inbox: snapshot.inbox,
            request: snapshot.request,
            settings: snapshot.settings
        )
    }
}
