const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8083;
const ROOT = __dirname;
const API_HOST = (process.env.EXPO_PUBLIC_API_URL || 'https://api.poohter.com').replace(/\/+$/, '');
const API_ORIGIN = API_HOST.endsWith('/api') ? API_HOST.slice(0, -4) : API_HOST;
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

const proxyApiRequest = async (req, res) => {
  const upstreamUrl = `${API_ORIGIN}${req.url}`;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;

  try {
    const response = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
      duplex: ['GET', 'HEAD'].includes(req.method) ? undefined : 'half',
    });

    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Cannot connect to Poohter API. Please try again.' }));
  }
};

const server = http.createServer((req, res) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    proxyApiRequest(req, res);
    return;
  }

  const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.normalize(path.join(ROOT, requestPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`Poohter wholesaler website running at http://127.0.0.1:${PORT}`);
});
