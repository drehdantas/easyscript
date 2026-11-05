//! Bringing images and sounds into a project for the tags that name files: from this
//! computer, or from a Google Drive link shared with anyone who has it.

use std::io::Read as _;
use std::path::{Component, Path};
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;

const IMAGE: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
/// Sounds brought in as WAV: decoded here, since the game engine (Godot plays Ogg Vorbis,
/// MP3 and WAV) does not play them.
const CONVERTED: &[&str] = &["flac", "m4a", "aac", "aif", "aiff", "caf", "mp4", "oga"];
/// Larger files are refused: a voice line or a face is far smaller.
const MAX_DOWNLOAD: u64 = 200 * 1024 * 1024;

fn extension(path: &str) -> String {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

pub fn is_image(path: &str) -> bool {
    IMAGE.contains(&extension(path).as_str())
}

/// A file ready to go in the project: sounds the engine cannot play become WAV. Returns
/// the name (with its new extension) and the bytes.
pub fn prepare(name: &str, bytes: Vec<u8>) -> Result<(String, Vec<u8>), String> {
    let ext = extension(name);
    if !CONVERTED.contains(&ext.as_str()) {
        return Ok((name.to_owned(), bytes));
    }
    let wav = to_wav(bytes, &ext).map_err(|e| format!("{name}: cannot convert it to WAV: {e}"))?;
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("sound");
    Ok((format!("{stem}.wav"), wav))
}

/// Decode a sound (FLAC, AAC/M4A, AIFF, CAF, Ogg Vorbis…) to 16-bit PCM WAV.
pub fn to_wav(bytes: Vec<u8>, ext: &str) -> Result<Vec<u8>, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::{CODEC_TYPE_NULL, DecoderOptions};
    use symphonia::core::errors::Error;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let source = MediaSourceStream::new(Box::new(std::io::Cursor::new(bytes)), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("not a sound it knows ({e})"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or("no sound in it")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("cannot decode it ({e})"))?;
    let mut samples: Vec<i16> = Vec::new();
    let mut spec = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let s = *decoded.spec();
                spec.get_or_insert(s);
                let mut buffer = SampleBuffer::<i16>::new(decoded.capacity() as u64, s);
                buffer.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buffer.samples());
            }
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    let spec = spec.ok_or("no sound in it")?;
    let mut out = std::io::Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(
            &mut out,
            hound::WavSpec {
                channels: spec.channels.count() as u16,
                sample_rate: spec.rate,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .map_err(|e| e.to_string())?;
        for sample in samples {
            writer.write_sample(sample).map_err(|e| e.to_string())?;
        }
        writer.finalize().map_err(|e| e.to_string())?;
    }
    Ok(out.into_inner())
}

/// A tag value from a file name: its stem, with what a tag cannot hold (spaces, brackets,
/// `=`) turned into `_`.
pub fn value_from_name(name: &str) -> String {
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let mut value: String = stem
        .trim()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    while value.contains("__") {
        value = value.replace("__", "_");
    }
    value.trim_matches('_').to_owned()
}

/// A relative path that stays inside the project.
fn inside(rel: &str) -> bool {
    !rel.is_empty()
        && Path::new(rel)
            .components()
            .all(|c| matches!(c, Component::Normal(_)))
}

/// Where an asset tag's file for `value` goes: the tag's path with the value in it. A path
/// ending in `.*` takes the file's own extension.
pub fn asset_target(pattern: &str, value: &str, source_ext: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.contains(['/', '\\', '[', ']', '=', ' ']) {
        return Err(format!(
            "`{value}` cannot be a tag value: letters, digits, _ and -"
        ));
    }
    if !pattern.contains("{value}") {
        return Err(format!(
            "the tag's path `{pattern}` has no {{value}}: set it in Project → Tags"
        ));
    }
    let filled = pattern.replace("{value}", value);
    let rel = match filled.strip_suffix(".*") {
        Some(stem) => format!("{stem}.{source_ext}"),
        None => filled,
    };
    if !inside(&rel) {
        return Err(format!("`{rel}` is outside the project"));
    }
    Ok(rel)
}

/// Write an asset into the project at `rel`, converting an image to the format the path
/// asks for. A sound in another format than the path's is refused (the path can end in
/// `.*` to take any). Refuses to write over a file unless `replace`.
pub fn write_asset(
    root: &Path,
    rel: &str,
    source_name: &str,
    bytes: &[u8],
    replace: bool,
) -> Result<(), String> {
    let target = root.join(rel);
    if target.exists() && !replace {
        return Err(format!("exists: {rel}"));
    }
    let from = extension(source_name);
    let to = extension(rel);
    let same = from == to
        || (matches!(from.as_str(), "jpg" | "jpeg") && matches!(to.as_str(), "jpg" | "jpeg"));
    let bytes = if same || from.is_empty() {
        bytes.to_vec()
    } else if is_image(source_name) && is_image(rel) {
        convert_image(bytes, &to)?
    } else {
        return Err(format!(
            "{source_name} is .{from}, but the tag's files are .{to}: convert it, or end the tag's path in .* (Project → Tags) to take any format"
        ));
    };
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(&target, bytes).map_err(|e| format!("{rel}: {e}"))
}

fn convert_image(bytes: &[u8], to: &str) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(bytes).map_err(|e| format!("not an image: {e}"))?;
    let format = match to {
        "png" => image::ImageFormat::Png,
        "jpg" | "jpeg" => image::ImageFormat::Jpeg,
        "webp" => image::ImageFormat::WebP,
        "gif" => image::ImageFormat::Gif,
        _ => return Err(format!("cannot write .{to} images")),
    };
    let image = if format == image::ImageFormat::Jpeg {
        image::DynamicImage::ImageRgb8(image.to_rgb8())
    } else {
        image
    };
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut out, format)
        .map_err(|e| format!("cannot convert the image: {e}"))?;
    Ok(out.into_inner())
}

/// A file as a data URI, to show or play it.
pub fn data_uri(path: &Path) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let name = path.to_string_lossy();
    let mime = match extension(&name).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "ogg" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    };
    let data = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{data}"))
}

// Google Drive ------------------------------------------------------------------------

/// The id in a Google Drive link to a file or a folder, and whether it is a folder.
pub fn drive_id(url: &str) -> Option<(String, bool)> {
    let url = url.trim();
    if !url.contains("drive.google.com")
        && !url.contains("docs.google.com")
        && !url.contains("drive.usercontent.google.com")
    {
        return None;
    }
    let id_chars = |s: &str| -> String {
        s.chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect()
    };
    if let Some((_, rest)) = url.split_once("/folders/") {
        let id = id_chars(rest);
        return (!id.is_empty()).then_some((id, true));
    }
    if let Some((_, rest)) = url.split_once("/d/") {
        let id = id_chars(rest);
        return (!id.is_empty()).then_some((id, false));
    }
    let query = url.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some(value) = pair.strip_prefix("id=") {
            let id = id_chars(value);
            return (!id.is_empty()).then_some((id, false));
        }
    }
    None
}

/// A file in a shared Drive folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    /// Subfolders it is in, from the folder linked: `vozes/cavalo`.
    pub folder: String,
}

fn agent() -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(120)))
        .user_agent("easyscript")
        .build();
    ureq::Agent::new_with_config(config)
}

/// Download a file shared on Google Drive (or any https link): its name and bytes.
pub fn download(url: &str) -> Result<(String, Vec<u8>), String> {
    let link = match drive_id(url) {
        Some((_, true)) => {
            return Err("that is a folder: use Import a Drive folder".into());
        }
        Some((id, false)) => {
            format!(
                "https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t"
            )
        }
        None if url.starts_with("https://") || url.starts_with("http://") => url.to_owned(),
        None => return Err("give a link to the file (https://…)".into()),
    };
    let mut response = agent()
        .get(&link)
        .call()
        .map_err(|e| format!("cannot download: {e}"))?;
    let status = response.status().as_u16();
    if status == 404 || status == 403 || status == 401 {
        return Err("Drive refused it: share the file with \"Anyone with the link\"".into());
    }
    if status >= 400 {
        return Err(format!("the download failed ({status})"));
    }
    let headers = response.headers();
    let kind = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned();
    let name = headers
        .get("content-disposition")
        .and_then(|v| v.to_str().ok())
        .and_then(disposition_name)
        .unwrap_or_else(|| {
            link.split(['?', '#'])
                .next()
                .and_then(|p| p.rsplit('/').next())
                .unwrap_or("download")
                .to_owned()
        });
    if kind.starts_with("text/html") {
        return Err(
            "Drive sent a page, not the file: share it with \"Anyone with the link\"".into(),
        );
    }
    let mut bytes = Vec::new();
    response
        .body_mut()
        .as_reader()
        .take(MAX_DOWNLOAD + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("the download stopped: {e}"))?;
    if bytes.len() as u64 > MAX_DOWNLOAD {
        return Err("the file is too large".into());
    }
    Ok((name, bytes))
}

/// The file name in a `Content-Disposition` header.
fn disposition_name(header: &str) -> Option<String> {
    // `filename*=UTF-8''name%20here` first, then `filename="name"`.
    for part in header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("filename*=") {
            let encoded = value.rsplit("''").next()?;
            return Some(percent_decode(encoded));
        }
    }
    for part in header.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("filename=") {
            return Some(value.trim_matches('"').to_owned());
        }
    }
    None
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16)
        {
            out.push(b);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn html_unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&#39;", "'")
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

/// The files and folders on a shared folder's page (Drive's embedded folder view).
pub fn parse_folder_page(html: &str) -> Vec<(String, String, bool)> {
    let mut entries = Vec::new();
    for chunk in html.split("class=\"flip-entry\"").skip(1) {
        let Some(id) = chunk
            .split_once("id=\"entry-")
            .map(|(_, rest)| rest.split('"').next().unwrap_or_default().to_owned())
        else {
            continue;
        };
        let Some(title) = chunk
            .split_once("class=\"flip-entry-title\">")
            .map(|(_, rest)| html_unescape(rest.split('<').next().unwrap_or_default().trim()))
        else {
            continue;
        };
        let folder = chunk
            .split_once("href=\"")
            .map(|(_, rest)| {
                rest.split('"')
                    .next()
                    .unwrap_or_default()
                    .contains("/folders/")
            })
            .unwrap_or(false);
        if !id.is_empty() && !title.is_empty() {
            entries.push((id, title, folder));
        }
    }
    entries
}

/// The files in a shared Drive folder and the folders in it (three deep).
pub fn list_drive_folder(url: &str) -> Result<Vec<DriveFile>, String> {
    let Some((id, true)) = drive_id(url) else {
        return Err("give a link to a Google Drive folder".into());
    };
    let agent = agent();
    let mut files = Vec::new();
    let mut queue = vec![(id, String::new(), 0)];
    while let Some((id, folder, depth)) = queue.pop() {
        let mut response = agent
            .get(&format!(
                "https://drive.google.com/embeddedfolderview?id={id}"
            ))
            .call()
            .map_err(|e| format!("cannot reach Google Drive: {e}"))?;
        if response.status().as_u16() >= 400 {
            return Err("Drive refused the folder: share it with \"Anyone with the link\"".into());
        }
        let html = response
            .body_mut()
            .read_to_string()
            .map_err(|e| format!("cannot read the folder: {e}"))?;
        let entries = parse_folder_page(&html);
        if entries.is_empty() && depth == 0 && !html.contains("flip-entry") {
            return Err(
                "cannot see into the folder: share it with \"Anyone with the link\"".into(),
            );
        }
        for (entry, name, is_folder) in entries {
            if is_folder {
                if depth < 3 {
                    let inner = if folder.is_empty() {
                        name
                    } else {
                        format!("{folder}/{name}")
                    };
                    queue.push((entry, inner, depth + 1));
                }
            } else {
                files.push(DriveFile {
                    id: entry,
                    name,
                    folder: folder.clone(),
                });
            }
        }
    }
    files.sort_by(|a, b| (&a.folder, &a.name).cmp(&(&b.folder, &b.name)));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drive_links() {
        assert_eq!(
            drive_id("https://drive.google.com/file/d/1AbC-d_9/view?usp=sharing"),
            Some(("1AbC-d_9".into(), false))
        );
        assert_eq!(
            drive_id("https://drive.google.com/open?id=XYZ123"),
            Some(("XYZ123".into(), false))
        );
        assert_eq!(
            drive_id("https://drive.google.com/uc?export=download&id=XYZ123"),
            Some(("XYZ123".into(), false))
        );
        assert_eq!(
            drive_id(
                "https://drive.google.com/drive/folders/1WllOktmmjogBuHT15mA9qjiDJXtY_gcw?usp=sharing"
            ),
            Some(("1WllOktmmjogBuHT15mA9qjiDJXtY_gcw".into(), true))
        );
        assert_eq!(
            drive_id("https://drive.google.com/drive/u/0/folders/F1"),
            Some(("F1".into(), true))
        );
        assert_eq!(drive_id("https://example.com/a.ogg"), None);
    }

    #[test]
    fn disposition() {
        assert_eq!(
            disposition_name(
                "attachment; filename=\"cavalo 01.ogg\"; filename*=UTF-8''cavalo%2001.ogg"
            ),
            Some("cavalo 01.ogg".into())
        );
        assert_eq!(
            disposition_name("attachment; filename=\"a.mp3\""),
            Some("a.mp3".into())
        );
        assert_eq!(
            disposition_name("attachment; filename*=UTF-8''Cabe%C3%A7a.ogg"),
            Some("Cabeça.ogg".into())
        );
    }

    #[test]
    fn folder_page() {
        let html = r#"<div class="flip-entries"><div class="flip-entry" id="entry-AAA" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/file/d/AAA/view?usp=drive_web" target="_blank"><div class="flip-entry-visual"></div><div class="flip-entry-list-icon"></div><div class="flip-entry-title">cavalo_01.ogg</div></a></div></div><div class="flip-entry" id="entry-BBB" tabindex="0" role="link"><div class="flip-entry-info"><a href="https://drive.google.com/drive/folders/BBB" target="_blank"><div class="flip-entry-title">Detetive &amp; cia</div></a></div></div></div>"#;
        assert_eq!(
            parse_folder_page(html),
            vec![
                ("AAA".into(), "cavalo_01.ogg".into(), false),
                ("BBB".into(), "Detetive & cia".into(), true)
            ]
        );
    }

    #[test]
    fn values_and_targets() {
        assert_eq!(value_from_name("Cavalo - Fala 01.ogg"), "Cavalo_-_Fala_01");
        assert_eq!(value_from_name("detetive_serio.png"), "detetive_serio");
        assert_eq!(
            asset_target("audio/{value}.*", "a_1", "mp3").unwrap(),
            "audio/a_1.mp3"
        );
        assert_eq!(
            asset_target("faces/{value}.png", "x", "jpg").unwrap(),
            "faces/x.png"
        );
        assert!(asset_target("../x/{value}.png", "x", "png").is_err());
        assert!(asset_target("faces/{value}.png", "a b", "png").is_err());
    }

    #[test]
    fn writes_and_converts() {
        let dir = tempfile::tempdir().unwrap();
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(4, 4)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        write_asset(dir.path(), "faces/a.jpg", "a.png", png.get_ref(), false).unwrap();
        assert!(image::open(dir.path().join("faces/a.jpg")).is_ok());
        assert!(write_asset(dir.path(), "faces/a.jpg", "a.png", png.get_ref(), false).is_err());
        assert!(write_asset(dir.path(), "audio/a.ogg", "a.mp3", b"ID3", false).is_err());
        write_asset(dir.path(), "audio/a.mp3", "a.mp3", b"ID3", false).unwrap();
    }

    #[test]
    fn decodes_to_wav() {
        let mut wav = std::io::Cursor::new(Vec::new());
        {
            let mut w = hound::WavWriter::new(
                &mut wav,
                hound::WavSpec {
                    channels: 1,
                    sample_rate: 8000,
                    bits_per_sample: 16,
                    sample_format: hound::SampleFormat::Int,
                },
            )
            .unwrap();
            for i in 0..800 {
                w.write_sample(((i % 50) * 400) as i16).unwrap();
            }
            w.finalize().unwrap();
        }
        let out = to_wav(wav.into_inner(), "wav").unwrap();
        let reader = hound::WavReader::new(std::io::Cursor::new(out)).unwrap();
        assert_eq!(reader.spec().sample_rate, 8000);
        assert_eq!(reader.len(), 800);
        assert!(prepare("x.flac", b"nope".to_vec()).is_err());
        assert_eq!(prepare("x.ogg", b"OggS".to_vec()).unwrap().0, "x.ogg");
    }
}
