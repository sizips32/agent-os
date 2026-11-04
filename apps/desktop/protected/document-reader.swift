import Foundation
import AppKit
import PDFKit
import Vision
import ImageIO

struct Unit: Codable { let label: String; let text: String; let method: String }
struct Result: Codable { let units: [Unit]; let totalUnits: Int; let truncated: Bool; let warnings: [String] }
enum ReadError: Error { case invalid, encrypted, empty, tooLarge; case ocrFailed(String,Int) }

func ocr(_ image: CGImage) throws -> String {
    guard image.width <= 12000, image.height <= 12000, image.width * image.height <= 24_000_000 else { throw ReadError.tooLarge }
    var best = "", bestScore: Float = -1, successes = 0
    var lastFailure: NSError?
    for orientation: CGImagePropertyOrientation in [.up, .right, .down, .left] {
        do {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let languages = try request.supportedRecognitionLanguages()
            request.recognitionLanguages = ["ko-KR", "en-US"].filter { languages.contains($0) }
            try VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:]).perform([request])
            successes += 1
            let results = (request.results ?? []).compactMap { $0.topCandidates(1).first }
            let text = results.map { $0.string }.joined(separator: "\n")
            let score = results.reduce(Float(0)) { $0 + $1.confidence * Float($1.string.count) }
            if score > bestScore { bestScore = score; best = text }
        } catch let error as NSError { lastFailure = error }
    }
    if successes == 0, let failure = lastFailure { throw ReadError.ocrFailed(failure.domain,failure.code) }
    return best
}

func read(_ path: String, _ kind: String) throws -> Result {
    let url = URL(fileURLWithPath: path)
    if kind == "image" {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = props[kCGImagePropertyPixelWidth] as? Int,
              let height = props[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0 else { throw ReadError.invalid }
        guard width <= 12000, height <= 12000, width * height <= 24_000_000 else { throw ReadError.tooLarge }
        guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw ReadError.invalid }
        let text = try ocr(image)
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ReadError.empty }
        return Result(units: [Unit(label: "이미지", text: String(text.prefix(200000)), method: "OCR")], totalUnits: 1, truncated: text.count > 200000, warnings: ["OCR은 글자 추출이며 사진·도표의 의미 분석이 아닙니다."])
    }
    guard kind == "pdf", let document = PDFDocument(url: url) else { throw ReadError.invalid }
    guard !document.isEncrypted else { throw ReadError.encrypted }
    guard document.pageCount > 0, document.pageCount <= 1000 else { throw ReadError.tooLarge }
    var units: [Unit] = [], chars = 0, scans = 0
    for index in 0..<min(document.pageCount, 40) {
        guard let page = document.page(at: index) else { throw ReadError.invalid }
        var text = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var method = "PDF 텍스트"
        if text.isEmpty {
            scans += 1
            if scans > 20 { break }
            let bounds = page.bounds(for: .mediaBox)
            guard bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0,
                  bounds.width <= 10000, bounds.height <= 10000 else { throw ReadError.tooLarge }
            let scale = min(1600 / bounds.width, 1600 / bounds.height)
            let image = page.thumbnail(of: NSSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
            var rect = CGRect(origin: .zero, size: image.size)
            guard let cg = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { throw ReadError.invalid }
            text = try ocr(cg); method = "OCR"
        }
        let remaining = max(0, 200000 - chars)
        let kept = String(text.prefix(remaining)); chars += kept.count
        units.append(Unit(label: "페이지 \(index + 1)", text: kept, method: method))
        if kept.count < text.count || chars >= 200000 { break }
    }
    guard units.contains(where: { !$0.text.isEmpty }) else { throw ReadError.empty }
    return Result(units: units, totalUnits: document.pageCount,
                  truncated: units.count < document.pageCount || chars >= 200000,
                  warnings: ["텍스트가 있는 페이지는 PDF 텍스트를 사용합니다. 그 페이지 안의 이미지 글자는 별도 OCR하지 않습니다.", "최대 40페이지·스캔 20페이지·추출 200,000자. 빈 페이지는 빈 상태로 표시합니다."])
}

do {
    guard CommandLine.arguments.count == 3 else { throw ReadError.invalid }
    let result = try read(CommandLine.arguments[1], CommandLine.arguments[2])
    let data = try JSONEncoder().encode(result)
    FileHandle.standardOutput.write(data)
} catch {
    var result: [String:Any] = [:]
    switch error {
    case ReadError.encrypted: result["error"] = "encrypted_file"
    case ReadError.empty: result["error"] = "no_text"
    case ReadError.tooLarge: result["error"] = "document_limit"
    case ReadError.invalid: result["error"] = CommandLine.arguments.last == "image" ? "invalid_image" : "invalid_document"
    case ReadError.ocrFailed(let domain,let code):
        result["error"] = "ocr_failed";result["ocr_domain"] = String(domain.prefix(120));result["ocr_code"] = code
    default: result["error"] = "extraction_failed"
    }
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject:result))
    exit(1)
}
