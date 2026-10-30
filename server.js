import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
http.createServer(async (req, res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url, 'http://localhost').pathname));
    if (!path.startsWith(root + sep) || !['.html', '.js', '.css', '.svg'].includes(extname(path))) { res.writeHead(404).end(); return; }
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-store', 'Permissions-Policy': 'bluetooth=(self)' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(5173, '127.0.0.1', () => console.log('Open http://localhost:5173 in desktop Chrome or Edge. Ctrl+C to stop.'));
