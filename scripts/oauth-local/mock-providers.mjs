#!/usr/bin/env node
/**
 * Local Google/Microsoft OAuth authorization mocks. No real provider calls.
 * Usage: node scripts/oauth-local/mock-providers.mjs
 */
import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.OAUTH_MOCK_PORT || 8790);

function html(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
  <body style="font-family:system-ui;padding:24px">${body}</body></html>`;
}

function authorize(req, res, provider) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const redirectUri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  const scenario = url.searchParams.get('scenario') || 'success';
  if (!redirectUri || !state) {
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('missing redirect_uri or state');
    return;
  }
  const target = new URL(redirectUri);
  if (scenario === 'deny') {
    target.searchParams.set('error', 'access_denied');
    target.searchParams.set('state', state);
  } else if (scenario === 'invalid_code') {
    target.searchParams.set('code', 'invalid-code');
    target.searchParams.set('state', state);
  } else {
    target.searchParams.set('code', `${provider}-auth-code-mock`);
    target.searchParams.set('state', state);
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(
    html(
      `${provider} mock`,
      `<h1>${provider} mock consent</h1>
       <p>scenario=${scenario}</p>
       <a id="approve" href="${target.toString()}">Approve</a>
       <a id="deny" href="${(() => {
         const d = new URL(redirectUri);
         d.searchParams.set('error', 'access_denied');
         d.searchParams.set('state', state);
         return d.toString();
       })()}">Deny</a>`,
    ),
  );
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === '/google/authorize') return authorize(req, res, 'GOOGLE');
  if (url.pathname === '/microsoft/authorize') return authorize(req, res, 'MICROSOFT');
  if (url.pathname === '/google/token' || url.pathname === '/microsoft/token') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'local-mock-access', refresh_token: 'local-mock-refresh', expires_in: 3600 }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(JSON.stringify({ mock_providers: true, host: '127.0.0.1', port: PORT }));
});
