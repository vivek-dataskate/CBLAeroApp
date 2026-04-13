export type ParsedCsv = {
  headers: string[];
  rows: Array<Record<string, string>>;
};

export type CanonicalField =
  | "first_name"
  | "last_name"
  | "middle_name"
  | "email"
  | "alternate_email"
  | "mobile"
  | "home_phone"
  | "work_phone"
  | "address"
  | "city"
  | "state"
  | "country"
  | "postal_code"
  | "current_company"
  | "job_title"
  | "skills"
  | "availability_status"
  | "(ignore)";

export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CANONICAL_FIELDS = new Set<CanonicalField>([
  "first_name",
  "last_name",
  "middle_name",
  "email",
  "alternate_email",
  "mobile",
  "home_phone",
  "work_phone",
  "address",
  "city",
  "state",
  "country",
  "postal_code",
  "current_company",
  "job_title",
  "skills",
  "availability_status",
  "(ignore)",
]);

export const FIELD_ALIASES: Record<string, Exclude<CanonicalField, "(ignore)">> = {
  // Name
  first_name: "first_name",
  firstname: "first_name",
  given_name: "first_name",
  last_name: "last_name",
  lastname: "last_name",
  surname: "last_name",
  family_name: "last_name",
  middle_name: "middle_name",
  middlename: "middle_name",
  // Email
  email: "email",
  email_address: "email",
  alternate_email: "alternate_email",
  alternate_email_address: "alternate_email",
  secondary_email: "alternate_email",
  other_email: "alternate_email",
  // Phone
  mobile: "mobile",
  mobile_phone: "mobile",
  mobile_number: "mobile",
  cell: "mobile",
  cell_phone: "mobile",
  phone: "mobile",
  phone_number: "mobile",
  home_phone: "home_phone",
  home_phone_number: "home_phone",
  work_phone: "work_phone",
  work_phone_number: "work_phone",
  office_phone: "work_phone",
  // Location
  address: "address",
  street_address: "address",
  city: "city",
  state: "state",
  province: "state",
  country: "country",
  postal_code: "postal_code",
  zip: "postal_code",
  zip_code: "postal_code",
  postcode: "postal_code",
  // Professional
  current_company: "current_company",
  company: "current_company",
  employer: "current_company",
  organization: "current_company",
  job_title: "job_title",
  title: "job_title",
  position: "job_title",
  role: "job_title",
  // Skills / availability
  skills: "skills",
  skill: "skills",
  availability: "availability_status",
  availability_status: "availability_status",
};

export function normalizeHeaderKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      // Handle RFC 4180 escaped double-quotes ("") inside quoted fields.
      // If we're inside quotes and the next char is also ", this is an escape — not a close.
      if (inQuotes && text[i + 1] === '"') {
        current += '""';
        i += 1; // skip the second "
        continue;
      }
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (current.trim().length > 0) {
        rows.push(current);
      }
      current = "";
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1; // skip the \n in \r\n
      }
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    rows.push(current);
  }

  return rows;
}

export function parseCsv(text: string): ParsedCsv {
  const lines = splitCsvRows(text.replace(/^\uFEFF/, ""));
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });

  return { headers, rows };
}

export function inferFieldForHeader(header: string): CanonicalField {
  const normalized = normalizeHeaderKey(header);
  return FIELD_ALIASES[normalized] ?? "(ignore)";
}
