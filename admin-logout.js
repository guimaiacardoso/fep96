import { setCors, json, clearCookie } from '../lib/core.js';
export default async function handler(req, res) { setCors(req,res); if (req.method === 'OPTIONS') return res.status(204).end(); res.setHeader('Set-Cookie', clearCookie('dj_session')); return json(res,200,{ok:true}); }
