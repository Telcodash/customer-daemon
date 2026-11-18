/**
 * UK postcode helpers. Format: outward code (area + district, e.g. "SW1A", "M14") + space +
 * inward code (sector digit + 2 unit letters, e.g. "5RG").
 */
const POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?) ?([0-9][ABD-HJLNP-UW-Z]{2})$/;

/** Uppercase and insert the single space Royal Mail uses ("m145rg" → "M14 5RG"). Null if invalid. */
export function normalizePostcode(input: string): string | null {
  const compact = input.toUpperCase().replace(/\s+/g, "");
  const match = POSTCODE.exec(compact);

  return match ? `${match[1]} ${match[2]}` : null;
}

/** True for a full postcode, or a partial one (outward code, e.g. "M14" or "SW1A 1") usable as a prefix search. */
export function looksLikePostcode(input: string): boolean {
  const compact = input.toUpperCase().replace(/\s+/g, "");

  return /^[A-Z]{1,2}[0-9][A-Z0-9]?([0-9]([A-Z]{1,2})?)?$/.test(compact) && /[0-9]/.test(compact);
}

/** Postcodes are stored and searched without spaces so "M14 5RG", "m145rg" and "M14  5RG" all match. */
export function compactPostcode(input: string): string {
  return input.toUpperCase().replace(/\s+/g, "");
}
