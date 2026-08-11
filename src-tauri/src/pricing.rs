use std::collections::HashMap;

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::models::UsageTotals;

const RELAY_MODELS: [&str; 3] = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricingRates {
    pub input_usd_per_million: f64,
    pub output_usd_per_million: f64,
    pub cache_read_usd_per_million: f64,
    pub cache_creation_usd_per_million: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricingOverride {
    pub model: String,
    pub enabled: bool,
    pub rates: ModelPricingRates,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricingSetting {
    pub model: String,
    pub relay_enabled: bool,
    pub official_rates: ModelPricingRates,
    pub relay_rates: ModelPricingRates,
}

pub fn normalize_model(raw_value: &str) -> String {
    let mut normalized = raw_value.trim().to_lowercase();

    for prefix in ["openrouter/openai/", "openai/", "azure/"] {
        if let Some(stripped) = normalized.strip_prefix(prefix) {
            normalized = stripped.to_string();
            break;
        }
    }

    let stripped = if normalized.len() > 11 {
        let suffix = &normalized[normalized.len() - 11..];
        if suffix.starts_with('-')
            && suffix[1..].chars().enumerate().all(|(i, ch)| {
                matches!(i, 4 | 7) && ch == '-' || !matches!(i, 4 | 7) && ch.is_ascii_digit()
            })
        {
            normalized[..normalized.len() - 11].to_string()
        } else {
            normalized
        }
    } else {
        normalized
    };

    match stripped.as_str() {
        "gpt-5-codex" | "gpt-5.2-codex" => "gpt-5.3-codex".to_string(),
        "gpt-5.3-codex-spark" => "gpt-5.3-codex-spark".to_string(),
        _ => stripped,
    }
}

fn pricing_identity(model: &str) -> String {
    match normalize_model(model).as_str() {
        "gpt-5.6" => "gpt-5.6-sol".to_string(),
        normalized => normalized.to_string(),
    }
}

fn official_pricing_for(model: &str) -> Option<ModelPricingRates> {
    match pricing_identity(model).as_str() {
        "gpt-5.6-sol" => Some(rates(5.0, 30.0, 0.5, 5.0)),
        "gpt-5.6-terra" => Some(rates(2.5, 15.0, 0.25, 2.5)),
        "gpt-5.6-luna" => Some(rates(1.0, 6.0, 0.1, 1.0)),
        "gpt-5.5" => Some(rates(5.0, 30.0, 0.5, 5.0)),
        "gpt-5.4" => Some(rates(2.5, 15.0, 0.25, 2.5)),
        "gpt-5.4-mini" => Some(rates(0.75, 4.52, 0.075, 0.75)),
        "gpt-5.3-codex" | "gpt-5.3-codex-spark" => Some(rates(1.75, 14.0, 0.175, 1.75)),
        _ => None,
    }
}

fn rates(
    input_usd_per_million: f64,
    output_usd_per_million: f64,
    cache_read_usd_per_million: f64,
    cache_creation_usd_per_million: f64,
) -> ModelPricingRates {
    ModelPricingRates {
        input_usd_per_million,
        output_usd_per_million,
        cache_read_usd_per_million,
        cache_creation_usd_per_million,
    }
}

fn relay_preset_for(model: &str) -> Option<ModelPricingRates> {
    match model {
        "gpt-5.6-sol" => Some(rates(9.0, 54.0, 0.9, 11.25)),
        "gpt-5.6-terra" => Some(rates(4.5, 27.0, 0.45, 5.4)),
        "gpt-5.6-luna" => Some(rates(1.8, 10.8, 0.18, 2.25)),
        _ => None,
    }
}

pub fn default_model_pricing_overrides() -> Vec<ModelPricingOverride> {
    RELAY_MODELS
        .iter()
        .map(|model| ModelPricingOverride {
            model: (*model).to_string(),
            enabled: false,
            rates: relay_preset_for(model).expect("relay model must have a preset"),
        })
        .collect()
}

pub fn normalize_pricing_overrides(
    overrides: &[ModelPricingOverride],
) -> Vec<ModelPricingOverride> {
    let stored = overrides
        .iter()
        .map(|setting| (setting.model.as_str(), setting))
        .collect::<HashMap<_, _>>();

    default_model_pricing_overrides()
        .into_iter()
        .map(|preset| {
            stored
                .get(preset.model.as_str())
                .filter(|value| validate_rates(&value.rates, &value.model).is_ok())
                .map_or(preset, |value| (*value).clone())
        })
        .collect()
}

pub fn validate_pricing_overrides(
    overrides: &[ModelPricingOverride],
) -> Result<Vec<ModelPricingOverride>> {
    if overrides.len() != RELAY_MODELS.len() {
        bail!("pricing settings must include exactly three supported models");
    }

    let mut normalized = Vec::with_capacity(RELAY_MODELS.len());
    for model in RELAY_MODELS {
        let matches = overrides
            .iter()
            .filter(|setting| setting.model == model)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            bail!("pricing settings must include model {model} exactly once");
        }

        let setting = matches[0];
        validate_rates(&setting.rates, model)?;
        normalized.push(setting.clone());
    }

    Ok(normalized)
}

fn validate_rates(rates: &ModelPricingRates, model: &str) -> Result<()> {
    for (name, value) in [
        ("input", rates.input_usd_per_million),
        ("output", rates.output_usd_per_million),
        ("cache read", rates.cache_read_usd_per_million),
        ("cache creation", rates.cache_creation_usd_per_million),
    ] {
        if !value.is_finite() || value < 0.0 {
            bail!("{model} {name} price must be a non-negative finite number");
        }
    }
    Ok(())
}

pub fn model_pricing_settings(overrides: &[ModelPricingOverride]) -> Vec<ModelPricingSetting> {
    normalize_pricing_overrides(overrides)
        .into_iter()
        .map(|setting| ModelPricingSetting {
            official_rates: official_pricing_for(&setting.model)
                .expect("relay model must have official pricing"),
            model: setting.model,
            relay_enabled: setting.enabled,
            relay_rates: setting.rates,
        })
        .collect()
}

pub fn cost_for(totals: &UsageTotals, model: &str) -> f64 {
    cost_for_with_overrides(totals, model, &[])
}

pub fn cost_for_with_overrides(
    totals: &UsageTotals,
    model: &str,
    overrides: &[ModelPricingOverride],
) -> f64 {
    let identity = pricing_identity(model);
    let relay_rates = overrides
        .iter()
        .find(|setting| setting.enabled && setting.model == identity)
        .map(|setting| &setting.rates);
    let official_rates = official_pricing_for(&identity);
    let Some(pricing) = relay_rates.or(official_rates.as_ref()) else {
        return 0.0;
    };

    let input_tokens = totals.input_tokens.max(0);
    let cache_read_tokens = totals.cached_input_tokens.clamp(0, input_tokens);
    let remaining_input_tokens = input_tokens - cache_read_tokens;
    let cache_creation_tokens = totals
        .cache_creation_input_tokens
        .clamp(0, remaining_input_tokens);
    let regular_input_tokens = remaining_input_tokens - cache_creation_tokens;

    ((regular_input_tokens as f64 / 1_000_000.0) * pricing.input_usd_per_million)
        + ((cache_read_tokens as f64 / 1_000_000.0) * pricing.cache_read_usd_per_million)
        + ((cache_creation_tokens as f64 / 1_000_000.0) * pricing.cache_creation_usd_per_million)
        + ((totals.output_tokens.max(0) as f64 / 1_000_000.0) * pricing.output_usd_per_million)
}

pub fn pricing_notes() -> Vec<String> {
    vec![
        "Official model prices are used unless a relay price override is enabled for that model."
            .to_string(),
        "Cache creation charges apply only when session logs provide cache_creation_input_tokens; records without that field use zero cache creation tokens."
            .to_string(),
        "GPT-5.5 / GPT-5.4 / GPT-5.4-mini / GPT-5.3-Codex rates use OpenAI Codex Rate Card values, converted from credits with a 25 credits = 1 USD inference."
            .to_string(),
        "GPT-5.3-Codex-Spark is still marked as not final by OpenAI; this dashboard estimates Spark cost using GPT-5.3-Codex rates."
            .to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::{
        cost_for, cost_for_with_overrides, default_model_pricing_overrides, normalize_model,
        normalize_pricing_overrides, validate_pricing_overrides,
    };
    use crate::models::UsageTotals;

    fn totals(
        input_tokens: i64,
        cached_input_tokens: i64,
        cache_creation_input_tokens: i64,
        output_tokens: i64,
    ) -> UsageTotals {
        UsageTotals {
            input_tokens,
            cached_input_tokens,
            cache_creation_input_tokens,
            output_tokens,
            reasoning_output_tokens: 0,
            total_tokens: input_tokens + output_tokens,
            cost_usd: 0.0,
        }
    }

    #[test]
    fn official_pricing_remains_default() {
        let cost = cost_for(
            &totals(1_000_000, 200_000, 0, 100_000),
            "openai/gpt-5.6-sol",
        );

        assert!((cost - 7.1).abs() < 0.000_001, "unexpected cost: {cost}");
    }

    #[test]
    fn enabled_sol_override_prices_all_token_categories() {
        let mut overrides = default_model_pricing_overrides();
        overrides[0].enabled = true;

        let cost = cost_for_with_overrides(
            &totals(1_000_000, 200_000, 100_000, 100_000),
            "openai/gpt-5.6-sol",
            &overrides,
        );

        assert!((cost - 13.005).abs() < 0.000_001, "unexpected cost: {cost}");
    }

    #[test]
    fn generic_gpt_5_6_uses_sol_override() {
        let mut overrides = default_model_pricing_overrides();
        overrides[0].enabled = true;

        let cost = cost_for_with_overrides(
            &totals(1_000_000, 200_000, 100_000, 100_000),
            "gpt-5.6",
            &overrides,
        );

        assert!((cost - 13.005).abs() < 0.000_001, "unexpected cost: {cost}");
    }

    #[test]
    fn cache_categories_are_clamped_to_total_input() {
        let mut overrides = default_model_pricing_overrides();
        overrides[0].enabled = true;

        let cost = cost_for_with_overrides(&totals(100, 80, 80, 0), "gpt-5.6-sol", &overrides);

        assert!(
            (cost - 0.000_297).abs() < 0.000_001,
            "unexpected cost: {cost}"
        );
    }

    #[test]
    fn rejects_negative_prices() {
        let mut overrides = default_model_pricing_overrides();
        overrides[1].rates.input_usd_per_million = -1.0;

        let error = validate_pricing_overrides(&overrides).expect_err("negative price must fail");

        assert!(error.to_string().contains("non-negative finite number"));
    }

    #[test]
    fn invalid_stored_override_falls_back_to_disabled_preset() {
        let mut overrides = default_model_pricing_overrides();
        overrides[0].enabled = true;
        overrides[0].rates.input_usd_per_million = -1.0;

        let normalized = normalize_pricing_overrides(&overrides);

        assert!(!normalized[0].enabled);
        assert_eq!(normalized[0].rates.input_usd_per_million, 9.0);
    }

    #[test]
    fn normalizes_dated_gpt_5_5_snapshot() {
        assert_eq!(normalize_model("openai/gpt-5.5-2026-04-24"), "gpt-5.5");
    }
}
