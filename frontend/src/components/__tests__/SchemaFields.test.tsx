import {useState} from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import SchemaFields, {Schema} from '@/components/SchemaFields';

it('does not require fields inside an unset optional evidence object',()=>{
 const root:Schema={anyOf:[{type:'object',properties:{reference:{type:'string'}},required:['reference']},{type:'null'}]};
 function Harness(){const [value,setValue]=useState<unknown>();return <form aria-label="test"><SchemaFields schema={root} root={root} value={value} onChange={setValue} name="evidence"/></form>;}
 render(<Harness/>);
 expect(screen.queryByLabelText('根拠資料の参照（必須）')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'確認根拠を設定'}));
 expect(screen.getByLabelText('根拠資料の参照（必須）')).toBeRequired();
 fireEvent.click(screen.getByRole('button',{name:'確認根拠を未設定に戻す'}));
 expect(screen.queryByLabelText('根拠資料の参照（必須）')).not.toBeInTheDocument();
});
