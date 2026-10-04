import { PlanningError } from '@/lib/planningTransport';
import { problemFrom } from '../api/errors';

test('each response kind becomes its own state, and a lost response is an unknown outcome', () => {
  expect(problemFrom(new PlanningError(409, '{"detail":"Publication version changed"}'))).toMatchObject({ kind: 'conflict', code: '409' });
  expect(problemFrom(new PlanningError(409, 'x')).body).toContain('入力した内容は保持しています');
  expect(problemFrom(new PlanningError(403, 'x')).kind).toBe('forbidden');
  expect(problemFrom(new PlanningError(422, '{"detail":"Schedule change no longer passes server validation"}'))).toMatchObject({ kind: 'validation', body: 'Schedule change no longer passes server validation' });
  expect(problemFrom(new PlanningError(401, 'x')).kind).toBe('unauthenticated');
  expect(problemFrom(new PlanningError(404, 'x')).kind).toBe('notFound');
  for (const error of [new PlanningError(503, 'down'), new TypeError('Failed to fetch')]) {
    const problem = problemFrom(error);
    expect(problem.kind).toBe('unknown');
    expect(problem.body).toContain('反映されたかは不明');
    expect(problem.title).not.toContain('失敗');
  }
});

test('a failed read offers a reload and never claims an unknown outcome or kept input', () => {
  for (const status of [403, 404, 409, 423, 503]) {
    const problem = problemFrom(new PlanningError(status, 'x'), 'read');
    expect(problem.action).toBe('再読み込み');
    expect(problem.body).not.toContain('反映されたかは不明');
    expect(problem.body).not.toContain('入力した内容は保持');
  }
  expect(problemFrom(new TypeError('Failed to fetch'), 'read')).toMatchObject({ kind: 'unknown', code: 'NET', title: '読み込めませんでした' });
  expect(problemFrom(new PlanningError(401, 'x'), 'read').kind).toBe('unauthenticated');
});
