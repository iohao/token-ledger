use crate::models::UsageTotals;

struct ModelPricing {
    input_cost_per_million: f64,
    cached_input_cost_per_million: f64,
    output_cost_per_million: f64,
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

fn pricing_for(model: &str) -> Option<ModelPricing> {
    match normalize_model(model).as_str() {
        "gpt-5.4" => Some(ModelPricing {
            input_cost_per_million: 2.5,
            cached_input_cost_per_million: 0.25,
            output_cost_per_million: 15.0,
        }),
        "gpt-5.4-mini" => Some(ModelPricing {
            input_cost_per_million: 0.75,
            cached_input_cost_per_million: 0.075,
            output_cost_per_million: 4.52,
        }),
        "gpt-5.3-codex" => Some(ModelPricing {
            input_cost_per_million: 1.75,
            cached_input_cost_per_million: 0.175,
            output_cost_per_million: 14.0,
        }),
        "gpt-5.3-codex-spark" => Some(ModelPricing {
            input_cost_per_million: 1.75,
            cached_input_cost_per_million: 0.175,
            output_cost_per_million: 14.0,
        }),
        _ => None,
    }
}

pub fn cost_for(totals: &UsageTotals, model: &str) -> f64 {
    let Some(pricing) = pricing_for(model) else {
        return 0.0;
    };

    let cached_input_tokens = totals.cached_input_tokens.min(totals.input_tokens);
    let non_cached_input_tokens = (totals.input_tokens - cached_input_tokens).max(0);

    ((non_cached_input_tokens as f64 / 1_000_000.0) * pricing.input_cost_per_million)
        + ((cached_input_tokens as f64 / 1_000_000.0) * pricing.cached_input_cost_per_million)
        + ((totals.output_tokens as f64 / 1_000_000.0) * pricing.output_cost_per_million)
}

pub fn pricing_notes() -> Vec<String> {
    vec![
    "GPT-5.4 / GPT-5.4-mini / GPT-5.3-Codex rates use OpenAI Codex Rate Card values, converted from credits with a 25 credits = 1 USD inference.".to_string(),
    "GPT-5.3-Codex-Spark is still marked as not final by OpenAI; this dashboard estimates Spark cost using GPT-5.3-Codex rates.".to_string(),
  ]
}
