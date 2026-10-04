import LoginPage from './page';

describe('login recovery',()=>{
  it('opens the reviewed planning workspace by default',async()=>{
    const page=await LoginPage({});
    expect(page.props.redirectPath).toBe('/planning');
  });
  // Tabs and line breaks are dropped by URL parsing, so "/\t/host" would become "//host".
  it.each(['https://outside.example/','//outside.example/','/\\outside.example/','/\t/outside.example/','/\n/outside.example/','/\r//outside.example/',['/planning','//outside.example/']])('rejects external destination %s',async(redirectTo)=>{
    const page=await LoginPage({searchParams:Promise.resolve({redirectTo})});
    expect(page.props.redirectPath).toBe('/planning');
  });
  it('offers login again even when a previous session cookie may be stale',async()=>{
    const page=await LoginPage({searchParams:Promise.resolve({redirectTo:'/planning'})});
    expect(page.type).toBeDefined();
    expect(page.props.redirectPath).toBe('/planning');
  });
  it('explains why the previous session ended',async()=>{
    const page=await LoginPage({searchParams:Promise.resolve({reason:'idle'})});
    expect(page.props.notice).toBe('操作がなかったため、サインアウトしました。');
    for(const reason of ['<script>','__proto__','constructor']){
      const unknown=await LoginPage({searchParams:Promise.resolve({reason})});
      expect(unknown.props.notice).toBeUndefined();
    }
  });
});
