import type { PublicationRead } from '../api/contracts';
import { resolveWorkspaceSelection } from '../api/workspaceSelection';

const publication = (month: string): PublicationRead => ({
  publication_id: `published-${month}`,
  version: 1,
  period: `${month}-01T00:00:00+09:00|${month}-28T00:00:00+09:00`,
  assignments: [],
});

// Expected Tokyo months are literal boundary cases, not derived with the production helper.
test.each([
  ['2026-10-31T14:59:59Z', '2026-10', '2026-10', true],
  ['2026-10-31T15:00:00Z', '2026-11', '2026-10', false],
  ['2026-12-31T14:59:59Z', '2026-12', '2026-12', true],
  ['2026-12-31T15:00:00Z', '2027-01', '2026-12', false],
])('default month at %s is %s; older publications are not an implicit fallback', (instant, expectedMonth, publishedMonth, available) => {
  const published = publication(publishedMonth);
  const result = resolveWorkspaceSelection([published], new Date(instant));
  expect(result.period).toBe(expectedMonth);
  expect(result.publication).toEqual(available ? published : null);
});

test.each(['2026-11-01T00:00:00Z', '2027-01-01T00:00:00Z'])('an explicit fixture month survives later execution on %s', (instant) => {
  const october = publication('2026-10');
  const november = publication('2026-11');
  expect(resolveWorkspaceSelection([november, october], new Date(instant), { period: '2026-10' }))
    .toMatchObject({ period: '2026-10', publication: october });
});
