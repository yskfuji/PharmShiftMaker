import {departmentRoleLabel} from '@/lib/departmentRole';
import {obligationStatusLabel} from '@/lib/leaveDisplay';
import {parseIdentity} from '@/lib/identity';
test('department membership is neither the account name nor the self relation',()=>{
 expect(departmentRoleLabel('LEADER')).toBe('部署責任者');
 expect(departmentRoleLabel('STAFF')).toBe('部署職員');
 expect(departmentRoleLabel('DEVELOPER')).toBe('部署権限は未確認');
});
test('an unknown leave status never becomes a forecast or legal conclusion',()=>{
 expect(obligationStatusLabel('at_risk')).toBe('期限前・取得不足の見込み');
 expect(obligationStatusLabel('overdue')).toBe('期限経過後の未達');
 expect(obligationStatusLabel('fulfilled')).toBe('取得実績で充足');
 expect(obligationStatusLabel('future-status')).toBe('未対応の取得義務状態・確認が必要');
});
test('unknown identity contract is rejected instead of normalized into a role',()=>{
 expect(()=>parseIdentity({user_id:'x',display_name:null,global_role:'SUPERUSER',identifier_kind:'login_id'})).toThrow();
});
