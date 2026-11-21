// Stand-in for n8n's webhook, for UI testing only: POST /webhook/support-agent -> pipeline with the stub model.
const http = require('http');
const { makePipeline } = require('./pipeline');
const { stubModel } = require('./stub_model');

const p = makePipeline(async (m) => stubModel(m));
const server = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'POST' && req.url === '/webhook/support-agent') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      // n8n gives text/plain bodies to the workflow as a string; mimic that
      const body = (req.headers['content-type'] || '').startsWith('text/plain') ? raw : JSON.parse(raw || '{}');
      const r = await p.handle(body);
      setTimeout(() => { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(r.response)); }, 600);
    });
    return;
  }
  res.writeHead(404, cors); res.end('not found');
});
server.listen(Number(process.env.PORT || 5678), () => console.log('mock webhook on', server.address().port));
