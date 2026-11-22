import Foundation

struct SnapshotFile {
    static let fileName = "snapshot.json"

    private let directory: URL

    init(directory: URL) {
        self.directory = directory
    }

    func save(_ data: Data, options: Data.WritingOptions = []) throws {
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        try data.write(
            to: directory.appendingPathComponent(Self.fileName),
            options: options.union(.atomic)
        )
    }

    func load() -> Data? {
        try? Data(contentsOf: directory.appendingPathComponent(Self.fileName))
    }

    func wipe() -> Bool {
        let fileURL = directory.appendingPathComponent(Self.fileName)
        if FileManager.default.fileExists(atPath: fileURL.path) {
            try? FileManager.default.removeItem(at: fileURL)
        }
        return !FileManager.default.fileExists(atPath: fileURL.path)
    }
}
