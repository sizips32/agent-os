// Office (DOCX/XLSX/PPTX) text extractor. Runs as a sandboxed child process so that
// untrusted archive/XML parsing never happens inside the Electron main process.
// Usage: office-reader <file> <.docx|.xlsx|.pptx>
// Success: Extracted JSON on stdout, exit 0. Failure: {"error":"<code>"} on stdout, exit 1.
// Limits, error codes and output strings mirror the former TypeScript implementation.
use quick_xml::{Reader, events::Event};
use regex::Regex;
use serde_json::json;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::LazyLock;

type R<T> = Result<T, &'static str>;
const MB: u64 = 1024 * 1024;
const FILE_MAX: u64 = 16 * MB;
const TEXT_LIMIT: usize = 200_000; // UTF-16 code units, same as JS String.length
// Real Office parts nest a few dozen levels. A deeper tree is hostile and would overflow the stack
// in the recursive walkers and in drop, so it is refused while parsing.
const MAX_DEPTH: usize = 256;

static DOCTYPE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<!DOCTYPE|<!ENTITY").unwrap());
static ACTIVE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)vbaProject|embeddings/|externalLinks/").unwrap());
static MACRO: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)macroEnabled|vbaProject").unwrap());
static XMLISH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\.(xml|rels)$").unwrap());
static W_TOKENS: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"<w:(tbl|tr|tc)(?:\s[^>]*)?>|</w:(tbl|tr|tc)>|<w:p(?:\s[^>]*)?>(?s:.)*?</w:p>").unwrap()
});
static A_PARA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"<a:p(?:\s[^>]*)?>(?s:.)*?</a:p>").unwrap());
static SLIDE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^slides/slide\d+\.xml$").unwrap());
static SHEET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^worksheets/sheet\d+\.xml$").unwrap());
static CELL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Z]{1,3}\d{1,7}$").unwrap());
static DIGITS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+$").unwrap());
static REF_NAME: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(?:[A-Za-z_:][\w.:-]*|#\d+|#x[0-9A-Fa-f]+)$").unwrap());

// ---------- minimal DOM ----------
#[derive(Default)]
struct Elem {
    name: String,
    attrs: Vec<(String, String)>,
    children: Vec<Node>,
}
enum Node {
    E(Elem),
    T(String),
}
impl Elem {
    fn attr(&self, key: &str) -> Option<&str> {
        self.attrs.iter().rev().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
    fn all<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Elem> + 'a {
        self.children.iter().filter_map(move |c| match c {
            Node::E(e) if e.name == name => Some(e),
            _ => None,
        })
    }
    // A path step resolves only when exactly one child has that name (JS object semantics).
    fn one<'a>(&'a self, name: &'a str) -> Option<&'a Elem> {
        let mut it = self.all(name);
        let first = it.next()?;
        if it.next().is_some() { None } else { Some(first) }
    }
    fn direct_text(&self) -> String {
        self.children.iter().filter_map(|c| if let Node::T(t) = c { Some(t.as_str()) } else { None }).collect()
    }
    // Text of every outermost `tag` element, in document order.
    fn strings(&self, tag: &str, out: &mut Vec<String>) {
        for child in &self.children {
            if let Node::E(e) = child {
                if e.name == tag { out.push(e.direct_text()) } else { e.strings(tag, out) }
            }
        }
    }
    fn joined(&self, tag: &str) -> String {
        let mut out = Vec::new();
        self.strings(tag, &mut out);
        out.concat()
    }
}

// Only the five predefined XML entities are expanded; other well-formed references stay literal.
fn entity(name: &str) -> R<String> {
    if !REF_NAME.is_match(name) { return Err("invalid_document") }
    Ok(match name {
        "lt" => "<".into(), "gt" => ">".into(), "amp" => "&".into(), "quot" => "\"".into(), "apos" => "'".into(),
        other => format!("&{other};"),
    })
}
fn unescape(raw: &str) -> R<String> {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i + 1..];
        let end = tail.find(';').ok_or("invalid_document")?;
        out.push_str(&entity(&tail[..end])?);
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Parses a well-formed document with at least one top-level element. Returns a synthetic holder of that root.
fn xml(text: &str) -> R<Elem> {
    if DOCTYPE.is_match(text) { return Err("invalid_document") }
    let bad = |_| "invalid_document";
    let mut reader = Reader::from_str(text);
    let mut stack: Vec<Elem> = vec![Elem::default()];
    let mut roots = 0;
    // Matches the former validator: several top-level elements and trailing text are tolerated,
    // non-whitespace text before the first element is not.
    let push_text = |stack: &mut Vec<Elem>, t: String, roots: usize| -> R<()> {
        if stack.len() == 1 {
            return if roots > 0 || t.trim().is_empty() { Ok(()) } else { Err("invalid_document") };
        }
        let top = stack.last_mut().unwrap();
        if let Some(Node::T(prev)) = top.children.last_mut() { prev.push_str(&t) } else { top.children.push(Node::T(t)) }
        Ok(())
    };
    let open = |e: &quick_xml::events::BytesStart| -> R<Elem> {
        let name = e.name().as_ref().to_string();
        let mut attrs = Vec::new();
        for a in e.attributes().with_checks(true) {
            let a = a.map_err(|_| "invalid_document")?;
            let key = a.key.as_ref().to_string();
            attrs.push((key, unescape(&a.value)?));
        }
        Ok(Elem { name, attrs, children: Vec::new() })
    };
    loop {
        match reader.read_event().map_err(bad)? {
            Event::Start(e) => {
                if stack.len() == 1 { roots += 1 }
                if stack.len() > MAX_DEPTH { return Err("invalid_document") }
                stack.push(open(&e)?)
            }
            Event::Empty(e) => {
                if stack.len() == 1 { roots += 1 }
                let el = open(&e)?;
                stack.last_mut().unwrap().children.push(Node::E(el));
            }
            Event::End(_) => {
                if stack.len() < 2 { return Err("invalid_document") }
                let el = stack.pop().unwrap();
                stack.last_mut().unwrap().children.push(Node::E(el));
            }
            Event::Text(t) => push_text(&mut stack, t.to_string(), roots)?,
            Event::CData(t) => {
                push_text(&mut stack, t.to_string(), roots)?
            }
            Event::GeneralRef(r) => {
                let s = entity(&r)?;
                push_text(&mut stack, s, roots)?
            }
            Event::DocType(_) => return Err("invalid_document"),
            Event::Eof => break,
            _ => {}
        }
    }
    if stack.len() != 1 || roots == 0 { return Err("invalid_document") }
    Ok(stack.pop().unwrap())
}

fn paragraphs(source: &str, prefix: char) -> R<String> {
    let mut output = Vec::new();
    if prefix == 'w' {
        let mut table = 0;
        let mut stack: Vec<(u32, u32, u32)> = Vec::new();
        for m in W_TOKENS.captures_iter(source) {
            match (m.get(1).map(|v| v.as_str()), m.get(2).map(|v| v.as_str())) {
                (Some("tbl"), _) => { table += 1; stack.push((table, 0, 0)) }
                (_, Some("tbl")) => { stack.pop(); }
                (Some("tr"), _) => if let Some(top) = stack.last_mut() { top.1 += 1; top.2 = 0 },
                (Some("tc"), _) => if let Some(top) = stack.last_mut() { top.2 += 1 },
                (None, None) => {
                    let text = xml(&m[0])?.joined("w:t");
                    output.push(match stack.last() {
                        Some((t, r, c)) => format!("[표 {t} · 행 {r} · 셀 {c}] {text}"),
                        None => text,
                    });
                }
                _ => {}
            }
        }
    } else {
        for m in A_PARA.find_iter(source) { output.push(xml(m.as_str())?.joined("a:t")) }
    }
    Ok(output.join("\n"))
}

// ---------- archive ----------
fn strict_name(name: &str) -> bool {
    let b = name.as_bytes();
    !(name.contains('\\') || name.starts_with('/') || (b.len() > 1 && b[0].is_ascii_alphabetic() && b[1] == b':')
        || name.split('/').any(|s| s == ".."))
}

fn read_archive(bytes: &[u8]) -> R<HashMap<String, String>> {
    if bytes.len() < 4 || bytes[..4] != [0x50, 0x4b, 0x03, 0x04] { return Err("invalid_document") }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "invalid_document")?;
    let mut files = HashMap::new();
    let mut total: u64 = 0;
    for i in 0..zip.len() {
        let (name, size) = {
            let entry = zip.by_index_raw(i).map_err(|_| "invalid_document")?;
            let name = entry.name().map_err(|_| "invalid_document")?.to_string();
            if !strict_name(&name) { return Err("invalid_document") }
            let size = entry.size();
            total += size;
            if i + 1 > 3000 || size > 8 * MB || total > 32 * MB || size > entry.compressed_size().max(1) * 200 {
                return Err("document_limit")
            }
            if entry.encrypted() { return Err("encrypted_file") }
            if ACTIVE.is_match(&name) { return Err("active_content") }
            (name, size)
        };
        if !XMLISH.is_match(&name) { continue }
        let entry = zip.by_index(i).map_err(|_| "invalid_document")?;
        let mut data = Vec::new();
        entry.take(8 * MB + 1).read_to_end(&mut data).map_err(|_| "invalid_document")?;
        if data.len() as u64 > 8 * MB { return Err("document_limit") }
        if data.len() as u64 != size { return Err("invalid_document") }
        let mut text = String::from_utf8(data).map_err(|_| "invalid_document")?;
        if text.starts_with('\u{feff}') { text.remove(0); } // TextDecoder strips a leading BOM
        if DOCTYPE.is_match(&text) { return Err("active_content") }
        if files.insert(name, text).is_some() { return Err("invalid_document") }
    }
    Ok(files)
}

fn targets(rels: &Elem) -> HashMap<String, String> {
    let mut map = HashMap::new();
    if let Some(root) = rels.one("Relationships") {
        for r in root.all("Relationship") {
            if let (Some(id), Some(target)) = (r.attr("Id"), r.attr("Target")) { map.insert(id.to_string(), target.to_string()); }
        }
    }
    map
}

struct Unit { label: String, text: String, method: String }

fn office(bytes: &[u8], ext: &str) -> R<serde_json::Value> {
    let files = read_archive(bytes)?;
    let get = |k: &str| files.get(k).map(String::as_str).unwrap_or("");
    let content_types = get("[Content_Types].xml");
    let expected = match ext {
        ".docx" => "wordprocessingml.document.main+xml",
        ".xlsx" => "spreadsheetml.sheet.main+xml",
        ".pptx" => "presentationml.presentation.main+xml",
        _ => return Err("invalid_document"),
    };
    if !content_types.contains(expected) || MACRO.is_match(content_types) { return Err("invalid_document") }
    xml(content_types)?;
    let mut units: Vec<Unit> = Vec::new();
    
    let warning = match ext {
        ".docx" => {
            let content = files.get("word/document.xml").ok_or("invalid_document")?;
            xml(content)?;
            units.push(Unit { label: "본문·표 셀(문단 순서)".into(), text: paragraphs(content, 'w')?, method: "DOCX 텍스트".into() });
            "본문 문단과 표·행·셀의 텍스트입니다. 머리말·꼬리말·각주·그림·임베디드 개체는 읽지 않습니다."
        }
        ".pptx" => {
            let p = xml(get("ppt/presentation.xml"))?;
            let rel = targets(&xml(get("ppt/_rels/presentation.xml.rels"))?);
            let slides: Vec<&Elem> = p.one("p:presentation").and_then(|v| v.one("p:sldIdLst"))
                .map(|v| v.all("p:sldId").collect()).unwrap_or_default();
            if slides.is_empty() || slides.len() > 200 { return Err("document_limit") }
            for (index, slide) in slides.iter().enumerate() {
                let target = slide.attr("r:id").and_then(|id| rel.get(id)).map(String::as_str).unwrap_or("");
                if !SLIDE.is_match(target) { return Err("invalid_document") }
                let source = files.get(&format!("ppt/{target}")).ok_or("invalid_document")?;
                xml(source)?;
                units.push(Unit { label: format!("슬라이드 {}", index + 1), text: paragraphs(source, 'a')?, method: "PPTX 텍스트".into() });
            }
            "프레젠테이션 순서의 텍스트만 추출합니다. 발표자 노트·그림·도형 의미·차트는 제외됩니다."
        }
        _ => {
            let workbook = xml(get("xl/workbook.xml"))?;
            let rel = targets(&xml(get("xl/_rels/workbook.xml.rels"))?);
            let shared: Vec<String> = match files.get("xl/sharedStrings.xml") {
                Some(s) => xml(s)?.one("sst").map(|sst| sst.all("si").map(|si| si.joined("t")).collect()).unwrap_or_default(),
                None => Vec::new(),
            };
            let sheets: Vec<&Elem> = workbook.one("workbook").and_then(|v| v.one("sheets"))
                .map(|v| v.all("sheet").collect()).unwrap_or_default();
            if sheets.is_empty() || sheets.len() > 100 { return Err("document_limit") }
            let mut cells = 0;
            for sheet in sheets {
                let raw = sheet.attr("r:id").and_then(|id| rel.get(id)).map(String::as_str).unwrap_or("");
                let target = raw.strip_prefix("/xl/").unwrap_or(raw);
                if !SHEET.is_match(target) { return Err("invalid_document") }
                let data = xml(get(&format!("xl/{target}")))?;
                let mut lines = Vec::new();
                let rows: Vec<&Elem> = data.one("worksheet").and_then(|v| v.one("sheetData"))
                    .map(|v| v.all("row").collect()).unwrap_or_default();
                for row in rows {
                    for cell in row.all("c") {
                        cells += 1;
                        if cells > 20000 { return Err("document_limit") }
                        let address = cell.attr("r").unwrap_or("");
                        if !CELL.is_match(address) { return Err("invalid_document") }
                        let kind = cell.attr("t");
                        let value = cell.all("v").map(Elem::direct_text).collect::<Vec<_>>().join(",");
                        let shared_value = DIGITS.is_match(&value).then(|| value.parse::<usize>().ok()).flatten().and_then(|i| shared.get(i));
                        if kind == Some("s") && shared_value.is_none() { return Err("invalid_document") }
                        let content = match kind {
                            Some("s") => shared_value.unwrap().clone(),
                            Some("inlineStr") => cell.all("is").map(|is| is.joined("t")).collect(),
                            _ => value,
                        };
                        let formula = if cell.all("f").next().is_some() { " [수식 캐시값; 재계산 안 함]" } else { "" };
                        lines.push(format!("{address}: {content}{formula}"));
                    }
                }
                units.push(Unit { label: format!("시트 {}", sheet.attr("name").unwrap_or("")), text: lines.join("\n"), method: "XLSX 셀 값".into() });
            }
            "시트명·셀 주소·저장된 값입니다. 수식·매크로·외부 참조는 실행하지 않습니다. 서식·그림·차트는 제외됩니다."
        }
    };
    if !units.iter().any(|u| !u.text.trim().is_empty()) { return Err("no_text") }
    let (mut remaining, mut truncated) = (TEXT_LIMIT, false);
    for unit in &mut units {
        let length: usize = unit.text.encode_utf16().count();
        if length > remaining {
            truncated = true;
            unit.method += if remaining == 0 { " · 추출 한도로 생략" } else { " · 일부만 추출" };
            let mut used = 0;
            let cut = unit.text.char_indices().find(|(_, c)| { used += c.len_utf16(); used > remaining }).map_or(unit.text.len(), |(i, _)| i);
            unit.text.truncate(cut);
        }
        remaining -= unit.text.encode_utf16().count();
    }
    let total = units.len();
    let units: Vec<_> = units.into_iter().map(|u| json!({ "label": u.label, "text": u.text, "method": u.method })).collect();
    Ok(json!({ "units": units, "totalUnits": total, "truncated": truncated, "warnings": [warning] }))
}

fn run() -> R<serde_json::Value> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 { return Err("extraction_failed") }
    let file = std::fs::File::open(&args[1]).map_err(|_| "extraction_failed")?;
    let mut bytes = Vec::new();
    file.take(FILE_MAX + 1).read_to_end(&mut bytes).map_err(|_| "extraction_failed")?;
    if bytes.len() as u64 > FILE_MAX { return Err("document_limit") }
    office(&bytes, &args[2])
}

fn main() {
    match run() {
        Ok(v) => println!("{v}"),
        Err(code) => {
            println!("{}", json!({ "error": code }));
            std::process::exit(1)
        }
    }
}

#[cfg(test)]
mod tests;
