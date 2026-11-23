import Foundation

struct WidgetSummaryFile {
    static let fileName = "widget-summary.json"

    private let directory: URL

    init(directory: URL) {
        self.directory = directory
    }

    func write(
        _ content: WidgetSummaryContent,
        options: Data.WritingOptions = []
    ) throws -> Bool {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(content)
        let fileURL = directory.appendingPathComponent(Self.fileName)

        if (try? Data(contentsOf: fileURL)) == data {
            return false
        }

        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        try data.write(to: fileURL, options: options.union(.atomic))
        return true
    }

    func read() -> WidgetSummaryContent? {
        let fileURL = directory.appendingPathComponent(Self.fileName)
        guard let data = try? Data(contentsOf: fileURL) else {
            return nil
        }
        return try? JSONDecoder().decode(WidgetSummaryContent.self, from: data)
    }
}
