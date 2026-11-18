/** A UK postal address in Royal Mail line order. */
export interface Address {
  /** Sub-premise or building, e.g. "Flat 4", or the street line when there is none. */
  line_1: string;
  line_2: string | null;
  /** Post town, e.g. "Manchester" (Royal Mail prints it uppercase on envelopes). */
  town: string;
  /** Optional since Royal Mail stopped requiring counties; kept for display. */
  county: string | null;
  /** Normalised, e.g. "M14 5RG". */
  postcode: string;
  country: "GB";
}

export type CustomerStatus = "active" | "closed";

export interface Customer {
  id: string;
  title: string | null;
  first_name: string;
  last_name: string;
  /** ISO date, YYYY-MM-DD. */
  date_of_birth: string;
  email: string;
  contact_phone: string;
  address: Address;
  status: CustomerStatus;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
}
