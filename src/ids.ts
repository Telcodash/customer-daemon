/**
 * Prefixed ULIDs (`cus_01JD…`): globally unique across daemons, sortable by creation
 * time, and self-describing in logs. Other daemons store these as opaque references.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

export type IdPrefix = "cus";

export function ulid(timeMs = Date.now(), random: () => number = Math.random): string {
  let time = "";
  let t = Math.floor(timeMs);

  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }

  let rand = "";
  for (let i = 0; i < 16; i++) rand += ALPHABET[Math.floor(random() * 32)];

  return time + rand;
}

export function newId(prefix: IdPrefix, timeMs?: number, random?: () => number): string {
  return `${prefix}_${ulid(timeMs, random)}`;
}

export const ID_PATTERN = /^cus_[0-9A-HJKMNP-TV-Z]{26}$/;
