const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const REDIRECT_URI = window.location.origin + window.location.pathname;
const TOKEN_KEY = 'gsuite_oauth';

function base64UrlEncode(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomString(len = 64) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr).slice(0, len);
}
async function sha256(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
}

export async function login() {
  const verifier = randomString(96);
  const challenge = base64UrlEncode(await sha256(verifier));
  sessionStorage.setItem('pkce_verifier', verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

export async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return false;
  const verifier = sessionStorage.getItem('pkce_verifier');
  if (!verifier) return false;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: REDIRECT_URI,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!data.access_token) return false;
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify({
    ...data,
    expires_at: Date.now() + (data.expires_in * 1000),
  }));
  sessionStorage.removeItem('pkce_verifier');
  history.replaceState({}, '', window.location.pathname + window.location.hash);
  return true;
}

export function getToken() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw);
    if (t.expires_at && Date.now() > t.expires_at - 60000) {
      logout();
      return null;
    }
    return t;
  } catch { return null; }
}
export function isLoggedIn() { return !!getToken(); }
export function logout() { sessionStorage.removeItem(TOKEN_KEY); }