export const SCHOOL_EMAIL_DOMAINS = [
  "@e.ntu.edu.sg",
  "@ntu.edu.sg",
  "@u.nus.edu",
  "@scis.smu.edu.sg",
] as const

export const SCHOOL_EMAIL_ERROR_MESSAGE =
  "Please use your school email. This school email domain is not yet supported."

export function isSchoolEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase()

  return SCHOOL_EMAIL_DOMAINS.some((domain) => normalizedEmail.endsWith(domain))
}
