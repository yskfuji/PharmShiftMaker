/** S03: browser security headers and XSS sinks (no browser, no network). */
import fs from 'fs';
import path from 'path';
import {render,screen,fireEvent} from '@testing-library/react';
import GrantAssessment from '../components/GrantAssessment';
const nextConfig=require('../../next.config.js')('phase-production-build');

test('every page is served with the configured security headers',async()=>{
 const rules=await nextConfig.headers();
 const all=rules.find((r:{source:string})=>r.source==='/:path*');
 const headers=Object.fromEntries(all.headers.map((h:{key:string;value:string})=>[h.key,h.value]));
 expect(headers).toMatchObject({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store'});
 expect(headers['Content-Security-Policy']).toContain("frame-ancestors 'none'");
 expect(headers['Content-Security-Policy']).toContain("object-src 'none'");
 expect(nextConfig.poweredByHeader).toBe(false);
});

test('source code has no raw HTML or eval sinks',()=>{
 const root=path.join(__dirname,'..');
 const offenders:string[]=[];
 const walk=(dir:string)=>{for(const name of fs.readdirSync(dir)){const file=path.join(dir,name);
  if(fs.statSync(file).isDirectory()){if(name!=='__tests__')walk(file);continue;}
  if(!/\.(tsx?|jsx?)$/.test(name))continue;
  const text=fs.readFileSync(file,'utf8');
  if(/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\s*\(|new Function\s*\(/.test(text))offenders.push(path.relative(root,file));}};
 walk(root);
 expect(offenders).toEqual([]);
});

test('untrusted text from the API is rendered as text, never as markup',async()=>{
 const hostile='<img src=x onerror="window.__xss=1">';
 global.fetch=jest.fn(async()=>({ok:true,status:200,json:async()=>({input_hash:'h',source_revision:1,findings:[],
  accounts:[{account_id:hostile,person_id:'p',employer_id:'e',granted_on:'2026-04-01',statutory_days:3}]})} as Response)) as never;
 const {container}=render(<GrantAssessment scope="hospital/pharmacy"/>);
 fireEvent.click(screen.getByText('最新の付与原本を読み込む'));
 expect(await screen.findByText(new RegExp('onerror'))).toBeInTheDocument();
 expect(container.querySelector('img')).toBeNull();
 expect((window as unknown as {__xss?:number}).__xss).toBeUndefined();
});
