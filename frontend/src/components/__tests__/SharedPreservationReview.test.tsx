import {render,screen,fireEvent} from '@testing-library/react';
import SharedPreservationReview from '../SharedPreservationReview';
import {hasUnsavedChanges} from '../useUnsavedNavigation';
test('shared preservation justification participates in unsaved protection',async()=>{
 render(<SharedPreservationReview copyId="copy1" personId="p1" read={async()=>({copy_id:'copy1',revision:1,source_digest:'hash1',payload_hash:'hash2',person_ids:['p2'],payload:{archive_format:'partial',replayable:false,retained:{},removed_counts:{people:1}}})} save={async()=>({})} onChanged={()=>{}}/>);fireEvent.click(screen.getByText('共有記録を再構成して他の職員の履歴を保全'));fireEvent.click(screen.getByRole('button',{name:'保全する内容を読み込む'}));fireEvent.change(await screen.findByLabelText('保全・消去判断の根拠'),{target:{value:'未保存の確認根拠'}});expect(hasUnsavedChanges()).toBe(true);
});
