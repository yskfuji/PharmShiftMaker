import {act, render, waitFor} from '@testing-library/react';
import RouteFocus from '../RouteFocus';

let path='/first';
jest.mock('next/navigation',()=>({usePathname:()=>path}));

function page(title:string, heading:string, inert=false) {
  document.title=title;
  return <><main inert={inert ? true : undefined}><h1>{heading}</h1><button>画面内の操作</button></main><RouteFocus/></>;
}

beforeEach(()=>{path='/first';document.title='最初';});

test('waits for the new title, heading and non-inert content before focusing once',async()=>{
  const r=render(page('最初','最初の見出し'));
  expect(document.activeElement).toBe(document.body);

  path='/second';
  r.rerender(page('最初','最初の見出し'));
  expect(document.activeElement).toBe(document.body);

  r.rerender(page('次','次の見出し',true));
  expect(document.activeElement).toBe(document.body);

  r.rerender(page('次','次の見出し'));
  await waitFor(()=>expect(document.activeElement).toBe(document.querySelector('h1')));
  expect(document.querySelector('h1')).toHaveAttribute('tabindex','-1');
});

test('does not steal focus after the user moves elsewhere while the route is settling',async()=>{
  const r=render(page('最初','最初の見出し'));
  path='/second';
  r.rerender(page('最初','最初の見出し'));
  const control=document.querySelector('button')!;
  act(()=>control.focus());
  r.rerender(page('次','次の見出し'));
  await waitFor(()=>expect(document.title).toBe('次'));
  expect(document.activeElement).toBe(control);
});
