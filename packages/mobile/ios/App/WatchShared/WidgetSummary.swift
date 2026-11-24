import Foundation
import WidgetKit

struct WidgetSummary {
    typealias Writer = (WidgetSummaryContent, Data.WritingOptions) throws -> Bool
    typealias Reloader = () -> Void

    static let appGroup = "group.io.xchain.wallet.ios.watch"
    static let fileProtection: Data.WritingOptions =
        .completeFileProtectionUntilFirstUserAuthentication

    private let writer: Writer
    private let reload: Reloader

    init(
        directory: URL? = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: Self.appGroup
        ),
        writer: Writer? = nil,
        reload: @escaping Reloader = { WidgetCenter.shared.reloadAllTimelines() }
    ) {
        let file = directory.map(WidgetSummaryFile.init(directory:))
        self.writer = writer ?? { content, options in
            guard let file else { return false }
            return try file.write(content, options: options)
        }
        self.reload = reload
    }

    func save(
        showTotal: Bool,
        session: String,
        hidden: Bool,
        totalText: String?,
        unreadCount: Int,
        requestWaiting: Bool,
        balancesAt: Int64?
    ) {
        let content = WidgetSummaryContent.make(
            showTotal: showTotal,
            session: session,
            hidden: hidden,
            totalText: totalText,
            unreadCount: unreadCount,
            requestWaiting: requestWaiting,
            balancesAt: balancesAt
        )
        guard (try? writer(content, Self.fileProtection)) == true else { return }
        reload()
    }
}
