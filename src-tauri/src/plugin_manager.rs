use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::pricing::{generate_plugin_pricing_toml_for_provider, RelayPricingProvider};

pub const TOKEN_COST_SCRIPT: &str =
    include_str!("../../plugins/codex-token-cost/scripts/token_cost.py");

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexPluginConfig {
    pub enabled: bool,
    pub selected_provider_id: String,
    pub hook_installed: bool,
    pub plugin_path: String,
    pub pricing_path: String,
}

pub fn plugin_base_dir(codex_home: &Path) -> PathBuf {
    codex_home.join(".tokenledger").join("plugins").join("codex-token-cost")
}

pub fn plugin_script_path(codex_home: &Path) -> PathBuf {
    plugin_base_dir(codex_home).join("scripts").join("token_cost.py")
}

pub fn plugin_pricing_path(codex_home: &Path) -> PathBuf {
    plugin_base_dir(codex_home).join("pricing.toml")
}

pub fn codex_hooks_path(codex_home: &Path) -> PathBuf {
    codex_home.join("hooks.json")
}

pub fn deploy_plugin_files(
    codex_home: &Path,
    relays: &[RelayPricingProvider],
    selected_provider_id: Option<&str>,
) -> Result<(PathBuf, PathBuf)> {
    let base_dir = plugin_base_dir(codex_home);
    let scripts_dir = base_dir.join("scripts");
    fs::create_dir_all(&scripts_dir).with_context(|| {
        format!("failed to create plugin scripts directory {}", scripts_dir.display())
    })?;

    let script_file = plugin_script_path(codex_home);
    fs::write(&script_file, TOKEN_COST_SCRIPT).with_context(|| {
        format!("failed to write plugin script {}", script_file.display())
    })?;

    let pricing_file = plugin_pricing_path(codex_home);
    let toml_content = generate_plugin_pricing_toml_for_provider(relays, selected_provider_id);
    fs::write(&pricing_file, toml_content.as_bytes()).with_context(|| {
        format!("failed to write pricing toml {}", pricing_file.display())
    })?;

    // Also sync to dev directory if present
    if let Ok(cwd) = std::env::current_dir() {
        for dir in cwd.ancestors() {
            let dev_plugin_dir = dir.join("plugins").join("codex-token-cost");
            if dev_plugin_dir.is_dir() {
                let _ = fs::write(dev_plugin_dir.join("pricing.toml"), toml_content.as_bytes());
                break;
            }
        }
    }

    Ok((script_file, pricing_file))
}

pub fn is_hook_installed(codex_home: &Path) -> bool {
    let hooks_file = codex_hooks_path(codex_home);
    if !hooks_file.exists() {
        return false;
    }

    let Ok(content) = fs::read_to_string(&hooks_file) else {
        return false;
    };

    let Ok(val) = serde_json::from_str::<Value>(&content) else {
        return false;
    };

    has_token_cost_hook(&val)
}

fn has_token_cost_hook(root: &Value) -> bool {
    let Some(stop_hooks) = root.get("hooks").and_then(|h| h.get("Stop")).and_then(|s| s.as_array()) else {
        return false;
    };

    stop_hooks.iter().any(|entry| {
        if let Some(inner_hooks) = entry.get("hooks").and_then(|ih| ih.as_array()) {
            inner_hooks.iter().any(|h| {
                h.get("command")
                    .and_then(|c| c.as_str())
                    .map_or(false, |cmd| cmd.contains("token_cost.py"))
            })
        } else {
            false
        }
    })
}

pub fn update_hooks_json(codex_home: &Path, enable: bool) -> Result<()> {
    let hooks_file = codex_hooks_path(codex_home);
    let mut root: Value = if hooks_file.exists() {
        let content = fs::read_to_string(&hooks_file).with_context(|| {
            format!("failed to read hooks file {}", hooks_file.display())
        })?;
        serde_json::from_str(&content).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    if !root.is_object() {
        root = json!({});
    }

    let hooks_obj = root
        .as_object_mut()
        .context("invalid root object")?
        .entry("hooks")
        .or_insert_with(|| json!({}));

    if !hooks_obj.is_object() {
        *hooks_obj = json!({});
    }

    let stop_array = hooks_obj
        .as_object_mut()
        .context("invalid hooks object")?
        .entry("Stop")
        .or_insert_with(|| json!([]));

    if !stop_array.is_array() {
        *stop_array = json!([]);
    }

    let stop_vec = stop_array.as_array_mut().context("invalid Stop array")?;

    // Filter out existing token_cost.py hooks
    stop_vec.retain(|entry| {
        if let Some(inner_hooks) = entry.get("hooks").and_then(|ih| ih.as_array()) {
            !inner_hooks.iter().any(|h| {
                h.get("command")
                    .and_then(|c| c.as_str())
                    .map_or(false, |cmd| cmd.contains("token_cost.py"))
            })
        } else {
            true
        }
    });

    if enable {
        let script_file = plugin_script_path(codex_home);
        let hook_entry = json!({
            "hooks": [
                {
                    "type": "command",
                    "command": format!("python3 -B \"{}\"", script_file.display()),
                    "timeout": 10,
                    "statusMessage": "Calculating token cost"
                }
            ]
        });
        stop_vec.push(hook_entry);
    }

    if let Some(parent) = hooks_file.parent() {
        fs::create_dir_all(parent).with_context(|| {
            format!("failed to create parent dir for hooks file {}", parent.display())
        })?;
    }

    let formatted = serde_json::to_string_pretty(&root)
        .context("failed to serialize updated hooks.json")?;
    fs::write(&hooks_file, formatted.as_bytes())
        .with_context(|| format!("failed to write hooks file {}", hooks_file.display()))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_deploy_plugin_files() {
        let temp = TempDir::new().expect("temp dir");
        let codex_home = temp.path();

        let (script, pricing) = deploy_plugin_files(codex_home, &[], None).expect("deploy plugin");
        assert!(script.is_file());
        assert!(pricing.is_file());

        let script_content = fs::read_to_string(&script).expect("read script");
        assert!(script_content.contains("def normalize_model"));

        let pricing_content = fs::read_to_string(&pricing).expect("read pricing");
        assert!(pricing_content.contains("[models.\"gpt-5.6-sol\"]"));
    }

    #[test]
    fn test_update_hooks_json_enable_and_disable() {
        let temp = TempDir::new().expect("temp dir");
        let codex_home = temp.path();
        let hooks_file = codex_hooks_path(codex_home);

        // Pre-create hooks.json with existing SessionStart hook
        let initial_json = json!({
            "hooks": {
                "SessionStart": [
                    {
                        "matcher": "startup",
                        "hooks": [{ "type": "command", "command": "echo hello" }]
                    }
                ]
            }
        });
        fs::write(&hooks_file, serde_json::to_string_pretty(&initial_json).unwrap()).unwrap();

        assert!(!is_hook_installed(codex_home));

        // Enable hook
        update_hooks_json(codex_home, true).expect("enable hook");
        assert!(is_hook_installed(codex_home));

        let enabled_content = fs::read_to_string(&hooks_file).unwrap();
        let parsed: Value = serde_json::from_str(&enabled_content).unwrap();
        assert!(parsed.get("hooks").unwrap().get("SessionStart").is_some());
        assert_eq!(
            parsed.get("hooks").unwrap().get("Stop").unwrap().as_array().unwrap().len(),
            1
        );

        // Disable hook
        update_hooks_json(codex_home, false).expect("disable hook");
        assert!(!is_hook_installed(codex_home));

        let disabled_content = fs::read_to_string(&hooks_file).unwrap();
        let parsed_disabled: Value = serde_json::from_str(&disabled_content).unwrap();
        assert!(parsed_disabled.get("hooks").unwrap().get("SessionStart").is_some());
        assert_eq!(
            parsed_disabled.get("hooks").unwrap().get("Stop").unwrap().as_array().unwrap().len(),
            0
        );
    }
}
