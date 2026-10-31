import {dutyInterval, requestStatusLabel, shiftLabel} from '../live/format';

test('pending and discussion are not presented as approved or published', () => {
  expect(requestStatusLabel('PENDING')).toBe('確認待ち');
  expect(requestStatusLabel('REQUIRES_DISCUSSION')).toBe('相談・確認中');
  expect(requestStatusLabel('UNRECOGNIZED')).toBe('状態を確認してください（UNRECOGNIZED）');
  expect(shiftLabel('unmapped')).toBe('unmapped');
});

test('cross-year duties keep both calendar dates and the timezone', () => {
  const value=dutyInterval('2026-12-31T23:00:00+09:00','2027-01-01T08:00:00+09:00');
  expect(value).toContain('2026/12/31'); expect(value).toContain('2027/1/1');
  expect(value).toContain('23:00'); expect(value).toContain('08:00'); expect(value).toContain('日本時間');
  expect(dutyInterval('invalid','invalid')).toBe('日時を確認できません');
});


test.each(['constructor', '__proto__', 'toString'])('unknown inherited key %s remains a string', code => {
  expect(shiftLabel(code)).toBe(code);
  expect(requestStatusLabel(code)).toBe(`状態を確認してください（${code}）`);
});
