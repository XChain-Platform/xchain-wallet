import Foundation

final class ImageCache {
    static let capacity = 200

    private let directory: URL
    private let fileManager: FileManager
    private var lru = ImageLru(capacity: capacity)
    private var pinned: Set<String> = []

    init(directory: URL, fileManager: FileManager = .default) {
        self.directory = directory
        self.fileManager = fileManager

        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey]
        let files = (try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: Array(keys)
        )) ?? []
        for file in files.filter({ (try? $0.resourceValues(forKeys: keys).isRegularFile) == true })
            .sorted(by: { modified($0) < modified($1) }) {
            lru.touch(file.lastPathComponent)
        }
    }

    func setPinned(snapshot: Set<String>, openDetail: Set<String>) {
        pinned = snapshot.union(openDetail)
        evict()
    }

    func store(_ data: Data, hash: String) throws {
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        try data.write(to: url(for: hash), options: .atomic)
        lru.touch(hash)
        evict()
    }

    func data(for hash: String) -> Data? {
        let file = url(for: hash)
        guard let data = try? Data(contentsOf: file) else {
            lru.remove(hash)
            return nil
        }
        lru.touch(hash)
        try? fileManager.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
        return data
    }

    private func url(for hash: String) -> URL {
        directory.appendingPathComponent(hash, isDirectory: false)
    }

    private func evict() {
        for hash in lru.evict(pinned: pinned) {
            try? fileManager.removeItem(at: url(for: hash))
        }
    }

    private func modified(_ file: URL) -> Date {
        (try? file.resourceValues(forKeys: [.contentModificationDateKey])
            .contentModificationDate) ?? .distantPast
    }
}
