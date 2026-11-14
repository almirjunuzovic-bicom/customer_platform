/**
 * Bicom-internal customer ID convention embedded as a numeric suffix on a
 * SERVERware partition's `company` field - NOT a SERVERware concept, and
 * not perfectly uniform (space around the dash varies):
 *   "Delta365 Ltd-99999"                 -> "99999"
 *   "Connected Cloud Communications - 31219" -> "31219"
 *   "test"                                -> null (no real customer behind it)
 *
 * This is a SUGGESTED cross-cluster partner key, not an auto-trusted one -
 * see hst2171-architecture open question #1 (Pending Review principle).
 */
const CUSTOMER_ID_SUFFIX = /-\s*(\d+)\s*$/;

export function parseCustomerId(company: string | null | undefined): string | null {
  if (!company) return null;
  const match = CUSTOMER_ID_SUFFIX.exec(company);
  return match ? match[1] : null;
}
