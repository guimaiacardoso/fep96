import crypto from 'node:crypto';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DJ_ADMIN_PASSWORD', 'SESSION_SECRET', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'SPOTIFY_REDIRECT_URI', 'SPOTIFY_PLAYLIST_ID'];
export function config(res) {
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) { res.status(503).json({ error: 'server_not_configured', missing }); return false; }
  return true;
}
export function configDatabase(res) {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !process.env[k]);
  if (missing.length) { res.status(503).json({ error: 'database_not_configured', missing }); return false; }
  return true;
}
export function configAdmin(res) {
  const missing = ['DJ_ADMIN_PASSWORD', 'SESSION_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !process.env[k]);
  if (missing.length) { res.status(503).json({ error: 'admin_not_configured', missing }); return false; }
  return true;
}
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
export function json(res, status, body) { return res.status(status).json(body); }
export function setCors(req, res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || (req.headers.host ? `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}` : ''));
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
  res.setHeader('Cache-Control', 'no-store');
}
export function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}
function sign(value) { return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url'); }
export function makeCookie(name, value, maxAge) { return `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`; }
export function clearCookie(name) { return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`; }
export function issueSession() { const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url'); return `${payload}.${sign(payload)}`; }
export function isAdmin(req) {
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('dj_session='));
  if (!cookie) return false;
  const token = cookie.slice('dj_session='.length); const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
  const a = Buffer.from(sig); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}
export async function db(path, options = {}) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const r = await fetch(`${base}/rest/v1/${path}`, { ...options, headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) { const e = new Error('database_error'); e.status = r.status; e.details = data; throw e; }
  return { data, response: r };
}
export async function spotifyToken() {
  const { data } = await db('app_settings?key=eq.spotify_tokens&select=value');
  const row = data?.[0]; if (!row?.value?.access_token) throw new Error('spotify_not_connected');
  let tokens = row.value;
  if (Date.now() > (tokens.expires_at || 0) - 60_000) {
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }) });
    const d = await r.json(); if (!r.ok) throw new Error('spotify_token_refresh_failed');
    tokens = { ...tokens, access_token: d.access_token, refresh_token: d.refresh_token || tokens.refresh_token, expires_at: Date.now() + d.expires_in * 1000 };
    await db('app_settings?on_conflict=key', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ key: 'spotify_tokens', value: tokens }) });
  }
  return tokens.access_token;
}
export async function spotifyFetch(path, options = {}) {
  const token = await spotifyToken();
  const r = await fetch(`https://api.spotify.com/v1${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const text = await r.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const e = new Error(spotifyErrorCode(r.status)); e.status = r.status; e.retryAfter = r.headers.get('retry-after');
    e.details = data?.error?.message || null;
    console.error('spotify_api_error', path.split('?')[0], r.status, e.details || '');
    throw e;
  }
  return data;
}
function spotifyErrorCode(status) {
  if (status === 400) return 'spotify_bad_request';
  if (status === 401) return 'spotify_unauthorized';
  if (status === 403) return 'spotify_forbidden';
  if (status === 404) return 'spotify_not_found';
  if (status === 429) return 'spotify_rate_limited';
  return 'spotify_api_error';
}
// Aceita o ID da playlist, o URI spotify:playlist:ID ou o URL completo (copiado do browser).
export function spotifyPlaylistId() {
  const raw = String(process.env.SPOTIFY_PLAYLIST_ID || '').trim();
  const m = raw.match(/playlist[/:]([A-Za-z0-9]{10,40})/);
  return m ? m[1] : raw;
}
export async function syncRequest(request) {
  const { data: rows } = await db(`requests?id=eq.${encodeURIComponent(request.id)}&select=id,track,spotify_sync_status`);
  const current = rows?.[0]; if (!current || current.spotify_sync_status === 'synced') return;
  const trackId = String(current.track?.id || '');
  if (!/^[A-Za-z0-9]{10,30}$/.test(trackId)) throw new Error('invalid_spotify_track');
  // Se esta música já foi sincronizada por outro pedido, não volta a ser adicionada à playlist.
  const { data: siblings } = await db(`requests?track->>id=eq.${trackId}&spotify_sync_status=eq.synced&id=neq.${encodeURIComponent(request.id)}&select=id&limit=1`);
  if (siblings?.length) {
    await db(`requests?id=eq.${encodeURIComponent(request.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ spotify_sync_status: 'synced', spotify_sync_error: null }) });
    return;
  }
  await db(`requests?id=eq.${encodeURIComponent(request.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ spotify_sync_status: 'syncing', spotify_sync_error: null }) });
  try {
    // Check the playlist before adding: this also makes retries after a timeout safer.
    // Spotify limita /playlists/{id}/items a 50 itens por página (valor acima disto devolve 400).
    const playlistId = spotifyPlaylistId();
    let next = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50`; let exists = false; let pages = 0;
    while (next && !exists && pages < 100) {
      const items = await spotifyFetch(next.replace('https://api.spotify.com/v1',''));
      exists = (items?.items || []).some(i => i.item?.id === trackId || i.track?.id === trackId);
      next = items?.next || null; pages++;
    }
    if (!exists) await spotifyFetch(`/playlists/${encodeURIComponent(playlistId)}/items`, { method: 'POST', body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }) });
    await db(`requests?id=eq.${encodeURIComponent(request.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ spotify_sync_status: 'synced', spotify_sync_error: null }) });
  } catch (e) {
    await db(`requests?id=eq.${encodeURIComponent(request.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ spotify_sync_status: 'failed', spotify_sync_error: e.message }) }).catch(() => {});
    throw e;
  }
}
