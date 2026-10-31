import {fireEvent, render, screen} from '@testing-library/react';
import NameRevisionFields from '@/features/workspace/people/NameRevisionFields';

it('keeps initial registration optional without inferring a registry status', () => {
  const change = jest.fn();
  render(<NameRevisionFields value={{name:'試験職員',occupation:'CLERK'}} onChange={change}/>);
  expect(screen.getByLabelText('適用開始日（任意）')).not.toBeRequired();
  expect(screen.getByLabelText('薬剤師名簿の確認状況')).toHaveValue('not_required');
  expect(change).not.toHaveBeenCalled();
});

it('requires an effective date for official changes and preserves distinct name inputs', () => {
  const change = jest.fn();
  render(<NameRevisionFields value={{name_change_category:'surname_change',legal_name:'試験 新姓',former_names:['試験 旧姓']}} onChange={change}/>);
  expect(screen.getByLabelText('適用開始日（必須）')).toBeRequired();
  expect(screen.getByLabelText('戸籍・薬剤師名簿上の正式氏名（任意）')).toHaveValue('試験 新姓');
  fireEvent.change(screen.getByLabelText('旧姓・旧氏名（読点区切り・任意）'), {target:{value:'試験 旧姓、別の旧姓'}});
  expect(change).toHaveBeenLastCalledWith({former_names:['試験 旧姓','別の旧姓']});
});

it('does not modify occupation or permission when recording a name-change reason', () => {
  const change = jest.fn();
  render(<NameRevisionFields value={{occupation:'CLERK'}} onChange={change}/>);
  fireEvent.change(screen.getByLabelText('氏名改定の事由区分'), {target:{value:'clerical_correction'}});
  expect(change).toHaveBeenLastCalledWith({name_change_category:'clerical_correction'});
});
