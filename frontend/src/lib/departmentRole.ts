/** Department membership is distinct from the global account role and self relation. */
export type DepartmentRole = 'ADMIN' | 'LEADER' | 'STAFF' | 'PHARMACIST';
export function departmentRoleLabel(role: string | undefined): string {
  switch (role) {
    case 'ADMIN': return '部署管理者';
    case 'LEADER': return '部署責任者';
    case 'STAFF': case 'PHARMACIST': return '部署職員';
    default: return '部署権限は未確認';
  }
}
