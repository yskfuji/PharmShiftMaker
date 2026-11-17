import {newStaffProgress,type StaffRecords} from '../newStaffProgress';

const empty:StaffRecords={people:[],sites:[],employments:[],contracts:[],capabilities:[]};
const statuses=(records:StaffRecords,id:string)=>Object.fromEntries(newStaffProgress(records,id).map(s=>[s.step,s.status]));

test('with nothing registered only the name and the site can be started', () => {
 expect(statuses(empty,'')).toEqual({person:'todo',site:'todo',employment:'blocked',contract:'blocked',capability:'blocked',reflect:'elsewhere'});
});

test('an unknown person id counts as not registered', () => {
 expect(statuses({...empty,people:[{person_id:'p1',name:'合成職員'}]},'other').person).toBe('todo');
});

test('employment waits for a site, contract waits for this person\'s employment', () => {
 const named={...empty,people:[{person_id:'p1',name:'合成職員'}]};
 expect(statuses(named,'p1')).toMatchObject({person:'done',site:'todo',employment:'blocked',contract:'blocked',capability:'todo'});
 const sited={...named,sites:[{establishment_id:'s1'}],employments:[{person_id:'someone-else'}]};
 expect(statuses(sited,'p1')).toMatchObject({site:'done',employment:'todo',contract:'blocked'});
 expect(newStaffProgress(sited,'p1').find(s=>s.step==='contract')?.reason).toContain('雇用関係');
});

test('an existing contract counts as done even without a registered employment', () => {
 const legacy={...empty,people:[{person_id:'p1',name:'合成職員'}],contracts:[{person_id:'p1'}]};
 expect(statuses(legacy,'p1').contract).toBe('done');
});

test('every step is done once all records exist for the person', () => {
 const all:StaffRecords={people:[{person_id:'p1',name:'合成職員'}],sites:[{establishment_id:'s1'}],employments:[{person_id:'p1'}],contracts:[{person_id:'p1'}],capabilities:[{person_id:'p1'}]};
 expect(statuses(all,'p1')).toEqual({person:'done',site:'done',employment:'done',contract:'done',capability:'done',reflect:'elsewhere'});
});

test('steps are always in dependency order', () => {
 expect(newStaffProgress(empty,'').map(s=>s.step)).toEqual(['person','site','employment','contract','capability','reflect']);
});
