import { PlanningError } from '@/lib/planningTransport';
import { createMutator } from '../api/mutations';

let n = 0;
const next = () => `key-${++n}`;

test('an unknown outcome keeps the key, so resending the same change reuses it', async () => {
  const mutate = createMutator('u1', next);
  const keys: string[] = [];
  await expect(mutate('consent', { v: 1 }, async (key) => { keys.push(key); throw new TypeError('Failed to fetch'); })).rejects.toThrow();
  await expect(mutate('consent', { v: 1 }, async (key) => { keys.push(key); throw new PlanningError(503, 'down'); })).rejects.toThrow();
  await mutate('consent', { v: 1 }, async (key) => { keys.push(key); return 'ok'; });
  expect(new Set(keys).size).toBe(1);
});

test('a definite answer ends the attempt, and changed contents are a new change', async () => {
  const mutate = createMutator('u1', next);
  const keys: string[] = [];
  await expect(mutate('consent', { v: 1 }, async (key) => { keys.push(key); throw new PlanningError(409, 'changed'); })).rejects.toThrow();
  await mutate('consent', { v: 1 }, async (key) => { keys.push(key); return 'ok'; });
  await mutate('consent', { v: 1 }, async (key) => { keys.push(key); return 'ok'; });
  await mutate('consent', { v: 2 }, async (key) => { keys.push(key); return 'ok'; });
  expect(new Set(keys).size).toBe(4);
});

test('a timeout or a rate limit keeps the key; a lock is a definite refusal', async () => {
  const mutate = createMutator('u1', next);
  const keys: string[] = [];
  for (const status of [408, 429]) {
    await expect(mutate('approve', { v: 1 }, async (key) => { keys.push(key); throw new PlanningError(status, 'x'); })).rejects.toThrow();
  }
  await expect(mutate('approve', { v: 1 }, async (key) => { keys.push(key); throw new PlanningError(423, 'locked'); })).rejects.toThrow();
  await mutate('approve', { v: 1 }, async (key) => { keys.push(key); return 'ok'; });
  expect(new Set(keys.slice(0, 3)).size).toBe(1);
  expect(keys[3]).not.toBe(keys[2]);
});

test('each account has its own keys', async () => {
  const keys: string[] = [];
  for (const owner of ['u1', 'u2']) {
    const mutate = createMutator(owner, next);
    await expect(mutate('consent', { v: 1 }, async (key) => { keys.push(key); throw new TypeError('lost'); })).rejects.toThrow();
  }
  expect(new Set(keys).size).toBe(2);
});
