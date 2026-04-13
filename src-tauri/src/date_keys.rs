use anyhow::{Context, Result};
use chrono::{DateTime, Days, NaiveDate, Utc};
use chrono_tz::Tz;

pub fn parse_timestamp(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
}

pub fn date_key_for(date: DateTime<Utc>, time_zone: &str) -> Result<String> {
    let time_zone: Tz = time_zone
        .parse()
        .with_context(|| format!("unsupported time zone: {time_zone}"))?;
    Ok(date
        .with_timezone(&time_zone)
        .format("%Y-%m-%d")
        .to_string())
}

pub fn add_days_to_date_key(date_key: &str, delta_days: i64) -> Result<String> {
    let date = NaiveDate::parse_from_str(date_key, "%Y-%m-%d")
        .with_context(|| format!("unsupported date key: {date_key}"))?;

    let shifted = if delta_days >= 0 {
        date.checked_add_days(Days::new(delta_days as u64))
            .context("failed to add days to date key")?
    } else {
        date.checked_sub_days(Days::new(delta_days.unsigned_abs()))
            .context("failed to subtract days from date key")?
    };

    Ok(shifted.format("%Y-%m-%d").to_string())
}

pub fn last_n_date_keys(now: DateTime<Utc>, time_zone: &str, count: usize) -> Result<Vec<String>> {
    let time_zone: Tz = time_zone
        .parse()
        .with_context(|| format!("unsupported time zone: {time_zone}"))?;
    let today = now.with_timezone(&time_zone).date_naive();

    Ok((0..count)
        .map(|index| {
            today
                .checked_sub_days(Days::new(index as u64))
                .unwrap_or(today)
                .format("%Y-%m-%d")
                .to_string()
        })
        .collect())
}

pub fn month_key_for(now: DateTime<Utc>, time_zone: &str) -> Result<String> {
    let time_zone: Tz = time_zone
        .parse()
        .with_context(|| format!("unsupported time zone: {time_zone}"))?;
    Ok(now.with_timezone(&time_zone).format("%Y-%m").to_string())
}
