'use strict';
// خادم يحاكي واجهة Supabase Storage. يعمل في عملية مستقلة لأن الموقع ينتظر ردود التخزين بشكل متزامن.
const http = require('node:http');

const calls = [];
let bucketExists = false;
let failing = false;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('base64') });
    const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (failing) return json(500, {});
    if (req.method === 'POST' && req.url === '/storage/v1/bucket') { bucketExists = true; return json(200, { name: 'nabd-media' }); }
    if (req.method === 'POST' && req.url.startsWith('/storage/v1/object/nabd-media/')) {
      if (!bucketExists) return json(404, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
      return json(200, { Key: req.url.slice('/storage/v1/object/'.length) });
    }
    if (req.method === 'DELETE') return json(200, {});
    json(400, { message: 'unexpected' });
  });
});
server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('message', (m) => {
  if (m === 'calls') process.send({ calls });
  if (m === 'fail') { failing = true; process.send({ ok: true }); }
});
process.on('disconnect', () => process.exit(0));
