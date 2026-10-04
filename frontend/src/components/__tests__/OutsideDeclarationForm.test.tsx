import {render,screen,fireEvent,waitFor,within,cleanup} from '@testing-library/react';
import OutsideDeclarationForm from '../OutsideDeclarationForm';
const response=(body:unknown)=>({ok:true,status:200,json:async()=>body} as Response);
beforeEach(()=>{Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('generated-declaration')});});
test('self declaration uses permitted candidates and generated ID; response loss preserves key and seconds',async()=>{
 const ctx={employers:[{employer_id:'e1',name:'他社法人'}],establishments:[{establishment_id:'s1',employer_id:'e1',name:'他社事業場'}],declarations:[] as any[]},requests:any[]=[];
 global.fetch=jest.fn(async(u:any,o:any)=>{if(o?.method==='POST'){const b=JSON.parse(o.body);requests.push(b);if(requests.length===1)throw new TypeError('lost response');ctx.declarations=[{entity_id:b.payload.declaration_id,kind:'outside_declaration',revision:1,payload:b.payload}];return response({revision:1,status:'SUBMITTED'});}expect(u).toContain('/declaration-context?');return response(ctx);}) as any;
 render(<OutsideDeclarationForm scope="hospital/pharmacy" personId="self"/>);
 await screen.findByLabelText('他の雇用主・活動先');expect(screen.queryByLabelText(/申告ID/)).not.toBeInTheDocument();
 for(const [label,value] of [['他の雇用主・活動先','e1'],['申告する事業場','s1'],['適用開始（日本時間）','2026-09-01T00:00:01'],['適用終了（日本時間）','2026-10-01T00:00:02'],['所定労働の開始 1','2026-09-02T09:00:03'],['所定労働の終了 1','2026-09-02T10:00:04'],['契約・所定時間・所定外時間の照合資料','自己申告原本']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole('button',{name:'申告・訂正を記録'}));await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'申告・訂正を記録'}));await waitFor(()=>expect(requests).toHaveLength(2));expect(requests[0]).toEqual(requests[1]);expect(requests[0].payload).toMatchObject({declaration_id:'generated-declaration',person_id:'self',employer_id:'e1',establishment_id:'s1',start:'2026-08-31T15:00:01.000Z',scheduled_work:[{start:'2026-09-02T00:00:03.000Z',end:'2026-09-02T01:00:04.000Z'}]});
 await screen.findByText('申告を記録しました（版 1、照合待ち）。');
});

test('administrator review inputs participate in unsaved navigation protection',async()=>{
 const {hasUnsavedChanges}=await import('../useUnsavedNavigation');
 const payload={declaration_id:'d1',person_id:'self',employer_id:'e1',establishment_id:'s1',contract_order:1,activity:'employment',start:'2026-01-01T00:00:00Z',end:'2027-01-01T00:00:00Z',reference:'原本',status:'SUBMITTED',work_report_complete:false,scheduled_work:[],additional_work:[],review_evidence:null};
 global.fetch=jest.fn(async()=>response({employers:[{employer_id:'e1',name:'雇用主'}],establishments:[{establishment_id:'s1',employer_id:'e1'}],declarations:[{entity_id:'d1',revision:1,payload}]})) as any;
 render(<OutsideDeclarationForm scope="hospital/pharmacy" personId="self" admin/>);fireEvent.change(await screen.findByLabelText('訂正・取下げする申告'),{target:{value:'d1'}});fireEvent.change(screen.getByLabelText('照合根拠'),{target:{value:'未保存の照合内容'}});expect(hasUnsavedChanges()).toBe(true);
});

test('datetime full-value display keeps seconds and resets when edits are discarded',async()=>{
 const payload={declaration_id:'d1',person_id:'self',employer_id:'e1',establishment_id:'s1',contract_order:1,activity:'employment',start:'2026-01-01T00:00:03+09:00',end:'2027-01-01T00:00:04+09:00',reference:'原本',status:'SUBMITTED',work_report_complete:false,scheduled_work:[{start:'2026-01-06T09:00:05+09:00',end:'2026-01-06T12:00:06+09:00'}],additional_work:[],review_evidence:null};
 global.fetch=jest.fn(async()=>response({employers:[{employer_id:'e1',name:'雇用主'}],establishments:[{establishment_id:'s1',employer_id:'e1'}],declarations:[{entity_id:'d1',revision:1,payload}]})) as any;
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(true);
 render(<OutsideDeclarationForm scope="hospital/pharmacy" personId="self"/>);fireEvent.change(await screen.findByLabelText('訂正・取下げする申告'),{target:{value:'d1'}});
 expect(screen.getByText('現在値：2026-01-06 09:00:05（日本時間）')).toBeVisible();
 expect(screen.getByLabelText('所定労働の開始 1')).toHaveClass('w-full','min-w-0','max-w-full');
 fireEvent.change(screen.getByLabelText('所定労働の開始 1'),{target:{value:'2026-01-06T10:00:17'}});
 expect(screen.getByText('現在値：2026-01-06 10:00:17（日本時間）')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'未保存の編集を破棄'}));
 expect(screen.getByLabelText('所定労働の開始 1')).toHaveValue('2026-01-06T09:00:05.000');
 expect(screen.getByText('現在値：2026-01-06 09:00:05（日本時間）')).toBeVisible();confirm.mockRestore();
});

test('reconciliation summary groups declared hours by Japan-time week and month',async()=>{
 const {summarize}=await import('../OutsideDeclarationForm');
 // Sunday 2026-03-01 23:00 JST is still the week of Monday 2026-02-23; the next piece is in March's second week.
 const result=summarize([{start:'2026-03-01T14:00:00Z',end:'2026-03-01T15:00:00Z'},{start:'2026-03-02T00:00:00Z',end:'2026-03-02T02:30:00Z'}]);
 expect(result.weeks).toEqual([['2026-02-23',3600],['2026-03-02',9000]]);
 expect(result.months).toEqual([['2026-03',12600]]);
});

test('administrator sees the declared hours, contract order and review basis before deciding',async()=>{
 const payload={declaration_id:'d1',person_id:'self',employer_id:'e1',establishment_id:'s1',contract_order:null,activity:'employment',start:'2026-01-01T00:00:00+09:00',end:'2027-01-01T00:00:00+09:00',reference:'原本',status:'SUBMITTED',work_report_complete:false,scheduled_work:[{start:'2026-01-05T09:00:00+09:00',end:'2026-01-05T13:00:00+09:00'}],additional_work:[],review_evidence:null};
 global.fetch=jest.fn(async()=>response({employers:[{employer_id:'e1',name:'雇用主'}],establishments:[{establishment_id:'s1',employer_id:'e1'}],declarations:[{entity_id:'d1',revision:1,payload}]})) as any;
 render(<OutsideDeclarationForm scope="hospital/pharmacy" personId="self" admin/>);
 fireEvent.change(await screen.findByLabelText('訂正・取下げする申告'),{target:{value:'d1'}});
 const summary=screen.getByRole('region',{name:'他社勤務の照合用集計'});
 expect(summary).toHaveTextContent('契約締結順：未記載');expect(summary).toHaveTextContent('2026-01-05');expect(summary).toHaveTextContent('4時間0分');
 expect(screen.getByLabelText('照合の有効期限（空欄なら期限なし）')).toBeInTheDocument();
});

const reviewed={declaration_id:'d1',person_id:'self',employer_id:'e1',establishment_id:'s1',contract_order:1,activity:'employment',start:'2026-01-01T00:00:00+09:00',end:'2027-01-01T00:00:00+09:00',reference:'原本',status:'REVIEWED',work_report_complete:true,scheduled_work:[],additional_work:[],other_holiday_work:[{start:'2026-01-11T09:00:00+09:00',end:'2026-01-11T13:00:00+09:00'}],review_evidence:{reference:'r',status:'verified',verified_by:'admin',valid_until:null}};
function serve(requests:any[]){global.fetch=jest.fn(async(_u:any,o:any)=>{if(o?.method==='POST'){requests.push(JSON.parse(o.body));return response({revision:2,status:'SUBMITTED'});}return response({employers:[{employer_id:'e1',name:'雇用主'}],establishments:[{establishment_id:'s1',employer_id:'e1'}],declarations:[{entity_id:'d1',revision:1,payload:reviewed}]});}) as any;}

test('a reviewed declaration can be neither changed nor withdrawn by the person',async()=>{
 const requests:any[]=[];serve(requests);
 render(<OutsideDeclarationForm scope="hospital/pharmacy" personId="self"/>);
 fireEvent.change(await screen.findByLabelText('訂正・取下げする申告'),{target:{value:'d1'}});
 expect(screen.queryByRole('button',{name:'この申告を取り下げる'})).toBeNull();
 expect(screen.getByRole('button',{name:'申告・訂正を記録'})).toBeDisabled();
 expect(screen.getByText(/照合済みの申告は本人では変更・取り下げできません/)).toBeInTheDocument();
});

test('other-employer holiday work is its own field and appears in the review summary',async()=>{
 const requests:any[]=[];serve(requests);
 render(<OutsideDeclarationForm scope="hospital/pharmacy" personId="self"/>);
 fireEvent.change(await screen.findByLabelText('他の雇用主・活動先'),{target:{value:'e1'}});
 fireEvent.change(screen.getByLabelText('申告する事業場'),{target:{value:'s1'}});
 fireEvent.change(screen.getByLabelText('適用開始（日本時間）'),{target:{value:'2026-01-01T00:00:00'}});
 fireEvent.change(screen.getByLabelText('適用終了（日本時間）'),{target:{value:'2027-01-01T00:00:00'}});
 fireEvent.change(screen.getByLabelText('他社の法定休日の労働の開始 1'),{target:{value:'2026-01-11T09:00:00'}});
 fireEvent.change(screen.getByLabelText('他社の法定休日の労働の終了 1'),{target:{value:'2026-01-11T13:00:00'}});
 fireEvent.change(screen.getByLabelText('契約・所定時間・所定外時間の照合資料'),{target:{value:'原本'}});
 fireEvent.click(screen.getByRole('button',{name:'申告・訂正を記録'}));
 await waitFor(()=>expect(requests).toHaveLength(1));
 expect(requests[0].payload.other_holiday_work).toEqual([{start:'2026-01-11T00:00:00.000Z',end:'2026-01-11T04:00:00.000Z'}]);
 expect(requests[0].payload.status).toBe('SUBMITTED');
 cleanup();
 render(<OutsideDeclarationForm scope="hospital/pharmacy" personId="admin" admin/>);
 fireEvent.change(await screen.findByLabelText('訂正・取下げする申告'),{target:{value:'d1'}});
 const summary=screen.getByRole('region',{name:'他社勤務の照合用集計'});
 expect(within(summary).getByRole('table',{name:'うち他社の法定休日の労働・月別'})).toHaveTextContent('4時間0分');
 expect(within(summary).getByRole('table',{name:'所定外・月別'})).toHaveTextContent('4時間0分');
});
