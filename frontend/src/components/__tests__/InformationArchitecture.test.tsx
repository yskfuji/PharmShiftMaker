import {fireEvent,render,screen} from '@testing-library/react';
import ContextLink from '../ContextLink';
import LeaveQuotaManager from '../LeaveQuotaManager';
import WorkflowNavigation from '../WorkflowNavigation';
import useUnsavedNavigation from '../useUnsavedNavigation';
import {GLOBAL_NAVIGATION,currentNavigation} from '@/lib/navigation';
const upsert=jest.fn(),remove=jest.fn();
let mockQuotaLoading=false;
let mockQuotaError:string|null=null;
jest.mock('@/hooks/useLeaveQuotas',()=>({__esModule:true,default:()=>({items:mockQuotaLoading||mockQuotaError?[]:[{personId:'p1',personName:'合成職員',kind:'PAID_LEAVE_REQUEST',totalDays:10,remainingDays:8,usedDays:2,usedBeforeMonth:1}],loading:mockQuotaLoading,error:mockQuotaError,refresh:jest.fn(),upsert,remove})}));
jest.mock('@/hooks/useStaffDirectory',()=>({__esModule:true,default:()=>({entries:[{personId:'p1',name:'合成職員'}],loading:false,error:null})}));
afterEach(()=>{jest.restoreAllMocks();mockQuotaLoading=false;mockQuotaError=null;});
test('four primary destinations; legacy URLs belong to compatibility management',()=>{
 expect(GLOBAL_NAVIGATION.map(i=>i.href)).toEqual(['/dashboard','/planning','/planning/workflows','/settings']);
 for(const url of ['/requests','/schedule','/schedule/2026/9'])expect(currentNavigation(url)?.href).toBe('/planning/workflows');
 expect(currentNavigation('/planning/workflows/leave')?.href).toBe('/planning/workflows');
 expect(currentNavigation('/planning')?.href).toBe('/planning');
});
test('read-only quotas expose neither mutations nor a create form',()=>{
 render(<LeaveQuotaManager initialYear={2026} initialMonth={9}/>);
 expect(screen.getByText('合成職員')).toBeVisible();
 expect(screen.getByRole('region',{name:'旧休暇枠の比較表'})).toHaveAttribute('tabindex','0');
 expect(screen.queryByRole('button',{name:'編集'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'削除'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'登録/更新'})).not.toBeInTheDocument();
 expect(upsert).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
});
test('editable quota month change cannot silently discard a draft',()=>{
 render(<LeaveQuotaManager initialYear={2026} initialMonth={9} canEdit/>);
 fireEvent.change(screen.getByLabelText('付与日数'),{target:{value:'7'}});
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
 fireEvent.click(screen.getByRole('button',{name:'翌月の旧休暇枠'}));
 expect(confirm).toHaveBeenCalled();expect(screen.getByText('2026年 9月')).toBeVisible();
 expect(screen.getByLabelText('付与日数')).toHaveValue(7);
});
test('workflow links use membership permissions',()=>{
 render(<WorkflowNavigation role="PHARMACIST" current="leave" scope="hospital/pharmacy"/>);
 expect(screen.queryByRole('link',{name:'契約・制度'})).not.toBeInTheDocument();
 expect(screen.queryByRole('link',{name:'復旧状況'})).not.toBeInTheDocument();
 expect(screen.getByRole('link',{name:'休暇'})).toHaveAttribute('aria-current','page');
});
test('section navigation retains edits; another document remains guarded',()=>{
 function Editor(){useUnsavedNavigation(true);return <><a href="#details">詳細</a><a href="/settings#details">別画面</a><div id="details">編集中</div></>;}
 render(<Editor/>);const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
 fireEvent.click(screen.getByRole('link',{name:'詳細'}));expect(confirm).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('link',{name:'別画面'}));expect(confirm).toHaveBeenCalledTimes(1);
});

test('context links preserve explicit destinations and never rewrite an external URL',()=>{
 window.history.replaceState(window.history.state,'','/?scope=hospital/ward&period=2026-02');
 render(<><ContextLink href="/planning">継承</ContextLink><ContextLink href="/planning/workflows/leave?scope=hospital/pharmacy">別部署</ContextLink><ContextLink href="https://example.org/settings">外部</ContextLink></>);
 expect(screen.getByRole('link',{name:'継承'})).toHaveAttribute('href','/planning?scope=hospital%2Fward&period=2026-02');
 expect(screen.getByRole('link',{name:'別部署'})).toHaveAttribute('href','/planning/workflows/leave?scope=hospital%2Fpharmacy&period=2026-02');
 expect(screen.getByRole('link',{name:'外部'})).toHaveAttribute('href','https://example.org/settings');
 window.history.replaceState(window.history.state,'','/');
});

test.each(['loading','error'])('unknown quota state is not represented as a known balance: %s',state=>{
 mockQuotaLoading=state==='loading';mockQuotaError=state==='error'?'接続できませんでした':null;
 render(<LeaveQuotaManager initialYear={2026} initialMonth={9}/>);
 expect(screen.getAllByText('未確認')).toHaveLength(3);
 expect(screen.queryByRole('region',{name:'旧休暇枠の比較表'})).not.toBeInTheDocument();
});

test('quota labels and comparison hints address their own instance without ID collisions',()=>{
 render(<><LeaveQuotaManager initialYear={2026} initialMonth={9} canEdit/><LeaveQuotaManager initialYear={2027} initialMonth={1} canEdit/></>);
 const years=screen.getAllByLabelText('対象年');
 expect(years).toHaveLength(2);expect(years[0]).toHaveValue('2026');expect(years[1]).toHaveValue('2027');
 const ids=Array.from(document.querySelectorAll('[id]')).map(el=>el.id);
 expect(new Set(ids).size).toBe(ids.length);
 for(const region of screen.getAllByRole('region',{name:'旧休暇枠の比較表'})){
  expect(document.getElementById(region.getAttribute('aria-describedby')!)).toHaveTextContent('横にスクロール');
 }
});
