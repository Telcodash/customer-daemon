import type { Database } from "bun:sqlite";
import { fakerEN_GB, type Faker } from "@faker-js/faker";
import { newId } from "./ids";
import { compactPostcode } from "./postcode";
import type { Address } from "./types";

/** Real post towns with their postcode area and district range, so addresses look plausible. */
const TOWNS: { town: string; county: string | null; area: string; districts: [number, number] }[] = [
  { town: "London", county: null, area: "SE", districts: [1, 28] },
  { town: "London", county: null, area: "N", districts: [1, 22] },
  { town: "London", county: null, area: "E", districts: [1, 18] },
  { town: "London", county: null, area: "SW", districts: [2, 20] },
  { town: "Manchester", county: "Greater Manchester", area: "M", districts: [1, 40] },
  { town: "Salford", county: "Greater Manchester", area: "M", districts: [3, 7] },
  { town: "Birmingham", county: "West Midlands", area: "B", districts: [1, 48] },
  { town: "Coventry", county: "West Midlands", area: "CV", districts: [1, 6] },
  { town: "Leeds", county: "West Yorkshire", area: "LS", districts: [1, 29] },
  { town: "Bradford", county: "West Yorkshire", area: "BD", districts: [1, 15] },
  { town: "Sheffield", county: "South Yorkshire", area: "S", districts: [1, 36] },
  { town: "York", county: "North Yorkshire", area: "YO", districts: [1, 32] },
  { town: "Liverpool", county: "Merseyside", area: "L", districts: [1, 38] },
  { town: "Newcastle upon Tyne", county: "Tyne and Wear", area: "NE", districts: [1, 15] },
  { town: "Nottingham", county: "Nottinghamshire", area: "NG", districts: [1, 17] },
  { town: "Leicester", county: "Leicestershire", area: "LE", districts: [1, 5] },
  { town: "Bristol", county: "Bristol", area: "BS", districts: [1, 16] },
  { town: "Bath", county: "Somerset", area: "BA", districts: [1, 2] },
  { town: "Exeter", county: "Devon", area: "EX", districts: [1, 4] },
  { town: "Plymouth", county: "Devon", area: "PL", districts: [1, 9] },
  { town: "Southampton", county: "Hampshire", area: "SO", districts: [14, 19] },
  { town: "Brighton", county: "East Sussex", area: "BN", districts: [1, 2] },
  { town: "Reading", county: "Berkshire", area: "RG", districts: [1, 6] },
  { town: "Oxford", county: "Oxfordshire", area: "OX", districts: [1, 4] },
  { town: "Cambridge", county: "Cambridgeshire", area: "CB", districts: [1, 5] },
  { town: "Norwich", county: "Norfolk", area: "NR", districts: [1, 7] },
  { town: "Ipswich", county: "Suffolk", area: "IP", districts: [1, 4] },
  { town: "Milton Keynes", county: "Buckinghamshire", area: "MK", districts: [1, 15] },
  { town: "Cardiff", county: "South Glamorgan", area: "CF", districts: [3, 24] },
  { town: "Swansea", county: "West Glamorgan", area: "SA", districts: [1, 7] },
  { town: "Edinburgh", county: "Midlothian", area: "EH", districts: [1, 17] },
  { town: "Glasgow", county: "Lanarkshire", area: "G", districts: [1, 53] },
  { town: "Aberdeen", county: "Aberdeenshire", area: "AB", districts: [10, 25] },
  { town: "Dundee", county: "Angus", area: "DD", districts: [1, 5] },
  { town: "Belfast", county: "County Antrim", area: "BT", districts: [1, 17] },
  { town: "Derby", county: "Derbyshire", area: "DE", districts: [1, 24] },
  { town: "Stoke-on-Trent", county: "Staffordshire", area: "ST", districts: [1, 6] },
  { town: "Hull", county: "East Yorkshire", area: "HU", districts: [1, 9] },
];

const STREETS = [
  "High Street", "Station Road", "Main Street", "Park Road", "Church Road", "Church Street", "London Road",
  "Victoria Road", "Green Lane", "Manor Road", "Church Lane", "Park Avenue", "The Avenue", "The Crescent",
  "Queens Road", "New Road", "Grange Road", "Kings Road", "Kingsway", "Windsor Road", "Highfield Road",
  "Mill Lane", "Alexander Road", "York Road", "St John's Road", "Main Road", "Broadway", "King Street",
  "The Green", "Springfield Road", "George Street", "Park Lane", "Victoria Street", "Albert Road",
  "Queensway", "New Street", "Queen Street", "West Street", "North Street", "Manchester Road",
  "The Drive", "Richmond Road", "Grove Road", "South Street", "School Lane", "The Grove", "Chester Road",
];

const BUILDING_NAMES = ["Rose Cottage", "The Old Rectory", "Orchard House", "Ivy Cottage", "The Coach House", "Millbrook"];

/** Unit letters valid in the inward code (excludes C, I, K, M, O, V). */
const UNIT_LETTERS = "ABDEFGHJLNPQRSTUWXYZ";

function postcode(f: Faker, area: string, [min, max]: [number, number]): string {
  const district = f.number.int({ min, max });
  const unit = f.helpers.arrayElement([...UNIT_LETTERS]) + f.helpers.arrayElement([...UNIT_LETTERS]);

  return `${area}${district} ${f.number.int({ min: 1, max: 9 })}${unit}`;
}

export function fakeAddress(f: Faker): Address {
  const place = f.helpers.arrayElement(TOWNS);
  const street = `${f.number.int({ min: 1, max: 240 })} ${f.helpers.arrayElement(STREETS)}`;
  const kind = f.helpers.weightedArrayElement([
    { weight: 70, value: "house" },
    { weight: 25, value: "flat" },
    { weight: 5, value: "named" },
  ] as const);

  const [line_1, line_2] =
    kind === "flat"
      ? [`Flat ${f.number.int({ min: 1, max: 40 })}`, street]
      : kind === "named"
        ? [f.helpers.arrayElement(BUILDING_NAMES), street.replace(/^\d+ /, "")]
        : [street, null];

  return { line_1, line_2, town: place.town, county: place.county, postcode: postcode(f, place.area, place.districts), country: "GB" };
}

/** Ofcom reserves 07700 900000–900999 for fiction, so dummy numbers can never reach a real person. */
function fakeMobile(f: Faker): string {
  return `07700 900${String(f.number.int({ min: 0, max: 999 })).padStart(3, "0")}`;
}

const iso = (d: Date) => d.toISOString();

/**
 * Insert `count` customers. Deterministic for a given seed and day.
 * Ids embed their created_at time, so `ORDER BY id` is creation order.
 * Billing accounts live in ../billing-daemon, which seeds them from these customers.
 */
export function seed(
  db: Database,
  count: number,
  seedValue: number,
  /** Dates are generated relative to this; defaults to the start of today (UTC) so a seed is stable all day. */
  now: Date = new Date(new Date().setUTCHours(0, 0, 0, 0)),
): { customers: number } {
  const f = fakerEN_GB;
  f.seed(seedValue);

  const random = () => f.number.float({ min: 0, max: 1, fractionDigits: 8 }) % 1;
  const insertCustomer = db.prepare(`
    INSERT INTO customers (id, title, first_name, last_name, date_of_birth, email, contact_phone,
      address_line_1, address_line_2, town, county, postcode, postcode_compact, status, created_at, updated_at)
    VALUES ($id, $title, $first_name, $last_name, $date_of_birth, $email, $contact_phone,
      $line_1, $line_2, $town, $county, $postcode, $postcode_compact, $status, $created_at, $updated_at)
  `);

  db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const sex = f.helpers.arrayElement(["female", "male"] as const);
      const firstName = f.person.firstName(sex);
      const lastName = f.person.lastName();
      const title = f.helpers.weightedArrayElement([
        { weight: 45, value: sex === "female" ? f.helpers.arrayElement(["Mrs", "Ms", "Miss"]) : "Mr" },
        { weight: 3, value: "Dr" },
        { weight: 2, value: "Mx" },
        { weight: 50, value: null },
      ]);
      const createdAt = f.date.between({ from: new Date(now.getTime() - 12 * 365 * 864e5), to: now });
      const updatedAt = f.date.between({ from: createdAt, to: now });
      const address = fakeAddress(f);

      insertCustomer.run({
        id: newId("cus", createdAt.getTime(), random),
        title,
        first_name: firstName,
        last_name: lastName,
        date_of_birth: f.date.birthdate({ mode: "age", min: 18, max: 92, refDate: now }).toISOString().slice(0, 10),
        email: f.internet
          .email({ firstName, lastName, provider: f.helpers.arrayElement(["example.com", "example.co.uk", "example.org"]) })
          .toLowerCase(),
        contact_phone: fakeMobile(f),
        line_1: address.line_1,
        line_2: address.line_2,
        town: address.town,
        county: address.county,
        postcode: address.postcode,
        postcode_compact: compactPostcode(address.postcode),
        status: f.datatype.boolean({ probability: 0.03 }) ? "closed" : "active",
        created_at: iso(createdAt),
        updated_at: iso(updatedAt),
      });
    }
  })();

  return { customers: count };
}

export function isEmpty(db: Database): boolean {
  return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM customers").get()!.n === 0;
}
