use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::date_keys::{date_key_for, parse_timestamp};
use crate::models::{
    add_usage_totals, clamp_non_negative, is_zero_usage_totals, DailySessionModelUsage,
    ParsedSessionFile, UsageTotals,
};
use crate::pricing::{cost_for, normalize_model};

const MODEL_KEYS: [&str; 3] = ["model", "model_slug", "model_name"];

#[derive(Debug, Clone)]
struct RawUsage {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_output_tokens: i64,
    total_tokens: i64,
}

#[derive(Debug, Clone)]
struct UsagePoint {
    timestamp: DateTime<Utc>,
    model: String,
    is_fallback: bool,
    totals: UsageTotals,
}

pub fn parse_session_file(
    file_path: &Path,
    sessions_root: &Path,
    time_zone: &str,
) -> Result<ParsedSessionFile> {
    let session = parse_session_usage_points(file_path, sessions_root)?;
    let mut aggregated: HashMap<String, DailySessionModelUsage> = HashMap::new();

    for point in session.points {
        let date_key = date_key_for(point.timestamp, time_zone)?;
        let key = usage_key(&date_key, &point.model, point.is_fallback);

        aggregated
            .entry(key)
            .and_modify(|existing| {
                existing.totals = add_usage_totals(&existing.totals, &point.totals);
            })
            .or_insert_with(|| DailySessionModelUsage {
                session_id: session.session_id.clone(),
                relative_path: session.relative_path.clone(),
                date_key,
                model: point.model,
                is_fallback: point.is_fallback,
                totals: point.totals,
            });
    }

    let mut usages = aggregated.into_values().collect::<Vec<_>>();
    usages.sort_by(|left, right| {
        if left.date_key != right.date_key {
            return right.date_key.cmp(&left.date_key);
        }
        if left.model != right.model {
            return left.model.cmp(&right.model);
        }
        left.is_fallback.cmp(&right.is_fallback)
    });

    Ok(ParsedSessionFile {
        session_id: session.session_id,
        relative_path: session.relative_path,
        file_size: session.file_size,
        modified_at: session.modified_at,
        latest_usage_at: session.latest_usage_at,
        usages,
    })
}

struct ParsedSessionPoints {
    session_id: String,
    relative_path: String,
    file_size: i64,
    modified_at: DateTime<Utc>,
    latest_usage_at: Option<DateTime<Utc>>,
    points: Vec<UsagePoint>,
}

fn parse_session_usage_points(
    file_path: &Path,
    sessions_root: &Path,
) -> Result<ParsedSessionPoints> {
    let relative_path = relative_posix_path(sessions_root, file_path)?;
    let session_id = relative_path.trim_end_matches(".jsonl").to_string();
    let file = File::open(file_path)
        .with_context(|| format!("failed to open session file {}", file_path.display()))?;
    let metadata = file
        .metadata()
        .with_context(|| format!("failed to stat session file {}", file_path.display()))?;
    let reader = BufReader::new(file);
    let modified_at = DateTime::<Utc>::from(
        metadata
            .modified()
            .with_context(|| format!("failed to read mtime for {}", file_path.display()))?,
    );

    let mut current_model: Option<String> = None;
    let mut current_model_is_fallback = false;
    let mut previous_total_usage: Option<RawUsage> = None;
    let mut latest_usage_at: Option<DateTime<Utc>> = None;
    let mut points = Vec::new();

    for line in reader.lines() {
        let line =
            line.with_context(|| format!("failed to read session file {}", file_path.display()))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let Ok(json_value) = serde_json::from_str::<Value>(trimmed) else {
            continue;
        };
        let Some(json_object) = json_value.as_object() else {
            continue;
        };

        let Some(entry_type) = json_object.get("type").and_then(Value::as_str) else {
            continue;
        };
        let timestamp = json_object
            .get("timestamp")
            .and_then(Value::as_str)
            .and_then(parse_timestamp);
        let null_payload = Value::Null;
        let payload = json_object.get("payload").unwrap_or(&null_payload);

        if entry_type == "turn_context" {
            if let Some(extracted_model) = extract_model(payload) {
                current_model = Some(extracted_model);
                current_model_is_fallback = false;
            }
            continue;
        }

        let Some(payload_record) = payload.as_object() else {
            continue;
        };
        if entry_type != "event_msg" {
            continue;
        }
        if payload_record.get("type").and_then(Value::as_str) != Some("token_count") {
            continue;
        }
        let Some(timestamp) = timestamp else {
            continue;
        };

        let info = payload_record.get("info").and_then(Value::as_object);
        let last_usage = info
            .and_then(|value| value.get("last_token_usage"))
            .and_then(raw_usage_from_dictionary);
        let total_usage = info
            .and_then(|value| value.get("total_token_usage"))
            .and_then(raw_usage_from_dictionary);

        let mut raw_usage = last_usage.clone();
        if raw_usage.is_none() {
            if let Some(total_usage) = total_usage.clone() {
                raw_usage = Some(subtract_usage(&total_usage, previous_total_usage.as_ref()));
            }
        }

        if let Some(total_usage) = total_usage {
            previous_total_usage = Some(total_usage);
        } else if let Some(last_usage) = last_usage {
            previous_total_usage = Some(if let Some(previous) = previous_total_usage.as_ref() {
                add_raw_usage(previous, &last_usage)
            } else {
                last_usage
            });
        }

        let Some(raw_usage) = raw_usage else {
            continue;
        };

        let extracted_model =
            extract_model(payload).or_else(|| info.and_then(|value| extract_model_object(value)));
        let (model, is_fallback) = if let Some(extracted_model) = extracted_model {
            current_model = Some(extracted_model.clone());
            current_model_is_fallback = false;
            (extracted_model, false)
        } else if let Some(current_model) = current_model.clone() {
            (current_model, current_model_is_fallback)
        } else {
            current_model = Some("gpt-5".to_string());
            current_model_is_fallback = true;
            ("gpt-5".to_string(), true)
        };

        let totals = as_totals(&raw_usage);
        if is_zero_usage_totals(&totals) {
            continue;
        }

        latest_usage_at = Some(match latest_usage_at {
            Some(current) if current > timestamp => current,
            _ => timestamp.clone(),
        });

        points.push(UsagePoint {
            timestamp,
            model: model.clone(),
            is_fallback,
            totals: UsageTotals {
                cost_usd: cost_for(&totals, &model),
                ..totals
            },
        });
    }

    Ok(ParsedSessionPoints {
        session_id,
        relative_path,
        file_size: metadata.len() as i64,
        modified_at,
        latest_usage_at,
        points,
    })
}

fn integer_value(raw_value: &Value) -> i64 {
    if let Some(value) = raw_value.as_i64() {
        return value;
    }
    if let Some(value) = raw_value.as_u64() {
        return value as i64;
    }
    if let Some(value) = raw_value.as_str() {
        return value.parse::<i64>().unwrap_or(0);
    }
    0
}

fn raw_usage_from_dictionary(value: &Value) -> Option<RawUsage> {
    let dictionary = value.as_object()?;
    Some(RawUsage {
        input_tokens: dictionary
            .get("input_tokens")
            .map(integer_value)
            .unwrap_or(0),
        cached_input_tokens: dictionary
            .get("cached_input_tokens")
            .map(integer_value)
            .unwrap_or(0),
        output_tokens: dictionary
            .get("output_tokens")
            .map(integer_value)
            .unwrap_or(0),
        reasoning_output_tokens: dictionary
            .get("reasoning_output_tokens")
            .map(integer_value)
            .unwrap_or(0),
        total_tokens: dictionary
            .get("total_tokens")
            .map(integer_value)
            .unwrap_or(0),
    })
}

fn subtract_usage(current: &RawUsage, previous: Option<&RawUsage>) -> RawUsage {
    let Some(previous) = previous else {
        return current.clone();
    };

    RawUsage {
        input_tokens: (current.input_tokens - previous.input_tokens).max(0),
        cached_input_tokens: (current.cached_input_tokens - previous.cached_input_tokens).max(0),
        output_tokens: (current.output_tokens - previous.output_tokens).max(0),
        reasoning_output_tokens: (current.reasoning_output_tokens
            - previous.reasoning_output_tokens)
            .max(0),
        total_tokens: (current.total_tokens - previous.total_tokens).max(0),
    }
}

fn add_raw_usage(left: &RawUsage, right: &RawUsage) -> RawUsage {
    RawUsage {
        input_tokens: left.input_tokens + right.input_tokens,
        cached_input_tokens: left.cached_input_tokens + right.cached_input_tokens,
        output_tokens: left.output_tokens + right.output_tokens,
        reasoning_output_tokens: left.reasoning_output_tokens + right.reasoning_output_tokens,
        total_tokens: left.total_tokens + right.total_tokens,
    }
}

fn as_totals(raw_usage: &RawUsage) -> UsageTotals {
    clamp_non_negative(UsageTotals {
        input_tokens: raw_usage.input_tokens,
        cached_input_tokens: raw_usage.cached_input_tokens,
        output_tokens: raw_usage.output_tokens,
        reasoning_output_tokens: raw_usage.reasoning_output_tokens,
        total_tokens: raw_usage.total_tokens,
        cost_usd: 0.0,
    })
}

fn extract_model(value: &Value) -> Option<String> {
    match value {
        Value::Array(values) => values.iter().find_map(extract_model),
        Value::Object(values) => extract_model_object(values),
        _ => None,
    }
}

fn extract_model_object(values: &serde_json::Map<String, Value>) -> Option<String> {
    for (key, value) in values {
        if MODEL_KEYS
            .iter()
            .any(|candidate| candidate.eq_ignore_ascii_case(key))
        {
            if let Some(model) = value.as_str() {
                let normalized = normalize_model(model);
                if !normalized.is_empty() {
                    return Some(normalized);
                }
            }
        }
    }

    values.values().find_map(extract_model)
}

fn usage_key(date_key: &str, model: &str, is_fallback: bool) -> String {
    format!(
        "{date_key}\u{0}{model}\u{0}{}",
        if is_fallback { 1 } else { 0 }
    )
}

fn relative_posix_path(root: &Path, path: &Path) -> Result<String> {
    let relative = path.strip_prefix(root).with_context(|| {
        format!(
            "failed to strip prefix {} from {}",
            root.display(),
            path.display()
        )
    })?;
    Ok(relative
        .iter()
        .map(|segment| segment.to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/"))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::TempDir;

    use super::parse_session_file;

    fn write_session(temp_dir: &TempDir, relative_path: &str, content: &str) -> std::path::PathBuf {
        let sessions_root = temp_dir.path().join("sessions");
        let file_path = sessions_root.join(relative_path);
        fs::create_dir_all(file_path.parent().expect("session file parent"))
            .expect("create session dirs");
        fs::write(&file_path, content).expect("write session file");
        file_path
    }

    #[test]
    fn parses_last_token_usage_and_aggregates_same_day() {
        let temp_dir = TempDir::new().expect("temp dir");
        let session_content = r#"
invalid json
{"type":"turn_context","timestamp":"2026-04-09T01:00:00.000Z","payload":{"model":"openai/gpt-5.4"}}
{"type":"event_msg","timestamp":"2026-04-09T01:02:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10,"reasoning_output_tokens":3,"total_tokens":110}}}}
{"type":"event_msg","timestamp":"2026-04-09T01:05:00.000Z","payload":{"type":"token_count","info":{"last_token_usage":{"input_tokens":50,"cached_input_tokens":10,"output_tokens":5,"reasoning_output_tokens":1,"total_tokens":55},"model":"gpt-5.4-2026-04-01"}}}
"#;
        let file_path = write_session(&temp_dir, "2026/04/09/example.jsonl", session_content);
        let sessions_root = temp_dir.path().join("sessions");

        let parsed =
            parse_session_file(&file_path, &sessions_root, "Asia/Shanghai").expect("parse session");

        assert_eq!(parsed.session_id, "2026/04/09/example");
        assert_eq!(parsed.relative_path, "2026/04/09/example.jsonl");
        assert_eq!(parsed.usages.len(), 1);

        let usage = &parsed.usages[0];
        assert_eq!(usage.date_key, "2026-04-09");
        assert_eq!(usage.model, "gpt-5.4");
        assert!(!usage.is_fallback);
        assert_eq!(usage.totals.input_tokens, 150);
        assert_eq!(usage.totals.cached_input_tokens, 50);
        assert_eq!(usage.totals.output_tokens, 15);
        assert_eq!(usage.totals.reasoning_output_tokens, 4);
        assert_eq!(usage.totals.total_tokens, 165);
        assert!(usage.totals.cost_usd > 0.0);
        assert_eq!(
            parsed.latest_usage_at.expect("latest usage").to_rfc3339(),
            "2026-04-09T01:05:00+00:00"
        );
    }

    #[test]
    fn derives_deltas_from_total_usage_and_uses_fallback_model() {
        let temp_dir = TempDir::new().expect("temp dir");
        let session_content = r#"
{"type":"event_msg","timestamp":"2026-04-09T02:00:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30,"reasoning_output_tokens":5,"total_tokens":130}}}}
{"type":"event_msg","timestamp":"2026-04-09T02:10:00.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":180,"cached_input_tokens":50,"output_tokens":45,"reasoning_output_tokens":8,"total_tokens":225}}}}
"#;
        let file_path = write_session(&temp_dir, "fallback/session.jsonl", session_content);
        let sessions_root = temp_dir.path().join("sessions");

        let parsed =
            parse_session_file(&file_path, &sessions_root, "Asia/Shanghai").expect("parse session");

        assert_eq!(parsed.usages.len(), 1);
        let usage = &parsed.usages[0];
        assert_eq!(usage.model, "gpt-5");
        assert!(usage.is_fallback);
        assert_eq!(usage.totals.input_tokens, 180);
        assert_eq!(usage.totals.cached_input_tokens, 50);
        assert_eq!(usage.totals.output_tokens, 45);
        assert_eq!(usage.totals.reasoning_output_tokens, 8);
        assert_eq!(usage.totals.total_tokens, 225);
        assert_eq!(usage.totals.cost_usd, 0.0);
    }

    #[test]
    fn extracts_nested_model_and_ignores_zero_usage_points() {
        let temp_dir = TempDir::new().expect("temp dir");
        let session_content = r#"
{"type":"event_msg","timestamp":"2026-04-09T02:00:00.000Z","payload":{"type":"token_count","meta":{"messages":[{"model_slug":"openai/gpt-5.4-mini"}]},"info":{"last_token_usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":0}}}}
{"type":"event_msg","timestamp":"2026-04-09T02:10:00.000Z","payload":{"type":"token_count","meta":{"messages":[{"model_slug":"openai/gpt-5.4-mini"}]},"info":{"last_token_usage":{"input_tokens":20,"cached_input_tokens":5,"output_tokens":7,"reasoning_output_tokens":2,"total_tokens":27}}}}
"#;
        let file_path = write_session(&temp_dir, "nested/model.jsonl", session_content);
        let sessions_root = temp_dir.path().join("sessions");

        let parsed =
            parse_session_file(&file_path, &sessions_root, "Asia/Shanghai").expect("parse session");

        assert_eq!(parsed.usages.len(), 1);
        let usage = &parsed.usages[0];
        assert_eq!(usage.model, "gpt-5.4-mini");
        assert!(!usage.is_fallback);
        assert_eq!(usage.totals.input_tokens, 20);
        assert_eq!(usage.totals.cached_input_tokens, 5);
        assert_eq!(usage.totals.output_tokens, 7);
        assert_eq!(usage.totals.reasoning_output_tokens, 2);
        assert_eq!(usage.totals.total_tokens, 27);
        assert!(usage.totals.cost_usd > 0.0);
    }
}
