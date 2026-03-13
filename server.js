const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const marketsHandler = require('./api/markets');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      sendJson(res, 404, { error: 'Arquivo não encontrado.' });
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', contentType);
    res.end(content);
  });
}

function createVercelLikeResponse(nodeRes) {
  return {
    setHeader(name, value) {
      nodeRes.setHeader(name, value);
    },
    status(code) {
      nodeRes.statusCode = code;
      return this;
    },
    end(body) {
      nodeRes.end(body);
    },
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);
    const pathname = decodeURIComponent(parsed.pathname);

    if (pathname === '/api/markets') {
      const query = {};
      for (const [key, value] of parsed.searchParams.entries()) {
        if (query[key] === undefined) {
          query[key] = value;
        } else if (Array.isArray(query[key])) {
          query[key].push(value);
        } else {
          query[key] = [query[key], value];
        }
      }

      const vercelReq = { method: req.method, headers: req.headers, query };
      const vercelRes = createVercelLikeResponse(res);
      await marketsHandler(vercelReq, vercelRes);
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      serveFile(res, path.join(ROOT, 'index.html'));
      return;
    }

    const requested = path.join(ROOT, pathname);
    if (!requested.startsWith(ROOT)) {
      sendJson(res, 403, { error: 'Acesso negado.' });
      return;
    }

    if (fs.existsSync(requested) && fs.statSync(requested).isFile()) {
      serveFile(res, requested);
      return;
    }

    sendJson(res, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Erro interno no servidor local.' });
  }
});

server.listen(PORT, () => {
  console.log(`Servidor local rodando em http://localhost:${PORT}`);
});
