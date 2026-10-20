import { configAdmin, setCors, parseBody, json, makeCookie, issueSession, safeEqual } from '../lib/core.js';
export default async function handler(req, res) {
  setCors(req, res); if (req.method === 'OPTIONS') return res.status(204).end();
  if (!configAdmin(res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  const { password } = parseBody(req);
  if (typeof password !== 'string' || password.length > 256 || !safeEqual(password, process.env.DJ_ADMIN_PASSWORD)) return json(res, 401, { error: 'invalid_credentials' });
  res.setHeader('Set-Cookie', makeCookie('dj_session', issueSession(), 43200));
  return json(res, 200, { ok: true });
}
