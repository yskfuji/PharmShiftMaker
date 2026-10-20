const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dist = process.env.NEXT_DIST_DIR || '.next';
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'server/server-reference-manifest.json'), 'utf8'));
const actions = [...Object.values(manifest.node || {}), ...Object.values(manifest.edge || {})];
assert(actions.length > 0, 'Expected compiled server actions');
assert(!actions.some(action => action.exportedName === 'getAuthToken' || /(?:^|\/)lib\/auth\.ts$/.test(action.filename || '')), 'Server-only helper must not be registered as an action');
assert(actions.some(action => action.exportedName === 'generateSchedule'), 'Expected scheduling action');
console.log('Compiled server boundaries verified');
