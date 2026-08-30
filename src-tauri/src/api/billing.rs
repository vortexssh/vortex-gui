use serde::{Deserialize, Serialize};

use crate::error::AppResult;

use super::client::Client;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingPayer {
    pub id: String,
    pub name: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub host_count: i64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingPayerHostBrief {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub billing_enabled: bool,
    pub billing_amount: Option<String>,
    pub billing_currency: Option<String>,
    pub billing_renewal_at: Option<String>,
    pub billing_cycle: Option<String>,
    #[serde(default)]
    pub billing_auto_renew: bool,
    pub country_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingPayerDetail {
    pub id: String,
    pub name: String,
    pub notes: Option<String>,
    #[serde(default)]
    pub host_count: i64,
    #[serde(default)]
    pub hosts: Vec<BillingPayerHostBrief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingHostBrief {
    pub id: String,
    pub name: String,
    pub billing_amount: Option<serde_json::Value>,
    pub billing_currency: Option<String>,
    pub amount_converted: Option<serde_json::Value>,
    pub country_code: Option<String>,
    #[serde(default)]
    pub is_next: bool,
    pub next_renewal_at: Option<String>,
    pub cycle: Option<String>,
    pub payer_id: Option<String>,
    pub payer_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingDay {
    pub date: String,
    #[serde(default)]
    pub hosts: Vec<BillingHostBrief>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingCalendarResponse {
    pub year: i32,
    pub month: i32,
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub days: Vec<BillingDay>,
    pub payer_id: Option<String>,
    pub payer_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingSummaryItem {
    pub host_id: String,
    pub host_name: String,
    #[serde(default)]
    pub amount: String,
    #[serde(default)]
    pub currency: String,
    pub amount_converted: Option<serde_json::Value>,
    pub renewal_at: Option<String>,
    pub cycle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BillingSummaryResponse {
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub from_date: String,
    #[serde(default)]
    pub to_date: String,
    #[serde(default)]
    pub total: String,
    #[serde(default)]
    pub items: Vec<BillingSummaryItem>,
    #[serde(default)]
    pub skipped: Vec<String>,
    pub payer_id: Option<String>,
    pub payer_name: Option<String>,
}

impl Client {
    pub async fn billing_summary(
        &self,
        from: &str,
        to: &str,
        payer_id: Option<&str>,
    ) -> AppResult<BillingSummaryResponse> {
        let mut path = format!(
            "/api/v1/billing/summary?from={}&to={}",
            urlencoding_query(from),
            urlencoding_query(to)
        );
        if let Some(id) = payer_id.filter(|s| !s.is_empty()) {
            path.push_str("&payer_id=");
            path.push_str(&urlencoding_query(id));
        }
        self.get(&path).await
    }

    pub async fn billing_calendar(
        &self,
        year: i32,
        month: i32,
        payer_id: Option<&str>,
    ) -> AppResult<BillingCalendarResponse> {
        let mut path = format!("/api/v1/billing/calendar?year={year}&month={month}");
        if let Some(id) = payer_id.filter(|s| !s.is_empty()) {
            path.push_str("&payer_id=");
            path.push_str(&urlencoding_query(id));
        }
        self.get(&path).await
    }

    pub async fn list_payers(&self) -> AppResult<Vec<BillingPayer>> {
        self.get("/api/v1/billing/payers").await
    }

    pub async fn get_payer(&self, id: &str) -> AppResult<BillingPayerDetail> {
        let path = format!("/api/v1/billing/payers/{}", urlencoding_query(id));
        self.get(&path).await
    }

    pub async fn create_payer(&self, name: &str, notes: Option<&str>) -> AppResult<BillingPayer> {
        #[derive(Serialize)]
        struct Body<'a> {
            name: &'a str,
            notes: Option<&'a str>,
        }
        self.send(
            reqwest::Method::POST,
            "/api/v1/billing/payers",
            Some(&Body { name, notes }),
        )
        .await
    }

    pub async fn update_payer(
        &self,
        id: &str,
        name: Option<&str>,
        notes: Option<Option<&str>>,
    ) -> AppResult<BillingPayer> {
        #[derive(Serialize)]
        struct Body<'a> {
            #[serde(skip_serializing_if = "Option::is_none")]
            name: Option<&'a str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            notes: Option<Option<&'a str>>,
        }
        let path = format!("/api/v1/billing/payers/{}", urlencoding_query(id));
        self.send(
            reqwest::Method::PATCH,
            &path,
            Some(&Body { name, notes }),
        )
        .await
    }

    pub async fn delete_payer(&self, id: &str) -> AppResult<()> {
        let path = format!("/api/v1/billing/payers/{}", urlencoding_query(id));
        let _: Option<serde_json::Value> = self
            .send_opt(reqwest::Method::DELETE, &path, None::<&serde_json::Value>)
            .await?;
        Ok(())
    }

    pub async fn billing_advance(&self, host_id: &str) -> AppResult<serde_json::Value> {
        let path = format!("/api/v1/hosts/{}/billing/advance", urlencoding_query(host_id));
        let v: Option<serde_json::Value> = self
            .send_opt(reqwest::Method::POST, &path, None::<&serde_json::Value>)
            .await?;
        Ok(v.unwrap_or(serde_json::Value::Null))
    }
}

fn urlencoding_query(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}
