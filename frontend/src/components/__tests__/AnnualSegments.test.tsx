import {useState} from 'react';
import {act,fireEvent,render,screen} from '@testing-library/react';
import AnnualSegments,{type AnnualSegment,segmentErrors} from '../AnnualSegments';
const original:AnnualSegment={start:'2026-05-01',end:'2026-06-01',working_days:20,total_seconds:576001,fixed_on:'2026-04-01',consent:{reference:'原本 / 付属資料',status:'rejected',verified_by:'担当者',valid_until:'2026-05-31T12:34:56+09:00'}};
function Form(){const [value,setValue]=useState([original,{...original,start:'2026-06-01',end:'2026-07-01'}]);return <><AnnualSegments value={value} onChange={setValue}/><output data-testid="payload">{JSON.stringify(value)}</output></>;}
test('batched field edits retain each other and deleting another segment preserves the edited evidence',()=>{
 render(<Form/>);
 act(()=>{
  fireEvent.change(screen.getByLabelText('区分期間2の資料名・参照先'),{target:{value:'新  原本 / 追加'}});
  fireEvent.change(screen.getByLabelText('区分期間2の有効期限（時差付き・任意）'),{target:{value:'2026-06-30T23:59:59+09:00'}});
  fireEvent.change(screen.getByLabelText('区分期間2の総労働時間（秒）'),{target:{value:'576007'}});
 });
 fireEvent.click(screen.getByRole('button',{name:'区分期間1を削除'}));
 expect(JSON.parse(screen.getByTestId('payload').textContent!)).toEqual([{...original,start:'2026-06-01',end:'2026-07-01',total_seconds:576007,consent:{...original.consent,reference:'新  原本 / 追加',valid_until:'2026-06-30T23:59:59+09:00'}}]);
});
test.each([NaN,-1,1.5,Number.MAX_SAFE_INTEGER+1])('invalid integer time %s is rejected',total_seconds=>{expect(segmentErrors([{...original,total_seconds}])).not.toEqual([]);});
test('leap date is accepted but normalized invalid calendar date is rejected',()=>{
 expect(segmentErrors([{...original,start:'2028-02-29',end:'2028-03-01'}])).toEqual([]);
 expect(segmentErrors([{...original,start:'2027-02-29'}])).not.toEqual([]);
});
