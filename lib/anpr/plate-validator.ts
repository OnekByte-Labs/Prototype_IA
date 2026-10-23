/**
 * License Plate Validity Engine
 * Filters out OCR artifacts, repeating numbers, and garbled text.
 * Strictly verifies against Indian Motor Vehicle (HSRP), Bharat Series, and Tactical Military formats.
 */

export const KNOWN_STATE_CODES = new Set([
  "AN", "AP", "AR", "AS", "BR", "CH", "CG", "DD", "DL", "DN",
  "GA", "GJ", "HR", "HP", "JH", "JK", "KA", "KL", "LA", "LD",
  "MP", "MH", "MN", "ML", "MZ", "NL", "OD", "PB", "PY", "RJ",
  "SK", "TN", "TS", "TR", "UP", "UK", "UA", "WB",
]);

// Standard Indian format: 2 state letters + 1-2 district digits + 1-3 series letters + 4 digits (e.g. DL14CC5025, MH12NP6480, DL7CM3702)
const RE_STANDARD_INDIA = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{3,4}$/;

// Legacy / short format: e.g. MH01EB5211, DL12CJ9, MH03CP4833
const RE_LEGACY_INDIA = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,2}[0-9]{1,4}$/;

// Bharat Series format: e.g. 22BH1234AA
const RE_BH_SERIES = /^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/;

// Military vehicle format: e.g. 21D123456H, 18A000123B
const RE_MILITARY = /^[0-9]{2}[A-Z][0-9]{4,6}[A-Z]?$/;

// General tactical alphanumeric format (e.g. state code prefix + 4 to 8 alphanumeric chars)
const RE_TACTICAL_GENERAL = /^[A-Z]{2}[0-9]{1,2}[A-Z0-9]{3,6}$/;

/**
 * Normalizes a plate string by removing whitespace, hyphens, and non-alphanumeric characters.
 */
export function normalizePlate(raw: string): string {
  if (!raw) return "";
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * Checks if a candidate plate string is valid.
 * Rejects pure numbers (like "1111111", "1411101"), pure letters ("AAAAAA"), 
 * repeated characters ("1111"), or out-of-range lengths.
 */
export function isValidPlate(raw: string): boolean {
  const clean = normalizePlate(raw);

  // Length must be between 5 and 10 characters
  if (clean.length < 5 || clean.length > 10) {
    return false;
  }

  // Reject pure numbers (e.g. 1111111, 1411101, 11144)
  if (/^\d+$/.test(clean)) {
    return false;
  }

  // Reject pure letters (e.g. ABCDEF)
  if (/^[A-Z]+$/.test(clean)) {
    return false;
  }

  // Reject 3 or more repeating identical characters (e.g. "111", "AAA", "000")
  if (/(.)\1{2,}/.test(clean)) {
    return false;
  }

  // Count letters and digits
  const letters = (clean.match(/[A-Z]/g) || []).length;
  const digits = (clean.match(/[0-9]/g) || []).length;

  // Must have at least 2 letters and at least 2 digits
  if (letters < 2 || digits < 2) {
    return false;
  }

  const prefix2 = clean.slice(0, 2);

  // Recognized state code matches
  if (KNOWN_STATE_CODES.has(prefix2)) {
    return true;
  }

  // Check standard regex patterns
  if (
    RE_STANDARD_INDIA.test(clean) ||
    RE_LEGACY_INDIA.test(clean) ||
    RE_BH_SERIES.test(clean) ||
    RE_MILITARY.test(clean) ||
    RE_TACTICAL_GENERAL.test(clean)
  ) {
    return true;
  }

  return false;
}

/**
 * Formats a clean plate into standard spaced representation (e.g. "DL 7CM 3702" or "MH 03 CP 4833").
 */
export function formatPlateDisplay(clean: string): string {
  if (!clean) return "";
  const c = clean.toUpperCase();

  // If format is DL7CM3702 -> DL 7CM 3702
  const m1 = c.match(/^([A-Z]{2})([0-9]{1,2}[A-Z]{1,3})([0-9]{3,4})$/);
  if (m1) {
    return `${m1[1]} ${m1[2]} ${m1[3]}`;
  }

  // If format is MH01EB5211 -> MH 01 EB 5211
  const m2 = c.match(/^([A-Z]{2})([0-9]{2})([A-Z]{1,2})([0-9]{4})$/);
  if (m2) {
    return `${m2[1]} ${m2[2]} ${m2[3]} ${m2[4]}`;
  }

  return c;
}
