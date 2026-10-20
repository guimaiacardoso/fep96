import crypto from 'node:crypto';
import { config, setCors, json, isAdmin, db, parseBody, makeCookie, clearCookie, spotifyPlaylistId } from '../lib/core.js';
export default async function handler(req,res) {
  setCors(req,res); if(req.method==='OPTIONS') return res.status(204).end(); if(!config(res)) return;
  const action=String(req.query?.action||'status');
  if(action==='status' && req.method==='GET') {
    if(!isAdmin(req)) return json(res,401,{error:'unauthorized'});
    const {data}=await db('app_settings?key=eq.spotify_tokens&select=key');
    return json(res,200,{connected:!!data?.length,playlistUrl:`https://open.spotify.com/playlist/${spotifyPlaylistId()}`});
  }
  if(action==='login' && req.method==='GET') {
    if(!isAdmin(req)) return json(res,401,{error:'unauthorized'});
    const state=crypto.randomBytes(24).toString('hex');
    res.setHeader('Set-Cookie',makeCookie('spotify_oauth_state',state,600));
    const url=new URL('https://accounts.spotify.com/authorize');
    url.search=new URLSearchParams({client_id:process.env.SPOTIFY_CLIENT_ID,response_type:'code',redirect_uri:process.env.SPOTIFY_REDIRECT_URI,scope:'playlist-modify-private playlist-modify-public playlist-read-private',state}).toString();
    res.setHeader('Location',url.toString()); return res.status(302).end();
  }
  if(action==='callback' && req.method==='GET') {
    const stateCookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('spotify_oauth_state='))?.split('=').slice(1).join('=');
    if(!req.query?.code || !req.query?.state || !stateCookie || req.query.state!==stateCookie) return json(res,400,{error:'invalid_oauth_state'});
    const tokenRes=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:String(req.query.code),redirect_uri:process.env.SPOTIFY_REDIRECT_URI})});
    const token=await tokenRes.json(); if(!tokenRes.ok) return json(res,502,{error:'spotify_authorization_failed'});
    await db('app_settings?on_conflict=key',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({key:'spotify_tokens',value:{access_token:token.access_token,refresh_token:token.refresh_token,expires_at:Date.now()+token.expires_in*1000}})});
    res.setHeader('Set-Cookie',clearCookie('spotify_oauth_state')); res.setHeader('Location','/?spotify=connected#dj'); return res.status(302).end();
  }
  return json(res,405,{error:'method_not_allowed'});
}
