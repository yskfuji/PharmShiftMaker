const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {apiTarget, assertApiContract} = require('./api-contract.cjs');

test('reject credentials and mismatched SSR/browser build targets', () => {
  assert.throws(() => apiTarget('https://name:secret@example.invalid'));
  assert.throws(() => apiTarget('https://example.invalid?token=secret'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pharm-api-contract-'));
  try {
    fs.mkdirSync(path.join(root,'.build'));
    fs.writeFileSync(path.join(root,'.build','required-server-files.json'), JSON.stringify({config:{env:{NEXT_PUBLIC_API_BASE_URL:'https://127.0.0.1:18510'}}}));
    assert.doesNotThrow(() => assertApiContract(root,'.build','https://127.0.0.1:18510/'));
    assert.throws(() => assertApiContract(root,'.build',undefined));
    assert.throws(() => assertApiContract(root,'.build','https://localhost:8000'));
  } finally {fs.rmSync(root,{recursive:true});}
});
