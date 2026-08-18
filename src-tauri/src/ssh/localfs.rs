use std::path::{Path, PathBuf};

use tokio::fs;

use crate::error::AppError;

use super::sftp::{system_mtime, FsEntry, FsListing};

pub fn home_dir() -> Result<String, AppError> {
    let p = dirs::home_dir().ok_or_else(|| AppError::msg("cannot resolve home directory"))?;
    Ok(p.to_string_lossy().into_owned())
}

pub async fn list(path: &str) -> Result<FsListing, AppError> {
    let raw = if path.trim().is_empty() {
        home_dir()?
    } else {
        path.to_string()
    };
    let dir = PathBuf::from(&raw);
    let resolved = fs::canonicalize(&dir)
        .await
        .unwrap_or(dir)
        .to_string_lossy()
        .into_owned();
    let mut rd = fs::read_dir(&resolved).await?;
    let mut entries = Vec::new();
    while let Some(entry) = rd.next_entry().await? {
        let name = entry.file_name().to_string_lossy().into_owned();
        let child = entry.path();
        let meta = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime = meta.modified().ok().and_then(system_mtime);
        entries.push(FsEntry {
            name,
            path: child.to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            size: meta.len(),
            mtime,
            mode: {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    Some(meta.permissions().mode())
                }
                #[cfg(not(unix))]
                {
                    None
                }
            },
        });
    }
    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(FsListing {
        path: resolved,
        entries,
    })
}

pub async fn mkdir(path: &str) -> Result<(), AppError> {
    fs::create_dir_all(path).await?;
    Ok(())
}

pub async fn rename(from: &str, to: &str) -> Result<(), AppError> {
    fs::rename(from, to).await?;
    Ok(())
}

pub async fn remove(path: &str) -> Result<(), AppError> {
    let p = Path::new(path);
    let meta = fs::metadata(p).await?;
    if meta.is_dir() {
        fs::remove_dir_all(p).await?;
    } else {
        fs::remove_file(p).await?;
    }
    Ok(())
}

pub async fn copy_local(from: &str, to: &str) -> Result<(), AppError> {
    let src = PathBuf::from(from);
    let dst = PathBuf::from(to);
    copy_recursive(&src, &dst).await
}

async fn copy_recursive(src: &Path, dst: &Path) -> Result<(), AppError> {
    let meta = fs::metadata(src).await?;
    if meta.is_dir() {
        fs::create_dir_all(dst).await?;
        let mut rd = fs::read_dir(src).await?;
        while let Some(entry) = rd.next_entry().await? {
            let name = entry.file_name();
            Box::pin(copy_recursive(&entry.path(), &dst.join(name))).await?;
        }
        return Ok(());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).await?;
    }
    fs::copy(src, dst).await?;
    Ok(())
}
