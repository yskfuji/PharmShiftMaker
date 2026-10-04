/**
 * @jest-environment node
 */
/** S03: per-request nonce CSP from the proxy (no browser; the E2E csp.spec.ts runs it in browsers). */
import { NextRequest } from 'next/server';
import { apiOrigin, contentSecurityPolicy, proxy } from '../proxy';

const directive=(policy:string,name:string)=>policy.split('; ').find(d=>d.split(' ')[0]===name)??'';
const nonceOf=(policy:string)=>/'nonce-([^']+)'/.exec(directive(policy,'script-src'))?.[1];

test('production scripts run only with the nonce; no inline or eval allowance',()=>{
 const policy=contentSecurityPolicy('abc',{dev:false,api:'https://api.example.test'});
 const script=directive(policy,'script-src');
 expect(script).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
 expect(script).not.toMatch(/unsafe-(inline|eval)/);
 expect(directive(policy,'style-src')).toBe("style-src 'self' 'nonce-abc'");
 expect(directive(policy,'style-src-attr')).toBe("style-src-attr 'unsafe-inline'");
 expect(directive(policy,'connect-src')).toBe("connect-src 'self' https://api.example.test");
 for(const d of ["object-src 'none'","base-uri 'none'","frame-ancestors 'none'","form-action 'self'","upgrade-insecure-requests"])
  expect(policy.split('; ')).toContain(d);
});

test('development adds eval for React debugging only',()=>{
 const policy=contentSecurityPolicy('abc',{dev:true,api:null});
 expect(directive(policy,'script-src')).toContain("'unsafe-eval'");
 expect(directive(policy,'connect-src')).toBe("connect-src 'self'");
 expect(policy).not.toContain('upgrade-insecure-requests');
});

test('the API origin is taken from an absolute base only',()=>{
 expect(apiOrigin('https://127.0.0.1:18510/v1')).toBe('https://127.0.0.1:18510');
 expect(apiOrigin('/api')).toBeNull();
 expect(apiOrigin(undefined)).toBeNull();
});

test('each page request gets a fresh nonce in both the request and the response policy',()=>{
 const first=proxy(new NextRequest('https://app.test/login'));
 const second=proxy(new NextRequest('https://app.test/login'));
 const a=first.headers.get('content-security-policy')!,b=second.headers.get('content-security-policy')!;
 expect(nonceOf(a)).toMatch(/^[A-Za-z0-9+/=]{40,}$/);
 expect(nonceOf(a)).not.toBe(nonceOf(b));
 // Next.js reads the nonce from the forwarded request headers while rendering.
 expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonceOf(a));
 expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(a);
});

test('protected pages still redirect to sign-in without the cookie; public pages do not',()=>{
 const redirected=proxy(new NextRequest('https://app.test/planning/compliance'));
 expect(redirected.status).toBe(307);
 expect(new URL(redirected.headers.get('location')!).pathname).toBe('/login');
 expect(proxy(new NextRequest('https://app.test/planningx')).status).toBe(200);
 const signedIn=new NextRequest('https://app.test/schedule',{headers:{cookie:'pharmshift_token=t'}});
 expect(proxy(signedIn).headers.get('content-security-policy')).toContain("'strict-dynamic'");
});

test('the sign-in page after a session ends clears this origin\'s storage',()=>{
 expect(proxy(new NextRequest('https://app.test/login?reason=idle')).headers.get('clear-site-data')).toBe('"storage"');
 expect(proxy(new NextRequest('https://app.test/login')).headers.get('clear-site-data')).toBeNull();
});
