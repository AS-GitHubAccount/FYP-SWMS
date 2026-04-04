// node tests/api.test.js
const http = require('http');

const BASE = process.env.API_URL || 'http://localhost:3000';

function request(path, method = 'GET', body) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE);
        const opts = { method, hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search };
        if (body) {
            opts.headers = { 'Content-Type': 'application/json' };
        }
        const req = http.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data || '{}') });
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function run() {
    console.log('SWMS API Smoke Tests');
    const health = await request('/health');
    if (health.status !== 200) {
        console.error('FAIL: /health', health);
        process.exit(1);
    }
    console.log('OK: /health');
    const products = await request('/api/products');
    if (products.status !== 200 || !products.data.success) {
        console.error('FAIL: /api/products', products);
        process.exit(1);
    }
    console.log('OK: /api/products');
    const inv = await request('/api/inventory');
    if (inv.status !== 200 || !inv.data.success) {
        console.error('FAIL: /api/inventory', inv);
        process.exit(1);
    }
    console.log('OK: /api/inventory');
    const reorder = await request('/api/inventory/reorder-suggestions');
    console.log(reorder.status === 200 ? 'OK' : 'WARN', ': /api/inventory/reorder-suggestions');
    console.log('Smoke tests passed.');
}
run().catch(e => { console.error(e); process.exit(1); });
