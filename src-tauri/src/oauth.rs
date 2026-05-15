use rand::{distributions::Alphanumeric, Rng};
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration, Instant};

pub fn random_token(len: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

pub async fn wait_for_fragment_token(port: u16, expected_state: String) -> Result<String, String> {
    let listener = TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|error| format!("OAuth callback bind failed: {error}"))?;

    let deadline = Instant::now() + Duration::from_secs(180);
    let mut last_path = String::new();

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err(format!(
                "OAuth token callback timed out; last request path: {last_path}"
            ));
        }

        let accept_result = timeout(remaining, listener.accept()).await.map_err(|_| {
            format!("OAuth token callback timed out; last request path: {last_path}")
        })?;
        let (mut socket, _) =
            accept_result.map_err(|error| format!("OAuth callback accept failed: {error}"))?;

        let mut buffer = vec![0_u8; 8192];
        let size = socket
            .read(&mut buffer)
            .await
            .map_err(|error| format!("OAuth callback read failed: {error}"))?;
        let request = String::from_utf8_lossy(&buffer[..size]);
        let first_line = request.lines().next().unwrap_or_default();
        let path = first_line
            .split_whitespace()
            .nth(1)
            .unwrap_or_default()
            .to_string();
        last_path = path.clone();
        let query = path
            .split_once('?')
            .map(|(_, query)| query)
            .unwrap_or_default();
        let params: HashMap<String, String> = url::form_urlencoded::parse(query.as_bytes())
            .into_owned()
            .collect();

        if path.starts_with("/donationalerts/token") {
            if params.get("state") != Some(&expected_state) {
                write_oauth_response(&mut socket, "OAuth failed", "State mismatch.").await;
                return Err("DonationAlerts OAuth state mismatch".to_string());
            }
            if let Some(token) = params.get("access_token") {
                write_oauth_response(&mut socket, "Connected", "You can close this tab.").await;
                return Ok(token.clone());
            }
            if let Some(error) = params.get("error") {
                write_oauth_response(&mut socket, "OAuth failed", error).await;
                return Err(format!("DonationAlerts OAuth error: {error}"));
            }
        }

        write_fragment_capture_page(&mut socket, &expected_state).await;
    }
}

async fn write_fragment_capture_page(socket: &mut tokio::net::TcpStream, expected_state: &str) {
    let body = format!(
        r#"<!doctype html>
<html>
<body>
<h1>Connecting DonationAlerts...</h1>
<p>You can close this tab after it says Connected.</p>
<script>
const params = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.search.slice(1));
if (!params.get('state')) params.set('state', {state_json});
fetch('/donationalerts/token?' + params.toString()).then(() => {{
  document.body.innerHTML = '<h1>Connected</h1><p>You can close this tab.</p>';
}}).catch((error) => {{
  document.body.innerHTML = '<h1>OAuth failed</h1><p>' + String(error) + '</p>';
}});
</script>
</body>
</html>"#,
        state_json = serde_json::to_string(expected_state).unwrap_or_else(|_| "\"\"".to_string())
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = socket.write_all(response.as_bytes()).await;
}

async fn write_oauth_response(socket: &mut tokio::net::TcpStream, title: &str, message: &str) {
    let body = format!("<html><body><h1>{title}</h1><p>{message}</p></body></html>");
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = socket.write_all(response.as_bytes()).await;
}
