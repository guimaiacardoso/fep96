import { setCors, json } from '../lib/core.js';
const cache = new Map(); // termo -> { at, items }
let blockedUntil = 0; // até quando o Spotify está bloqueado (ms)
export default async function handler(req, res) {
setCors(req,res); if (req.method === 'OPTIONS') return res.status(204).end();
if (req.method !== 'GET') return json(res,405,{error:'method_not_allowed'});
// Public track search uses Spotify Client Credentials only.
// Do not require unrelated Supabase, admin-session, or playlist settings here.
const missing = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'].filter(k => !process.env[k]);
if (missing.length) return json(res, 503, { error: 'spotify_search_not_configured', missing });
const q = String(req.query?.q || '').trim().slice(0,120); if (q.length < 2) return json(res,400,{error:'query_too_short'});
const key = q.toLowerCase();
const hit = cache.get(key);
if (hit && Date.now() - hit.at < 10 * 60 * 1000) return json(res,200,hit.items);
if (Date.now() < blockedUntil) return json(res,503,{error:'spotify_rate_limited'});
try {
const auth = await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials'})});
const at = await auth.json().catch(() => ({}));
if (!auth.ok || !at.access_token) { console.error('spotify_token', auth.status, JSON.stringify(at).slice(0, 300)); return json(res,502,{error:'spotify_unavailable', status: auth.status}); }
const sr = await fetch(`https://api.spotify.com/v1/search?${new URLSearchParams({q,type:'track',limit:'8',market:'PT'})}`,{headers:{Authorization:`Bearer ${at.access_token}`}});
if (sr.status === 429) blockedUntil = Date.now() + (Number(sr.headers.get('retry-after')) || 60) * 1000;
const sd = await sr.json().catch(() => ({}));
if (!sr.ok) { console.error('spotify_search', sr.status, sr.headers.get('retry-after') || '', JSON.stringify(sd).slice(0, 300)); return json(res,502,{error:'spotify_search_failed', status: sr.status}); }
const items = (sd.tracks?.items || []).map(t=>({id:t.id,name:t.name,artist:t.artists.map(a=>a.name).join(', '),album:t.album.name,image:t.album.images[1]?.url||t.album.images[0]?.url||null,uri:t.uri}));
cache.set(key, { at: Date.now(), items });
return json(res,200,items);
} catch (e) { console.error('spotify_exception', e); return json(res,502,{error:'spotify_unavailable'}); }
}
