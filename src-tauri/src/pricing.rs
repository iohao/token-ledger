use std::collections::HashSet;

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

use crate::models::{ModelUsageBreakdown, UsageTotals};

pub const OPENAI_OFFICIAL_PROVIDER_ID: &str = "openai-official";
pub const MIGRATED_RELAY_PROVIDER_ID: &str = "migrated-relay";
pub const DEFAULT_OPENAI_USD_PER_RMB: f64 = 0.14;

const OFFICIAL_MODELS: [&str; 8] = [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
];

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
pub struct ProviderModelPricing {
    pub model: String,
    pub rates: ModelPricingRates,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RelayPricingProvider {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub recharge_ratio_usd_per_rmb: Option<f64>,
    #[serde(default)]
    pub multiplier: Option<f64>,
    #[serde(default)]
    pub model_prices: Vec<ProviderModelPricing>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PricingProviderKind {
    Official,
    Relay,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PricingProvider {
    pub id: String,
    pub kind: PricingProviderKind,
    pub name: String,
    pub enabled: bool,
    pub recharge_ratio_usd_per_rmb: Option<f64>,
    pub multiplier: Option<f64>,
    pub model_prices: Vec<ProviderModelPricing>,
}

#[derive(Debug, Default)]
pub struct ProviderCostResult {
    pub cost_usd: Option<f64>,
    pub fallback_models: Vec<String>,
    pub unpriced_models: Vec<String>,
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

pub fn pricing_providers(
    relays: &[RelayPricingProvider],
    openai_usd_per_rmb: f64,
) -> Vec<PricingProvider> {
    let official = PricingProvider {
        id: OPENAI_OFFICIAL_PROVIDER_ID.to_string(),
        kind: PricingProviderKind::Official,
        name: "OpenAI 官方".to_string(),
        enabled: true,
        recharge_ratio_usd_per_rmb: Some(openai_usd_per_rmb),
        multiplier: Some(1.0),
        model_prices: OFFICIAL_MODELS
            .iter()
            .filter_map(|model| {
                official_pricing_for(model).map(|rates| ProviderModelPricing {
                    model: (*model).to_string(),
                    rates,
                })
            })
            .collect(),
    };

    std::iter::once(official)
        .chain(relays.iter().cloned().map(|relay| PricingProvider {
            id: relay.id,
            kind: PricingProviderKind::Relay,
            name: relay.name,
            enabled: relay.enabled,
            recharge_ratio_usd_per_rmb: relay.recharge_ratio_usd_per_rmb,
            multiplier: relay.multiplier.or(Some(1.0)),
            model_prices: relay.model_prices,
        }))
        .collect()
}

pub fn validate_relay_pricing_providers(
    providers: &[RelayPricingProvider],
) -> Result<Vec<RelayPricingProvider>> {
    let mut ids = HashSet::new();
    let mut normalized = Vec::with_capacity(providers.len());

    for provider in providers {
        let id = provider.id.trim();
        let name = provider.name.trim();
        if id.is_empty() {
            bail!("relay provider id is required");
        }
        if id == OPENAI_OFFICIAL_PROVIDER_ID {
            bail!("OpenAI official provider id is reserved");
        }
        if !ids.insert(id.to_string()) {
            bail!("relay provider id must be unique");
        }
        if name.is_empty() {
            bail!("relay provider name is required");
        }

        let recharge_ratio_usd_per_rmb = provider.recharge_ratio_usd_per_rmb;
        if let Some(ratio) = recharge_ratio_usd_per_rmb {
            if !ratio.is_finite() || ratio <= 0.0 {
                bail!("{name} recharge ratio must be a positive finite number");
            }
        } else if provider.enabled || id != MIGRATED_RELAY_PROVIDER_ID {
            bail!("{name} needs a recharge ratio before it can be saved");
        }

        let multiplier = match provider.multiplier {
            Some(m) => {
                if !m.is_finite() || m <= 0.0 {
                    bail!("{name} multiplier must be a positive finite number");
                }
                Some(m)
            }
            None => Some(1.0),
        };

        let mut models = HashSet::new();
        let mut model_prices = Vec::with_capacity(provider.model_prices.len());
        for price in &provider.model_prices {
            let model = price.model.trim();
            if model.is_empty() {
                bail!("{name} model name is required");
            }
            let identity = pricing_identity(model);
            if !models.insert(identity) {
                bail!("{name} has duplicate model pricing for {model}");
            }
            validate_rates(&price.rates, model)?;
            model_prices.push(ProviderModelPricing {
                model: model.to_string(),
                rates: price.rates.clone(),
            });
        }

        normalized.push(RelayPricingProvider {
            id: id.to_string(),
            name: name.to_string(),
            enabled: provider.enabled,
            recharge_ratio_usd_per_rmb,
            multiplier,
            model_prices,
        });
    }

    Ok(normalized)
}

pub fn validate_openai_usd_per_rmb(value: f64) -> Result<f64> {
    if !value.is_finite() || value <= 0.0 {
        bail!("OpenAI recharge ratio must be a positive finite number");
    }
    Ok(value)
}

pub fn generate_plugin_pricing_toml(relays: &[RelayPricingProvider]) -> String {
    let mut buffer = String::new();
    buffer.push_str("# Prices are USD per one million tokens. Keep amounts quoted for Decimal parsing.\n");
    buffer.push_str("# Managed by TokenLedger - Relay Pricing Configuration\n\n");

    let active_relay = relays.iter().find(|p| p.enabled);
    let (provider_name, multiplier) = if let Some(relay) = active_relay {
        (relay.name.as_str(), relay.multiplier.unwrap_or(1.0))
    } else {
        ("OpenAI 官方", 1.0)
    };

    buffer.push_str("[provider]\n");
    buffer.push_str(&format!("name = \"{provider_name}\"\n"));
    buffer.push_str(&format!("multiplier = \"{multiplier:.4}\"\n\n"));

    for model in OFFICIAL_MODELS {
        if let Some(base) = official_pricing_for(model) {
            let rates = if let Some(relay) = active_relay {
                if let Some(custom) = relay
                    .model_prices
                    .iter()
                    .find(|p| pricing_identity(&p.model) == pricing_identity(model))
                {
                    custom.rates.clone()
                } else {
                    ModelPricingRates {
                        input_usd_per_million: base.input_usd_per_million * multiplier,
                        output_usd_per_million: base.output_usd_per_million * multiplier,
                        cache_read_usd_per_million: base.cache_read_usd_per_million * multiplier,
                        cache_creation_usd_per_million: base.cache_creation_usd_per_million * multiplier,
                    }
                }
            } else {
                base
            };

            buffer.push_str(&format!(
                "[models.\"{model}\"]\ninput_per_million = \"{:.4}\"\noutput_per_million = \"{:.4}\"\ncached_input_per_million = \"{:.4}\"\ncache_creation_per_million = \"{:.4}\"\n\n",
                rates.input_usd_per_million,
                rates.output_usd_per_million,
                rates.cache_read_usd_per_million,
                rates.cache_creation_usd_per_million,
            ));
        }
    }

    buffer
}

pub fn sync_plugin_pricing_file(relays: &[RelayPricingProvider]) -> Result<Option<std::path::PathBuf>> {
    let toml_content = generate_plugin_pricing_toml(relays);
    if let Ok(cwd) = std::env::current_dir() {
        for dir in cwd.ancestors() {
            let plugin_dir = dir.join("plugins").join("codex-token-cost");
            if plugin_dir.is_dir() {
                let target_file = plugin_dir.join("pricing.toml");
                std::fs::write(&target_file, toml_content.as_bytes())?;
                return Ok(Some(target_file));
            }
        }
    }
    Ok(None)
}

pub fn cost_for(totals: &UsageTotals, model: &str) -> f64 {
    official_pricing_for(model)
        .as_ref()
        .map_or(0.0, |pricing| cost_for_rates(totals, pricing))
}

pub fn cost_for_provider(
    models: &[ModelUsageBreakdown],
    provider: &PricingProvider,
) -> ProviderCostResult {
    let mut total = 0.0;
    let mut fallback_models = Vec::new();
    let mut unpriced_models = Vec::new();
    let multiplier = provider.multiplier.unwrap_or(1.0);

    for usage in models {
        let identity = pricing_identity(&usage.model);
        let supplied_rates = provider
            .model_prices
            .iter()
            .find(|price| pricing_identity(&price.model) == identity)
            .map(|price| &price.rates);
        let official_rates = official_pricing_for(&identity);

        let Some((rates, is_fallback)) = supplied_rates
            .map(|rates| (rates, false))
            .or_else(|| official_rates.as_ref().map(|rates| (rates, true)))
        else {
            unpriced_models.push(usage.model.clone());
            continue;
        };

        if is_fallback && !matches!(provider.kind, PricingProviderKind::Official) {
            fallback_models.push(usage.model.clone());
        }
        total += cost_for_rates(&usage.totals, rates) * multiplier;
    }

    ProviderCostResult {
        cost_usd: unpriced_models.is_empty().then_some(total),
        fallback_models,
        unpriced_models,
    }
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

fn cost_for_rates(totals: &UsageTotals, pricing: &ModelPricingRates) -> f64 {
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

#[cfg(test)]
mod tests {
    use super::{
        cost_for, cost_for_provider, pricing_providers, validate_relay_pricing_providers,
        ModelPricingRates, ProviderModelPricing, RelayPricingProvider,
    };
    use crate::models::{ModelUsageBreakdown, UsageTotals};

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
            request_count: 0,
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
    fn provider_pricing_falls_back_to_official_for_missing_models() {
        let relay = RelayPricingProvider {
            id: "relay-a".to_string(),
            name: "Relay A".to_string(),
            enabled: true,
            recharge_ratio_usd_per_rmb: Some(0.14),
            multiplier: Some(1.0),
            model_prices: vec![ProviderModelPricing {
                model: "gpt-5.6-sol".to_string(),
                rates: ModelPricingRates {
                    input_usd_per_million: 10.5,
                    output_usd_per_million: 63.0,
                    cache_read_usd_per_million: 1.05,
                    cache_creation_usd_per_million: 13.125,
                },
            }],
        };
        let providers = pricing_providers(&[relay], 0.14);
        let result = cost_for_provider(
            &[
                ModelUsageBreakdown {
                    model: "gpt-5.6-sol".to_string(),
                    is_fallback: false,
                    totals: totals(1_000_000, 200_000, 100_000, 100_000),
                },
                ModelUsageBreakdown {
                    model: "gpt-5.4".to_string(),
                    is_fallback: false,
                    totals: totals(1_000_000, 0, 0, 0),
                },
            ],
            &providers[1],
        );

        assert!((result.cost_usd.unwrap_or_default() - 17.6725).abs() < 0.000_001);
        assert_eq!(result.fallback_models, vec!["gpt-5.4"]);
    }

    #[test]
    fn provider_pricing_applies_multiplier() {
        let relay = RelayPricingProvider {
            id: "relay-discount".to_string(),
            name: "Relay Discount".to_string(),
            enabled: true,
            recharge_ratio_usd_per_rmb: Some(0.14),
            multiplier: Some(0.15),
            model_prices: vec![ProviderModelPricing {
                model: "gpt-5.6-sol".to_string(),
                rates: ModelPricingRates {
                    input_usd_per_million: 5.0,
                    output_usd_per_million: 30.0,
                    cache_read_usd_per_million: 0.5,
                    cache_creation_usd_per_million: 5.0,
                },
            }],
        };
        let providers = pricing_providers(&[relay], 0.14);
        let result = cost_for_provider(
            &[ModelUsageBreakdown {
                model: "gpt-5.6-sol".to_string(),
                is_fallback: false,
                totals: totals(1_000_000, 0, 0, 0),
            }],
            &providers[1],
        );

        // 1M input tokens at $5.00 * 0.15 multiplier = $0.75
        assert!((result.cost_usd.unwrap_or_default() - 0.75).abs() < 0.000_001);
    }

    #[test]
    fn enabled_provider_requires_a_recharge_ratio() {
        let provider = RelayPricingProvider {
            id: "legacy".to_string(),
            name: "Migrated relay".to_string(),
            enabled: true,
            recharge_ratio_usd_per_rmb: None,
            multiplier: Some(1.0),
            model_prices: vec![],
        };

        assert!(validate_relay_pricing_providers(&[provider]).is_err());
    }

    #[test]
    fn test_generate_plugin_pricing_toml() {
        let relay = RelayPricingProvider {
            id: "relay-test".to_string(),
            name: "Relay Test".to_string(),
            enabled: true,
            recharge_ratio_usd_per_rmb: Some(0.14),
            multiplier: Some(0.15),
            model_prices: vec![],
        };

        let toml = super::generate_plugin_pricing_toml(&[relay]);
        assert!(toml.contains("[models.\"gpt-5.6-sol\"]"));
        assert!(toml.contains("input_per_million = \"0.7500\""));
        assert!(toml.contains("output_per_million = \"4.5000\""));
    }
}
