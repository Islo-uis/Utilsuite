const GH_OAUTH = 'https://github.com/login/oauth';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/auth') {
      const returnTo = url.searchParams.get('return') || env.ALLOWED_ORIGIN;
      const state = btoa(JSON.stringify({ r: returnTo, n: crypto.randomUUID() }));
      return Response.redirect(GH_OAUTH + '/authorize?client_id=' + env.GH_CLIENT_ID + '&scope=read:user&state=' + encodeURIComponent(state), 302);
    }

    if (url.pathname === '/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      if (!code || !state) return new Response('Bad request', { status: 400 });
      const parsed = JSON.parse(atob(state));
      const tokenRes = await fetch(GH_OAUTH + '/access_token', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: env.GH_CLIENT_ID, client_secret: env.GH_CLIENT_SECRET, code }),
      });
      const tokenJson = await tokenRes.json();
      if (!tokenJson.access_token) return new Response('OAuth failed', { status: 401 });
      const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer ' + tokenJson.access_token, 'User-Agent': 'utility-suite' } });
      const user = await userRes.json();
      if (user.login !== env.GH_OWNER) return new Response('Forbidden', { status: 403 });
      const exp = Date.now() + 4 * 60 * 60 * 1000;
      const payload = user.login + '.' + exp;
      const sig = await hmac(env.GH_CLIENT_SECRET, payload);
      return Response.redirect(parsed.r + '?token=' + payload + '.' + sig, 302);
    }

    if (url.pathname === '/stats') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.replace(/^Bearer\s+/, '');
      if (!(await verifyToken(token, env))) return json({ error: 'unauthorized' }, 401, cors);
      const range = Math.min(365, Math.max(1, parseInt(url.searchParams.get('range') || '7', 10)));
      const site = 'https://' + env.GOATCOUNTER_CODE + '.goatcounter.com';
      const headers = { Authorization: 'Bearer ' + env.GOATCOUNTER_KEY };
      const start = isoDaysAgo(range), end = isoToday();
      const [hitsRes, pagesRes, refsRes] = await Promise.all([
        fetch(site + '/api/v0/stats/hits?start=' + start + '&end=' + end + '&daily=true', { headers }),
        fetch(site + '/api/v0/stats/hits?start=' + start + '&end=' + end + '&group=path', { headers }),
        fetch(site + '/api/v0/stats/hits?start=' + start + '&end=' + end + '&group=ref', { headers }),
      ]);
      const [hits, pages, refs] = await Promise.all([safeJson(hitsRes), safeJson(pagesRes), safeJson(refsRes)]);
      return json(shapeStats({ hits, pages, refs }), 200, cors);
    }
    return new Response('Not found', { status: 404, headers: cors });
  },
};

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '');
}
async function verifyToken(token, env) {
  if (!token || token.split('.').length < 3) return false;
  const idx = token.lastIndexOf('.');
  const payload = token.slice(0, idx), sig = token.slice(idx + 1);
  const exp = +payload.split('.').pop();
  if (!exp || exp < Date.now()) return false;
  return sig === await hmac(env.GH_CLIENT_SECRET, payload);
}
function safeJson(res) { return res.ok ? res.json().catch(() => ({})) : Promise.resolve({}); }
function isoToday() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function json(obj, status, cors) { return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors } }); }

function shapeStats({ hits, pages, refs }) {
  const h = hits.hits || [];
  const total = h.reduce((s, d) => s + (d.count || 0), 0);
  const series = h.map((d) => ({ date: d.date, value: d.count || 0 }));
  const p = (pages.hits || []).map((r) => ({ path: r.path || r.id, count: r.count }));
  const rf = (refs.hits || []).map((r) => ({ name: r.ref || r.id || 'Direct', count: r.count }));
  const tools = aggregateTools(pages.hits || []);
  return {
    summary: { visitors: total, pageviews: total, tool_starts: tools.reduce((s, t) => s + t.starts, 0), downloads: tools.reduce((s, t) => s + t.downloads, 0) },
    timeseries: series, pages: p, referrers: rf, tools,
  };
}
function aggregateTools(hits) {
  const map = {};
  hits.forEach((h) => {
    const m = /^\/tool\/([^/]+)\/(open|start|complete|download)$/.exec(h.path || '');
    if (!m) return;
    map[m[1]] = map[m[1]] || { name: m[1], opens: 0, starts: 0, completions: 0, downloads: 0 };
    if (m[2] === 'open') map[m[1]].opens += h.count;
    if (m[2] === 'start') map[m[1]].starts += h.count;
    if (m[2] === 'complete') map[m[1]].completions += h.count;
    if (m[2] === 'download') map[m[1]].downloads += h.count;
  });
  return Object.values(map);
}