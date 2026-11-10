use super::*;
use std::io::Write;
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

// ---------- fixtures ----------
const DOCX_TYPES: &str = r#"<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#;
const DOCX_BODY: &str = r#"<w:document><w:body><w:p><w:r><w:t>안녕 world</w:t></w:r></w:p></w:body></w:document>"#;

fn zip_with(entries: &[(&str, &[u8], CompressionMethod)]) -> Vec<u8> {
    let mut w = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data, method) in entries {
        w.start_file(*name, SimpleFileOptions::default().compression_method(*method)).unwrap();
        w.write_all(data).unwrap();
    }
    w.finish().unwrap().into_inner()
}
fn stored<'a>(name: &'a str, data: &'a str) -> (&'a str, &'a [u8], CompressionMethod) {
    (name, data.as_bytes(), CompressionMethod::Stored)
}
fn docx(extra: &[(&str, &[u8], CompressionMethod)]) -> Vec<u8> {
    let mut entries = vec![stored("[Content_Types].xml", DOCX_TYPES), stored("word/document.xml", DOCX_BODY)];
    entries.extend_from_slice(extra);
    zip_with(&entries)
}
fn docx_with(types: &str, body: &str) -> Vec<u8> {
    zip_with(&[stored("[Content_Types].xml", types), stored("word/document.xml", body)])
}
fn code(result: R<serde_json::Value>) -> &'static str {
    result.expect_err("expected a rejection")
}

// ---------- baseline ----------
#[test]
fn reads_a_valid_docx() {
    let out = office(&docx(&[]), ".docx").unwrap();
    assert_eq!(out["units"][0]["text"], "안녕 world");
    assert_eq!(out["truncated"], false);
}

#[test]
fn xml_helpers_keep_their_contract() {
    assert_eq!(xml("<a>x &amp; &lt;y&gt; &#65;</a>").unwrap().one("a").unwrap().direct_text(), "x & <y> &#65;");
    assert!(xml("<a/><b/>tail").is_ok());
    for bad in ["", "<a>", "<a></b>", "text<a/>", "<a>&broken</a>", "<a b='1' b='2'/>"] {
        assert!(xml(bad).is_err(), "{bad}");
    }
    assert_eq!("😀".encode_utf16().count(), 2);
}

// ---------- container ----------
#[test]
fn rejects_non_zip_and_damaged_archives() {
    assert_eq!(code(office(b"", ".docx")), "invalid_document");
    assert_eq!(code(office(b"not a zip at all", ".docx")), "invalid_document");
    let valid = docx(&[]);
    assert_eq!(code(office(&valid[..valid.len() / 2], ".docx")), "invalid_document");
    assert_eq!(code(office(&valid, ".txt")), "invalid_document");
}

#[test]
fn rejects_unsafe_entry_names() {
    for name in ["../evil.xml", "word/../../evil.xml", "/abs.xml", "C:evil.xml", "word\\doc.xml"] {
        let bytes = docx(&[(name, b"<a/>", CompressionMethod::Stored)]);
        assert_eq!(code(office(&bytes, ".docx")), "invalid_document", "{name}");
    }
}

#[test]
fn rejects_active_content_parts() {
    for name in ["word/vbaProject.bin", "word/embeddings/object.bin", "xl/externalLinks/externalLink1.xml"] {
        let bytes = docx(&[(name, b"x", CompressionMethod::Stored)]);
        assert_eq!(code(office(&bytes, ".docx")), "active_content", "{name}");
    }
}

#[test]
fn rejects_macro_enabled_content_types() {
    let types = r#"<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/><Override ContentType="wordprocessingml.document.main+xml"/></Types>"#;
    assert_eq!(code(office(&docx_with(types, DOCX_BODY), ".docx")), "invalid_document");
}

#[test]
fn rejects_encrypted_entries() {
    let mut bytes = docx(&[]);
    // Set the "encrypted" bit (general purpose flag, offset 8) in every central directory header.
    let mut i = 0;
    while let Some(at) = bytes[i..].windows(4).position(|w| w == [0x50, 0x4b, 0x01, 0x02]) {
        bytes[i + at + 8] |= 1;
        i += at + 4;
    }
    assert_eq!(code(office(&bytes, ".docx")), "encrypted_file");
}

// ---------- size limits ----------
#[test]
fn rejects_a_compression_bomb() {
    // 2 MiB of zeros deflates to a few KiB, far beyond the 200:1 ratio cap.
    let zeros = vec![0u8; 2 * MB as usize];
    let bytes = docx(&[("word/bomb.xml", &zeros, CompressionMethod::Deflated)]);
    assert_eq!(code(office(&bytes, ".docx")), "document_limit");
}

#[test]
fn rejects_oversized_entries_and_totals() {
    let nine = vec![b' '; 9 * MB as usize];
    let bytes = docx(&[("word/big.xml", &nine, CompressionMethod::Stored)]);
    assert_eq!(code(office(&bytes, ".docx")), "document_limit");
    let seven = vec![b' '; 7 * MB as usize];
    let parts: Vec<(String, &[u8], CompressionMethod)> =
        (0..5).map(|n| (format!("word/part{n}.xml"), &seven[..], CompressionMethod::Stored)).collect();
    let refs: Vec<(&str, &[u8], CompressionMethod)> = parts.iter().map(|(n, d, m)| (n.as_str(), *d, *m)).collect();
    assert_eq!(code(office(&docx(&refs), ".docx")), "document_limit");
}

#[test]
fn rejects_too_many_entries() {
    let names: Vec<String> = (0..3001).map(|n| format!("word/n{n}.bin")).collect();
    let refs: Vec<(&str, &[u8], CompressionMethod)> =
        names.iter().map(|n| (n.as_str(), &b""[..], CompressionMethod::Stored)).collect();
    assert_eq!(code(office(&docx(&refs), ".docx")), "document_limit");
}

#[test]
fn truncates_text_at_the_extraction_limit() {
    let body = format!("<w:document><w:body><w:p><w:r><w:t>{}</w:t></w:r></w:p></w:body></w:document>", "가".repeat(250_000));
    let out = office(&docx_with(DOCX_TYPES, &body), ".docx").unwrap();
    assert_eq!(out["truncated"], true);
    assert_eq!(out["units"][0]["text"].as_str().unwrap().encode_utf16().count(), TEXT_LIMIT);
}

// ---------- XML ----------
#[test]
fn rejects_doctype_and_entity_declarations() {
    let body = r#"<!DOCTYPE d [<!ENTITY x "boom">]><w:document><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>"#;
    assert_eq!(code(office(&docx_with(DOCX_TYPES, body), ".docx")), "active_content");
}

#[test]
fn rejects_malformed_xml() {
    for body in ["<w:document><w:body>", "<w:document></w:body>", "text before<w:document/>", "<w:document>&broken</w:document>"] {
        assert_eq!(code(office(&docx_with(DOCX_TYPES, body), ".docx")), "invalid_document", "{body}");
    }
}

#[test]
fn deeply_nested_xml_is_refused_without_overflowing_the_stack() {
    // A tree this deep would overflow the stack when dropped recursively.
    let depth = 200_000;
    let body = format!("{}{}", "<a>".repeat(depth), "</a>".repeat(depth));
    let result = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || xml(&body).map(|_| ()))
        .unwrap()
        .join()
        .expect("parser must not overflow the stack");
    assert_eq!(result, Err("invalid_document"));
}

// ---------- other formats ----------
const XLSX_TYPES: &str = r#"<Types><Override ContentType="spreadsheetml.sheet.main+xml"/></Types>"#;
fn xlsx(sheet: &str, shared: Option<&str>, sheets: usize) -> Vec<u8> {
    let list: String = (1..=sheets).map(|n| format!(r#"<sheet name="S{n}" r:id="rId{n}"/>"#)).collect();
    let rels: String = (1..=sheets)
        .map(|n| format!(r#"<Relationship Id="rId{n}" Target="worksheets/sheet1.xml"/>"#))
        .collect();
    let workbook = format!("<workbook><sheets>{list}</sheets></workbook>");
    let rels = format!("<Relationships>{rels}</Relationships>");
    let mut entries = vec![
        stored("[Content_Types].xml", XLSX_TYPES),
        stored("xl/workbook.xml", &workbook),
        stored("xl/_rels/workbook.xml.rels", &rels),
        stored("xl/worksheets/sheet1.xml", sheet),
    ];
    if let Some(s) = shared { entries.push(stored("xl/sharedStrings.xml", s)); }
    // `stored` borrows from locals, so build the archive before they drop.
    zip_with(&entries)
}

#[test]
fn reads_a_valid_xlsx_and_rejects_bad_cells() {
    let sheet = r#"<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>"#;
    let shared = "<sst><si><t>값</t></si></sst>";
    let out = office(&xlsx(sheet, Some(shared), 1), ".xlsx").unwrap();
    assert!(out["units"][0]["text"].as_str().unwrap().contains("A1: 값"));
    let out_of_range = r#"<worksheet><sheetData><row><c r="A1" t="s"><v>5</v></c></row></sheetData></worksheet>"#;
    assert_eq!(code(office(&xlsx(out_of_range, Some(shared), 1), ".xlsx")), "invalid_document");
    let bad_address = r#"<worksheet><sheetData><row><c r="1A" t="s"><v>0</v></c></row></sheetData></worksheet>"#;
    assert_eq!(code(office(&xlsx(bad_address, Some(shared), 1), ".xlsx")), "invalid_document");
    let empty = r#"<worksheet><sheetData></sheetData></worksheet>"#;
    assert_eq!(code(office(&xlsx(empty, None, 1), ".xlsx")), "no_text");
}

#[test]
fn rejects_too_many_sheets_and_cells() {
    let sheet = r#"<worksheet><sheetData><row><c r="A1"><v>1</v></c></row></sheetData></worksheet>"#;
    assert_eq!(code(office(&xlsx(sheet, None, 101), ".xlsx")), "document_limit");
    let cells: String = (0..20_001).map(|n| format!(r#"<c r="A{}"><v>1</v></c>"#, n % 9_999_999 + 1)).collect();
    let many = format!("<worksheet><sheetData><row>{cells}</row></sheetData></worksheet>");
    assert_eq!(code(office(&xlsx(&many, None, 1), ".xlsx")), "document_limit");
}

#[test]
fn rejects_a_presentation_without_its_slides() {
    let types = r#"<Types><Override ContentType="presentationml.presentation.main+xml"/></Types>"#;
    let presentation = r#"<p:presentation><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>"#;
    let rels = r#"<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>"#;
    let bytes = zip_with(&[
        stored("[Content_Types].xml", types),
        stored("ppt/presentation.xml", presentation),
        stored("ppt/_rels/presentation.xml.rels", rels),
    ]);
    assert_eq!(code(office(&bytes, ".pptx")), "invalid_document");
}

// ---------- robustness ----------
#[test]
fn mutated_archives_never_panic() {
    // Deterministic stand-in for fuzzing: flip, drop and repeat bytes of a valid archive.
    let valid = docx(&[]);
    let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for _ in 0..3000 {
        let mut bytes = valid.clone();
        for _ in 0..(1 + next() % 6) {
            let at = (next() as usize) % bytes.len();
            match next() % 3 {
                0 => bytes[at] ^= 1 << (next() % 8),
                1 => { bytes.remove(at); }
                _ => bytes.insert(at, next() as u8),
            }
        }
        let outcome = std::panic::catch_unwind(|| office(&bytes, ".docx"));
        assert!(outcome.is_ok(), "panic on mutated input");
    }
}
