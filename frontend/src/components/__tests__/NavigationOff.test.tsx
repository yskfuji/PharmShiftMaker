import { render, screen, within } from '@testing-library/react';
import AppLayout from '@/components/layout/AppLayout';
import GlobalNavigation from '@/components/GlobalNavigation';
import LoginPage from '@/app/login/page';

// Characterisation of the production entry while the ideal UI flag is off: the
// primary navigation, its markup and the landing page after sign-in must stay exactly
// as they are now, whatever non-"1" value IDEAL_UI holds.
jest.mock('@/components/IdentityProvider', () => ({ IdentityDisplay: () => <span>合成 花子</span> }));

const HREFS = ['/dashboard', '/planning', '/planning/workflows', '/settings'];
const saved = process.env.IDEAL_UI;
afterEach(() => { if (saved === undefined) delete process.env.IDEAL_UI; else process.env.IDEAL_UI = saved; });

describe.each([undefined, '0', 'true', ''])('IDEAL_UI=%p (off)', (value) => {
  beforeEach(() => { if (value === undefined) delete process.env.IDEAL_UI; else process.env.IDEAL_UI = value; });

  test('the sidebar and the compact navigation keep the four destinations and their markup', () => {
    const { container } = render(<AppLayout currentPath="/planning"><p>本文</p></AppLayout>);
    const navs = screen.getAllByRole('navigation', { name: '主な画面' });
    expect(navs).toHaveLength(2);
    for (const nav of navs) expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(HREFS);
    expect(container.querySelector('aside nav')?.outerHTML).toMatchSnapshot('sidebar');
    const { container: compact } = render(<GlobalNavigation current="/planning/workflows/leave" />);
    expect(compact.innerHTML).toMatchSnapshot('compact');
  });

  test('sign-in lands on /planning', async () => {
    expect((await LoginPage({})).props.redirectPath).toBe('/planning');
  });
});
