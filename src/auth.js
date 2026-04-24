// Auth + save-sync client for the HefflHoff backend. Stores JWT in
// localStorage so repeat opens auto-login. Falls back to a local-only mode
// if the backend is unreachable (game still plays, saves stay on device).

const LS_TOKEN = 'hh_token';
const LS_EMAIL = 'hh_email';
const LS_STATE = 'hh_state';     // mirror of last save, offline fallback
const LS_API   = 'hh_api_url';   // remembered backend URL

// Default production backend. Overridable via the Server URL field on the
// auth screen (cached in localStorage) or ?api=... URL param.
const DEFAULT_API_URL = 'https://api.trinitycloud.com.au';

// Backend URL is hardcoded — end users can't reasonably enter it.
// Use ?api=... only when running against a local dev backend from a browser.
function readBaseUrl() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('api')) return q.get('api').replace(/\/$/, '');
  } catch {} // eslint-disable-line no-empty
  return DEFAULT_API_URL;
}

export class AuthClient {
  constructor(baseUrl = null) {
    this.baseUrl = baseUrl || readBaseUrl();
    this.token = localStorage.getItem(LS_TOKEN) || null;
    this.email = localStorage.getItem(LS_EMAIL) || null;
  }

  setBaseUrl(url) {
    this.baseUrl = url.replace(/\/$/, '');
    localStorage.setItem(LS_API, this.baseUrl);
  }

  get isAuthed() { return !!this.token; }

  async _fetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const url = this.baseUrl + path;
    let res;
    try {
      res = await fetch(url, {
        ...opts,
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      console.error('[auth] fetch threw:', e?.name, e?.message, 'url=', url);
      throw e;
    }
    let data = null;
    try { data = await res.json(); } catch {} // eslint-disable-line no-empty
    if (!res.ok) {
      const err = new Error(data?.error || `http_${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async register(email, password) {
    const data = await this._fetch('/api/auth/register', {
      method: 'POST', body: { email, password },
    });
    this._store(data.token, data.user?.email || email);
    return data;
  }

  async login(email, password) {
    const data = await this._fetch('/api/auth/login', {
      method: 'POST', body: { email, password },
    });
    this._store(data.token, data.user?.email || email);
    return data;
  }

  logout() {
    this.token = null;
    this.email = null;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_EMAIL);
  }

  _store(token, email) {
    this.token = token;
    this.email = email;
    localStorage.setItem(LS_TOKEN, token);
    localStorage.setItem(LS_EMAIL, email);
  }

  async loadSave() {
    if (!this.token) return null;
    try {
      const data = await this._fetch('/api/save');
      if (data?.gameState) {
        localStorage.setItem(LS_STATE, JSON.stringify(data.gameState));
      }
      return data?.gameState || null;
    } catch (err) {
      // If backend is down, fall back to last local cached save
      const local = localStorage.getItem(LS_STATE);
      if (local) { try { return JSON.parse(local); } catch {} } // eslint-disable-line no-empty
      console.warn('[auth] loadSave failed:', err?.message);
      return null;
    }
  }

  async writeSave(gameState) {
    // Always mirror to localStorage first — offline-safe
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(gameState));
    } catch {} // eslint-disable-line no-empty
    if (!this.token) return { ok: true, offline: true };
    try {
      return await this._fetch('/api/save', { method: 'PUT', body: { gameState } });
    } catch (err) {
      console.warn('[auth] writeSave failed (kept locally):', err?.message);
      return { ok: false, error: err?.message };
    }
  }

  async wipeSave() {
    localStorage.removeItem(LS_STATE);
    if (!this.token) return { ok: true, offline: true };
    return this._fetch('/api/save', { method: 'DELETE' });
  }
}

// ===== Start-screen UI =====
// Renders the login/register modal. Resolves with `{ authClient, savedState }`
// once the player is authenticated. On auto-login (token already cached) the
// modal never shows and the game boots straight into their save.
export function showAuthScreen() {
  return new Promise((resolve) => {
    const auth = new AuthClient();

    const finish = async () => {
      const state = await auth.loadSave();
      resolve({ auth, savedState: state });
    };

    // Auto-login if we already have a token cached on this device
    if (auth.isAuthed) {
      finish();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'auth-overlay';
    overlay.innerHTML = `
      <div class="auth-panel">
        <div class="auth-logo">🌾 HefflHoff Farm 🐄</div>
        <div class="auth-tabs">
          <button class="auth-tab active" data-tab="login">Log In</button>
          <button class="auth-tab" data-tab="register">Create Account</button>
        </div>
        <form class="auth-form" autocomplete="off">
          <label>
            <span>Email</span>
            <input type="email" name="email" required autocomplete="email"/>
          </label>
          <label>
            <span>Password</span>
            <input type="password" name="password" required minlength="4"
                   autocomplete="current-password"/>
          </label>
          <button type="submit" class="auth-submit">Play</button>
          <button type="button" class="auth-skip">Play offline →</button>
          <div class="auth-msg"></div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);

    const tabs = overlay.querySelectorAll('.auth-tab');
    const form = overlay.querySelector('form');
    const submitBtn = overlay.querySelector('.auth-submit');
    const skipBtn = overlay.querySelector('.auth-skip');
    const msg = overlay.querySelector('.auth-msg');
    const emailInput = form.email;
    const passwordInput = form.password;
    let mode = 'login';

    tabs.forEach((t) => {
      t.addEventListener('click', () => {
        tabs.forEach((x) => x.classList.remove('active'));
        t.classList.add('active');
        mode = t.dataset.tab;
        submitBtn.textContent = mode === 'login' ? 'Log In' : 'Create & Play';
        passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
        msg.textContent = '';
      });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = '';
      submitBtn.disabled = true;
      try {
        if (mode === 'register') {
          await auth.register(emailInput.value.trim(), passwordInput.value);
        } else {
          await auth.login(emailInput.value.trim(), passwordInput.value);
        }
        overlay.remove();
        finish();
      } catch (err) {
        console.error('[auth] submit failed:', err?.name, err?.message, err?.stack);
        const msgMap = {
          email_taken: 'That email is already registered — try logging in.',
          bad_credentials: 'Wrong email or password.',
          password_too_short: 'Password must be at least 4 characters.',
          missing_fields: 'Email and password are required.',
          'Failed to fetch': `Can't reach the server at ${auth.baseUrl}. Check it's running and the URL is reachable from this device.`,
        };
        msg.textContent = msgMap[err.message] || `Error: ${err.message}`;
        submitBtn.disabled = false;
      }
    });

    skipBtn.addEventListener('click', async () => {
      // Offline mode — no backend, saves stay on device
      overlay.remove();
      const state = await auth.loadSave();
      resolve({ auth, savedState: state });
    });
  });
}
