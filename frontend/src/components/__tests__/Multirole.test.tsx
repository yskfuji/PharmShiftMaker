import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import OccupationField from '@/features/workspace/people/OccupationField';
import StaffContextCard from '@/features/workspace/people/StaffContextCard';
import {isSelfServiceRole} from '@/lib/accessRoles';
import {WORKSPACE_NAV} from '@/features/workspace/generated/usecaseRoutes';

it('keeps permissions independent of occupation',()=>{
 expect(isSelfServiceRole('STAFF')).toBe(true);
 expect(isSelfServiceRole('PHARMACIST')).toBe(true);
 expect(isSelfServiceRole('LEADER')).toBe(false);
 expect(isSelfServiceRole('CLERK')).toBe(false);
 expect(WORKSPACE_NAV.STAFF).toEqual(WORKSPACE_NAV.PHARMACIST);
 expect(WORKSPACE_NAV.STAFF).not.toContain('people');
});
it('does not infer an occupation; separates clerical work from assistance',()=>{
 const onChange=jest.fn();render(<OccupationField value={null} onChange={onChange}/>);
 const field=screen.getByRole('combobox',{name:'職種'});
 expect(field).toHaveValue('');
 fireEvent.change(field,{target:{value:'CLERK'}});expect(onChange).toHaveBeenCalledWith('CLERK');
 expect(screen.getByRole('option',{name:'調剤補佐'})).toBeInTheDocument();
});
it('shows a clerical leader without calling them a pharmacist',async()=>{
 global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({person_id:'clerk',permission:'LEADER',occupation:'CLERK',occupation_status:'recorded'})});
 render(<StaffContextCard scopeId="hospital/pharmacy"/>);
 await waitFor(()=>expect(screen.getByText('調剤事務')).toBeInTheDocument());
 expect(screen.getByText('責任者')).toBeInTheDocument();
});
it('keeps failed acquisition unknown and offers retry',async()=>{
 global.fetch=jest.fn().mockResolvedValue({ok:false,status:503});
 render(<StaffContextCard scopeId="hospital/pharmacy"/>);
 await screen.findByRole('button',{name:'再取得する'});
 expect(screen.queryByText('調剤事務')).not.toBeInTheDocument();
});

it('distinguishes restriction from a connection failure without inventing a role',async()=>{
 global.fetch=jest.fn().mockResolvedValue({ok:false,status:423});
 render(<StaffContextCard scopeId="hospital/pharmacy"/>);
 await screen.findByText('利用制限中のため、職種・権限を表示できません。管理者に制限状態を確認し、対応後に再取得してください。');
 expect(screen.queryByText('調剤事務')).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'再取得する'})).toBeEnabled();
});
