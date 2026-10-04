import {errorText} from '../errorText';

test('an Error shows its message without the class prefix', () => {
 expect(errorText(new Error('区分期間1：有効期限'))).toBe('区分期間1：有効期限');
});

test('a FastAPI string detail replaces the raw JSON body and keeps the prefix', () => {
 expect(errorText(new Error('保存できませんでした（409）。{"detail":"版が古くなっています。"}'))).toBe('保存できませんでした（409）。版が古くなっています。');
 expect(errorText(new Error('{"detail":"Access denied"}'))).toBe('Access denied');
});

test('a validation list is summarised with its locations', () => {
 const body = JSON.stringify({detail: [{loc: ['body', 'payload', 'name'], msg: 'Field required'}, {loc: ['body', 'start'], msg: 'Invalid date'}]});
 expect(errorText(new Error('保存できませんでした（422）。' + body))).toBe('保存できませんでした（422）。入力内容を確認してください（2件）：payload / name：Field required、start：Invalid date');
});

test('a detail object with a message shows the message', () => {
 expect(errorText(new Error('422: {"detail":{"message":"取込の行に誤りがあります。","row_errors":[1]}}'))).toBe('422: 取込の行に誤りがあります。');
});

test('a lost connection is named in plain words', () => {
 expect(errorText(new TypeError('Failed to fetch'))).toBe('サーバーに接続できませんでした。通信を確認して、もう一度お試しください。');
 expect(errorText(new TypeError('Load failed'))).toContain('接続できませんでした');
});

test('other values and unparsable bodies are shown unchanged', () => {
 expect(errorText('文字列の誤り')).toBe('文字列の誤り');
 expect(errorText(new Error('本文 {壊れたJSON'))).toBe('本文 {壊れたJSON');
 expect(errorText(new Error('{"other":1}'))).toBe('{"other":1}');
 expect(errorText(42)).toBe('42');
});
