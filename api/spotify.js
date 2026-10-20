import { setCors, json } from '../lib/core.js';
export default async function handler(req, res) {
  setCors(req,res); if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return json(res,405,{error:'method_not_allowed'});
  // Public track search uses Spotify Client Credentials only.
  // Do not require unrelated Supabase, admin-session, or playlist settings here.
  const missing = ['SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'].filter(k => !process.env[k]);
  if (missing.length) return json(res, 503, { error: 'spotify_search_not_configured', missing });
  const q = String(req.query?.q || '').trim().slice(0,120); if (q.length < 2) return json(res,400,{error:'query_too_short'});
  try {
    const auth = await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials'})});
    const at = await auth.json(); if(!auth.ok || !at.access_token) return json(res,502,{error:'spotify_unavailable'});
    const sr = await fetch(`https://api.spotify.com/v1/search?${new URLSearchParams({q,type:'track',limit:'8',market:'PT'})}`,{headers:{Authorization:`Bearer ${at.access_token}`}});
    const sd = await sr.json(); if(!sr.ok) return json(res,502,{error:'spotify_search_failed'});
    return json(res,200,(sd.tracks?.items || []).map(t=>({id:t.id,name:t.name,artist:t.artists.map(a=>a.name).join(', '),album:t.album.name,image:t.album.images[1]?.url||t.album.images[0]?.url||null,uri:t.uri})));
  } catch { return json(res,502,{error:'spotify_unavailable'}); }
}
