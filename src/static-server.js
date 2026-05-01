import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { repoRoot } from './paths.js';

const REPO_ROOT_WITH_SEP = repoRoot.endsWith(sep) ? repoRoot : `${repoRoot}${sep}`;

const PORT = Number(process.env.PORT || 4173);
const HOST = '127.0.0.1';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml'
};

/**
 * CSP connect-src must list origins explicitly (no port wildcards in all browsers).
 * Previously only :11434 was allowed, so fetch() to QVAC/Ollama on any other port was blocked
 * with no visible error besides a failed completion.
 */
function buildLocalLlmConnectSrc() {
  if (process.env.INTELLIGENCE_CONNECT_SRC?.trim()) {
    return process.env.INTELLIGENCE_CONNECT_SRC.trim();
  }
  const ports = new Set([8080, 8081, 3000, 5000, 7860, 8888, 3939, 11434, 11435]);
  for (let p = 11424; p <= 11455; p += 1) ports.add(p);
  const parts = ["'self'"];
  for (const p of ports) {
    parts.push(`http://127.0.0.1:${p}`, `http://localhost:${p}`);
  }
  return parts.join(' ');
}

function resolvePath(requestUrl) {
  const url = new URL(requestUrl, `http://${HOST}:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/intelligence') pathname = '/intelligence/';
  if (pathname.endsWith('/')) pathname += 'index.html';

  const target = normalize(resolve(repoRoot, `.${pathname}`));
  if (target !== repoRoot && !target.startsWith(REPO_ROOT_WITH_SEP)) return null;
  return target;
}

createServer((req, res) => {
  const target = resolvePath(req.url || '/');
  if (!target || !existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(target)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      `connect-src ${buildLocalLlmConnectSrc()}`,
      "font-src 'self' data:",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'"
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY'
  });
  createReadStream(target).pipe(res);
}).listen(PORT, HOST, () => {
  console.log(`DDD Intelligence UI: http://${HOST}:${PORT}/intelligence/`);
  console.log('This server only serves local static files from the DDD repo.');
  console.log(
    'CSP connect-src allows loopback QVAC/Ollama on common ports (11424–11455, etc.). Override with INTELLIGENCE_CONNECT_SRC if needed.'
  );
});
