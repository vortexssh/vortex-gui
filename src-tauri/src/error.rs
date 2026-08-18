use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{message}")]
    Core {
        code: String,
        message: String,
        web_2fa_url: Option<String>,
    },
    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(m: impl Into<String>) -> Self {
        Self::Msg(m.into())
    }

    pub fn core(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self::Core {
            code: code.into(),
            message: message.into(),
            web_2fa_url: None,
        }
    }

    pub fn two_fa(message: impl Into<String>, web_url: &str) -> Self {
        let trimmed = web_url.trim().trim_end_matches('/');
        let base = if trimmed.is_empty() {
            crate::config::DEFAULT_WEB_URL
        } else {
            trimmed
        };
        Self::Core {
            code: "2fa_required".into(),
            message: message.into(),
            web_2fa_url: Some(format!("{base}/security/2fa")),
        }
    }

    pub fn code(&self) -> &str {
        match self {
            Self::Core { code, .. } => code,
            Self::Msg(_) => "error",
        }
    }

    fn web_2fa_url(&self) -> Option<&str> {
        match self {
            Self::Core { web_2fa_url, .. } => web_2fa_url.as_deref(),
            Self::Msg(_) => None,
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::Msg(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::Msg(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::Msg(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        Self::Msg(format!("network: {e}"))
    }
}

impl From<url::ParseError> for AppError {
    fn from(e: url::ParseError) -> Self {
        Self::Msg(e.to_string())
    }
}

impl From<russh::Error> for AppError {
    fn from(e: russh::Error) -> Self {
        Self::Msg(format!("ssh: {e}"))
    }
}

impl From<crate::crypto::CryptoError> for AppError {
    fn from(e: crate::crypto::CryptoError) -> Self {
        Self::Msg(e.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    web_2fa_url: Option<String>,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        ErrorBody {
            code: self.code().to_string(),
            message: self.to_string(),
            web_2fa_url: self.web_2fa_url().map(str::to_string),
        }
        .serialize(serializer)
    }
}

pub type AppResult<T> = Result<T, AppError>;
