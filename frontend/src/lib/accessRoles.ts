/** Self-service permission is independent of a person's occupation or qualifications. */
export function isSelfServiceRole(role: string): role is "STAFF" | "PHARMACIST" {
  return role === "STAFF" || role === "PHARMACIST";
}
