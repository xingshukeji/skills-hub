import { readFileSync } from 'node:fs';
const endpoint = JSON.parse(readFileSync(new URL('../references/endpoint.json', import.meta.url), 'utf8'));
const service = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const result = service.responses[endpoint.path] ?? { status: 404, body: { code: 'route_not_found' } };
console.log(JSON.stringify({ method: 'GET', path: endpoint.path, ...result }));
process.exitCode = result.status >= 200 && result.status < 300 ? 0 : 1;
