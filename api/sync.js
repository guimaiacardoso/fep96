import { config, setCors, json, isAdmin, db, syncRequest } from '../lib/core.js';
export default async function handler(req,res) {
  setCors(req,res); if(req.method==='OPTIONS') return res.status(204).end(); if(!config(res)) return;
  if(!isAdmin(req)) return json(res,401,{error:'unauthorized'});
  if(req.method!=='POST') return json(res,405,{error:'method_not_allowed'});
  try {
    const {data}=await db('requests?spotify_sync_status=in.(pending,failed,syncing)&select=id,track,spotify_sync_status&order=created_at.asc&limit=50');
    let synced=0,failed=0;
    for(const item of (data||[])) { try { await syncRequest(item); synced++; } catch { failed++; } }
    return json(res,200,{synced,failed});
  } catch { return json(res,500,{error:'sync_failed'}); }
}
