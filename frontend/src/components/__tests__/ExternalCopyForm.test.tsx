import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import ExternalCopyForm from '../ExternalCopyForm';
beforeEach(()=>{Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:jest.fn().mockReturnValue('generated-copy')});Object.defineProperty(global.crypto,'subtle',{configurable:true,value:{digest:jest.fn(async()=>new Uint8Array(32).fill(7).buffer)}});});
test('external copy submits local hash and selected subjects, never file contents',async()=>{
 const save=jest.fn(async(_path:string,_payload:unknown)=>({}));render(<ExternalCopyForm people={[{person_id:'p1',name:'本人一'},{person_id:'p2',name:'他人二'}]} save={save} onChanged={()=>{}}/>);fireEvent.click(screen.getByText('外部へ渡した出力物を登録'));
 const file=new File(['synthetic private contents'],'synthetic.csv',{type:'text/csv'});Object.defineProperty(file,'arrayBuffer',{value:async()=>new Uint8Array([1,2,3]).buffer});fireEvent.change(screen.getByLabelText('受け渡した原本ファイル'),{target:{files:[file]}});await waitFor(()=>expect(screen.getByRole('button',{name:'外部コピーを登録・再送'})).toBeEnabled());fireEvent.click(screen.getByLabelText('本人一'));
 for(const [label,value] of [['受渡し先・管理場所','給与担当の隔離保管'],['選んだ保存起算の日時（日本時間）','2026-09-01T09:00:07'],['人物一覧と受渡しの確認根拠','合成受渡し記録']])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 // JSDOM synthetic files do not populate the native file input value; browser validation is tested separately.
 fireEvent.submit(screen.getByRole('button',{name:'外部コピーを登録・再送'}).closest('form')!);await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));const [path,payload]=save.mock.calls[0];expect(path).toBe('/copies/register');expect(payload).toMatchObject({medium:'external',person_ids:['p1'],content_hash:'07'.repeat(32),subject_status:'UNVERIFIED',anchor_at:'2026-09-01T00:00:07.000Z'});expect(JSON.stringify(payload)).not.toContain('synthetic private contents');expect(JSON.stringify(payload)).not.toContain('p2');await screen.findByText(/外部コピーの来歴を登録しました/);
});

test('latest file selection wins when an older hash operation finishes later',async()=>{
 let completeA!:(value:ArrayBuffer)=>void,completeB!:(value:ArrayBuffer)=>void;
 const a=new File(['A'],'first.csv'),b=new File(['B'],'second.csv');Object.defineProperty(a,'arrayBuffer',{value:async()=>new Uint8Array([1]).buffer});Object.defineProperty(b,'arrayBuffer',{value:async()=>new Uint8Array([2]).buffer});
 Object.defineProperty(global.crypto,'subtle',{configurable:true,value:{digest:jest.fn((_name:string,bytes:ArrayBuffer)=>new Promise<ArrayBuffer>(resolve=>{if(new Uint8Array(bytes)[0]===1)completeA=resolve;else completeB=resolve;}))}});
 render(<ExternalCopyForm people={[]} save={async()=>({})} onChanged={()=>{}}/>);fireEvent.click(screen.getByText('外部へ渡した出力物を登録'));fireEvent.change(screen.getByLabelText('受け渡した原本ファイル'),{target:{files:[a]}});await waitFor(()=>expect(completeA).toBeDefined());fireEvent.change(screen.getByLabelText('受け渡した原本ファイル'),{target:{files:[b]}});await waitFor(()=>expect(completeB).toBeDefined());
 const {act}=await import('@testing-library/react');await act(async()=>completeB(new Uint8Array(32).fill(2).buffer));await screen.findByText('second.csv：'+'02'.repeat(32));await act(async()=>completeA(new Uint8Array(32).fill(1).buffer));expect(screen.getByText('second.csv：'+'02'.repeat(32))).toBeInTheDocument();
});
