import crypto from 'node:crypto';
import { configDatabase, configAdmin, setCors, json, parseBody, isAdmin, db, syncRequest } from '../lib/core.js';
export default async function handler(req,res) {
  setCors(req,res); if(req.method==='OPTIONS') return res.status(204).end(); if(!configDatabase(res)) return;
  try {
    if(req.method==='GET') {
      const {data}=await db('requests?select=id,track,requester,played,created_at,spotify_sync_status,spotify_sync_error&order=created_at.desc&limit=500');
      return json(res,200,(data||[]).map(r=>({...r,time:new Date(r.created_at).toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})})));
    }
    if(req.method==='POST') {
      const body=parseBody(req); const track=body.track; const requester=String(body.requester||'Anónimo').trim().slice(0,80)||'Anónimo';
      if(!track || !/^[A-Za-z0-9]{10,30}$/.test(String(track.id||'')) || typeof track.name!=='string' || typeof track.artist!=='string') return json(res,400,{error:'invalid_track'});
      const key=String(req.headers['idempotency-key']||'').slice(0,100);
      if (key) { const prior=await db(`requests?idempotency_key=eq.${encodeURIComponent(key)}&select=*`); if(prior.data?.[0]) return json(res,200,prior.data[0]); }
      const id=crypto.randomUUID();
      const row={id,track:{id:String(track.id),name:track.name.slice(0,200),artist:track.artist.slice(0,300),album:String(track.album||'').slice(0,200),image:typeof track.image==='string'?track.image.slice(0,1000):null,uri:`spotify:track:${track.id}`},requester,played:false,spotify_sync_status:'pending',spotify_sync_error:null,idempotency_key:key||null};
      let data; try { ({data}=await db('requests',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(row)})); } catch(e) { if(key) { const prior=await db(`requests?idempotency_key=eq.${encodeURIComponent(key)}&select=*`); if(prior.data?.[0]) return json(res,200,prior.data[0]); } throw e; }
      const created=data?.[0]||row;
      try { await syncRequest(created); created.spotify_sync_status='synced'; }
      catch(e) { created.spotify_sync_status='failed'; created.spotify_sync_error=e.message; }
      return json(res,201,{...created,time:new Date().toLocaleTimeString('pt-PT',{hour:'2-digit',minute:'2-digit'})});
    }
    if(!configAdmin(res)) return;
    if(!isAdmin(req)) return json(res,401,{error:'unauthorized'});
    const id=String(req.query?.id||''); const trackId=String(req.query?.track||'');
    // Âmbito: um pedido (id) ou todos os pedidos de uma música (track = Spotify track id).
    const scope = trackId
      ? (/^[A-Za-z0-9]{10,30}$/.test(trackId) ? `track->>id=eq.${trackId}` : null)
      : (id ? `id=eq.${encodeURIComponent(id)}` : null);
    if(req.method==='PATCH') {
      const body=parseBody(req); const patch={}; if(typeof body.played==='boolean') patch.played=body.played;
      if(!Object.keys(patch).length) return json(res,400,{error:'invalid_update'});
      if(!scope) return json(res,400,{error:'missing_id'});
      await db(`requests?${scope}`,{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify(patch)}); return json(res,200,{ok:true});
    }
    if(req.method==='DELETE') {
      if(id==='all') await db('requests?id=not.is.null',{method:'DELETE',headers:{Prefer:'return=minimal'}});
      else if(scope) await db(`requests?${scope}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});
      else return json(res,400,{error:'missing_id'});
      return json(res,200,{ok:true});
    }
    return json(res,405,{error:'method_not_allowed'});
  } catch(e) { console.error('requests_api_error',e.message,e.details||''); return json(res,500,{error:'request_failed'}); }
}
