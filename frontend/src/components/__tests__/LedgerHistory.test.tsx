import {render,screen,fireEvent} from '@testing-library/react';
import LedgerHistory from '../LedgerHistory';
afterEach(()=>jest.restoreAllMocks());
test('historical quantities stay exact and current directory labels are explicitly distinguished',async()=>{
 global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({balances:[{account_id:'old-account-id',person_name:'田中 次郎',employer_name:'民間病院',granted_on:'2025-04-01',remaining_days:{numerator:7,denominator:2},reserved_days:{numerator:1,denominator:2}}],findings:[]})});
 render(<LedgerHistory scope="hospital/pharmacy"/>);
 fireEvent.click(screen.getByText('過去時点の年休台帳と訂正履歴を確認'));
 fireEvent.change(screen.getByLabelText('対象日'),{target:{value:'2025-06-01'}});
 fireEvent.change(screen.getByLabelText('記録の締切（日本時間）'),{target:{value:'2026-05-01T12:00'}});
 fireEvent.click(screen.getByRole('button',{name:'指定時点の台帳を照会'}));
 expect(await screen.findByText('田中 次郎 ／ 民間病院 ／ 付与日 2025-04-01')).toBeVisible();
 expect(screen.getByText('残高 7/2 日、予約 1/2 日')).toBeVisible();
 expect(screen.getByText(/氏名・雇用主名は現在の登録名/)).toBeVisible();
 expect(screen.getByText('付与ロット：old-account-id').closest('details')).not.toHaveAttribute('open');
});
