import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import CopyManagement from '../CopyManagement';
jest.mock('../ExternalCopyForm',()=>({__esModule:true,default:()=>null}));
jest.mock('../SharedPreservationReview',()=>({__esModule:true,default:()=>null}));
const response=(body:unknown,status=200)=>({ok:status===200,status,json:async()=>body} as Response);
test('hold update 409 requires three-way review and retains proposed reason',async()=>{
 Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('hold-key')});
 let holds=[{hold_id:'hold1',person_id:'p1',revision:1,active:true,payload:{reason:'当初の理由'}}];const posts:any[]=[];
 global.fetch=jest.fn(async(u:any,o:any)=>{if(o?.method==='POST'){const body=JSON.parse(o.body);posts.push(body);if(posts.length===1){holds=[{...holds[0],revision:2,payload:{reason:'現在の理由'}}];return response({},409);}holds=[{...holds[0],revision:3,payload:{reason:body.payload.reason}}];return response({hold_id:'hold1',revision:3});}return response({people:[{person_id:'p1',name:'本人'}],holds});}) as any;
 render(<CopyManagement scope="hospital/pharmacy"/>);fireEvent.click(screen.getByText('コピーの残存・消去予約と法的保全'));await screen.findByRole('option',{name:/p1：保全中/});fireEvent.change(screen.getByLabelText('対象の保全記録'),{target:{value:'hold1'}});fireEvent.change(screen.getByLabelText('判断理由'),{target:{value:'編集中の理由'}});fireEvent.click(screen.getByRole('button',{name:'保全判断を記録'}));await screen.findByText('保全判断の更新競合');expect(screen.getByRole('button',{name:'保全判断を記録'})).toBeDisabled();expect(screen.getByLabelText('判断理由')).toHaveValue('編集中の理由');fireEvent.click(screen.getByRole('button',{name:'三つの保全判断を確認して再送を許可'}));fireEvent.click(screen.getByRole('button',{name:'保全判断を記録'}));await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[1].expected_revision).toBe(2);expect(posts[1].payload.reason).toBe('編集中の理由');await screen.findByText('保全判断を記録しました（版 3）。');
 expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('/copies/context'),expect.anything());
});
