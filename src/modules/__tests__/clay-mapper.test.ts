import { describe, expect, it } from 'vitest';
import {
  mapClayRowToCandidate,
  parseClayLocation,
  computeClayFingerprint,
  type ClayMapperConfig,
} from '@/modules/ingestion/clay-mapper';

const CONFIG: ClayMapperConfig = {
  emailField: 'Personal Email',
  phoneField: 'Mobile Phone',
  defaultAssigneeUserId: 'user-vivek-123',
};

/**
 * The production Clay payload uses lowercase `email`/`phone` sidecar columns and
 * nests the LinkedIn blob under `enrichlinkedin_data`. This config variant
 * matches what the route sees at runtime after reading env vars.
 */
const PROD_CONFIG: ClayMapperConfig = {
  emailField: 'email',
  phoneField: 'phone',
  defaultAssigneeUserId: 'user-vivek-123',
};

/**
 * Fixture based on the real Isis Soto payload captured during Story 2.8 discovery.
 * Structured LinkedIn fields are nested under 'Enrich person' (how Clay sends them
 * when the HTTP API column body references the enrichment column directly) and
 * the sidecar email/phone columns sit at the top level.
 */
const ISIS_SOTO_CLAY_ROW = {
  'Personal Email': 'sotoisis27@gmail.com',
  'Mobile Phone': '+17733298878',
  'Enrich person': {
    first_name: 'Isis',
    last_name: 'Soto',
    name: 'Isis Soto',
    slug: 'isis-soto-34b54725a',
    url: 'https://www.linkedin.com/in/isis-soto-34b54725a',
    title: 'Billing Coordinator',
    headline: '--',
    country: 'United States',
    org: 'Seyfarth Shaw LLP',
    location_name: 'Chicago, Illinois, United States',
    profile_id: 1070321963,
    last_refresh: '2026-04-15 18:42:29.033',
    connections: 7,
    num_followers: 11,
    languages: [{ language: 'Spanish', proficiency: 'Native or bilingual proficiency' }],
    experience: [
      {
        title: 'Billing Coordinator',
        company: 'Seyfarth Shaw LLP',
        is_current: true,
        start_date: '2022-01-01',
        end_date: null,
        locality: 'Chicago, Illinois, United States',
      },
      {
        title: 'Billing Analyst',
        company: 'Mayer Brown',
        is_current: false,
        start_date: '2018-01-01',
        end_date: '2022-01-01',
      },
    ],
    latest_experience: {
      title: 'Billing Coordinator',
      company: 'Seyfarth Shaw LLP',
      is_current: true,
      start_date: '2022-01-01',
    },
    certifications: null,
  },
};

describe('parseClayLocation', () => {
  it('returns nulls for null/undefined/empty input', () => {
    expect(parseClayLocation(null)).toEqual({ city: null, state: null });
    expect(parseClayLocation(undefined)).toEqual({ city: null, state: null });
    expect(parseClayLocation('')).toEqual({ city: null, state: null });
  });

  it('parses a 3-part US location into city + state, drops country', () => {
    expect(parseClayLocation('Chicago, Illinois, United States')).toEqual({
      city: 'Chicago',
      state: 'Illinois',
    });
  });

  it('parses a 2-part city+state format', () => {
    expect(parseClayLocation('Austin, Texas')).toEqual({ city: 'Austin', state: 'Texas' });
  });

  it('treats a single-token location as city-only', () => {
    expect(parseClayLocation('San Francisco Bay Area')).toEqual({
      city: 'San Francisco Bay Area',
      state: null,
    });
  });

  it('handles extra whitespace gracefully', () => {
    expect(parseClayLocation('  Chicago ,  Illinois  ')).toEqual({ city: 'Chicago', state: 'Illinois' });
  });

  it('returns nulls for pathological 4+ part strings', () => {
    // Give up rather than guess — we'd rather leave city/state null than miscategorize.
    expect(parseClayLocation('Region, City, State, Country')).toEqual({ city: null, state: null });
  });
});

describe('mapClayRowToCandidate — canonical Isis Soto fixture', () => {
  it('extracts identity from the nested Enrich person blob', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.firstName).toBe('Isis');
    expect(mapped.lastName).toBe('Soto');
  });

  it('uses the sidecar Personal Email column as the candidate email, lowercased', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.email).toBe('sotoisis27@gmail.com');
  });

  it('uses the sidecar Mobile Phone column as the candidate phone as-is', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.phone).toBe('+17733298878');
  });

  it('populates linkedin_url from the structured url field', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.linkedinUrl).toBe('https://www.linkedin.com/in/isis-soto-34b54725a');
  });

  it('prefers title over headline, and falls back when headline is "--"', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.jobTitle).toBe('Billing Coordinator');
  });

  it('prefers org over latest_experience.company for current_company', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.client).toBe('Seyfarth Shaw LLP');
  });

  it('parses location_name into city + state, preserves raw location', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.location).toBe('Chicago, Illinois, United States');
    expect(mapped.city).toBe('Chicago');
    expect(mapped.state).toBe('Illinois');
    expect(mapped.country).toBe('United States');
  });

  it('preserves the experience array as structured JSONB', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(Array.isArray(mapped.experience)).toBe(true);
    expect(mapped.experience).toHaveLength(2);
  });

  it('coerces null certifications to an empty array', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.certifications).toEqual([]);
  });

  it('stamps source as clay_enrichment', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.source).toBe('clay_enrichment');
  });

  it('stamps source_recruiter_actor_id from config', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.sourceRecruiterActorId).toBe('user-vivek-123');
  });

  it('preserves the full raw payload under extra_attributes.clay', () => {
    const mapped = mapClayRowToCandidate(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(mapped.extra_attributes).toHaveProperty('clay');
    expect(mapped.extra_attributes.clay).toEqual(ISIS_SOTO_CLAY_ROW);
  });
});

describe('mapClayRowToCandidate — edge cases', () => {
  it('handles headline fallback when title is a degenerate value', () => {
    const row = {
      ...ISIS_SOTO_CLAY_ROW,
      'Enrich person': {
        ...ISIS_SOTO_CLAY_ROW['Enrich person'],
        title: '--',
        headline: 'Senior Aviation Technician',
      },
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.jobTitle).toBe('Senior Aviation Technician');
  });

  it('falls back to latest_experience.title when both title and headline are degenerate', () => {
    const row = {
      ...ISIS_SOTO_CLAY_ROW,
      'Enrich person': {
        ...ISIS_SOTO_CLAY_ROW['Enrich person'],
        title: '--',
        headline: '—',
      },
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.jobTitle).toBe('Billing Coordinator');
  });

  it('falls back to latest_experience.company when org is missing', () => {
    const row = {
      ...ISIS_SOTO_CLAY_ROW,
      'Enrich person': {
        ...ISIS_SOTO_CLAY_ROW['Enrich person'],
        org: '',
      },
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.client).toBe('Seyfarth Shaw LLP');
  });

  it('returns null email when the sidecar field is missing entirely', () => {
    const row = {
      'Mobile Phone': '+15551234567',
      'Enrich person': { first_name: 'A', last_name: 'B', url: 'x' },
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.email).toBe(null);
    expect(mapped.phone).toBe('+15551234567');
  });

  it('accepts flat top-level payloads (no nested Enrich person key)', () => {
    // When a recruiter configures Clay to send all columns flat instead of nesting
    // LinkedIn data under a single column, the mapper should still work.
    const flatRow = {
      'Personal Email': 'test@example.com',
      'Mobile Phone': '+15551234567',
      first_name: 'Flat',
      last_name: 'User',
      url: 'https://linkedin.com/in/flat',
      title: 'Engineer',
      org: 'Acme',
      country: 'United States',
      location_name: 'Austin, Texas',
      experience: [],
      profile_id: 999,
      last_refresh: '2026-04-15',
    };
    const mapped = mapClayRowToCandidate(flatRow, CONFIG);
    expect(mapped.firstName).toBe('Flat');
    expect(mapped.lastName).toBe('User');
    expect(mapped.email).toBe('test@example.com');
    expect(mapped.city).toBe('Austin');
    expect(mapped.state).toBe('Texas');
  });

  it('does not crash on completely empty Enrich person blob', () => {
    const row = {
      'Personal Email': 'empty@example.com',
      'Mobile Phone': '+15550000000',
      'Enrich person': {},
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.firstName).toBe('');
    expect(mapped.lastName).toBe('');
    expect(mapped.email).toBe('empty@example.com');
    expect(mapped.experience).toEqual([]);
    expect(mapped.certifications).toEqual([]);
  });
});

/**
 * Regression fixture captured from a real Clay HTTP API column webhook delivery
 * on 2026-04-15. This is the EXACT shape Clay sends in production — keep these
 * tests green to guarantee the mapper stays compatible with the live table.
 */
const REAL_CLAY_PAYLOAD_MICHAELA = {
  enrichlinkedin_data: {
    awards: null,
    certifications: null,
    connections: 260,
    country: 'United States',
    current_experience: [
      {
        company: 'Kelley Drye & Warren LLP',
        company_domain: 'kelleydrye.com',
        end_date: null,
        is_current: true,
        locality: 'Washington DC-Baltimore Area',
        org_id: 10334,
        start_date: '2020-03-01',
        title: 'Billing Specialist',
      },
    ],
    education: [
      {
        degree: 'Bachelor of Business Administration (B.B.A.)',
        end_date: '2016-01-01',
        field_of_study: 'Accounting',
        school_name: 'North Carolina Central University',
        start_date: '2012-01-01',
      },
    ],
    experience: [
      { company: 'Kelley Drye & Warren LLP', title: 'Billing Specialist', is_current: true, start_date: '2020-03-01' },
      { company: 'Oliff PLC', title: 'Accounting Specialist', is_current: false, start_date: '2018-07-01', end_date: '2020-03-01' },
    ],
    first_name: 'Michaela',
    headline: 'Billing Coordinator at Kelley Drye & Warren LLP',
    last_name: 'Ealey',
    last_refresh: '2026-04-15 19:54:39.698',
    latest_experience: {
      company: 'Kelley Drye & Warren LLP',
      title: 'Billing Specialist',
      is_current: true,
      start_date: '2020-03-01',
    },
    location_name: 'Temple Hills Park, Maryland, United States',
    name: 'Michaela Ealey',
    num_followers: 261,
    org: 'Kelley Drye & Warren LLP',
    profile_id: 216822394,
    slug: 'michaela-ealey-b0a74360',
    title: 'Billing Specialist',
    url: 'https://www.linkedin.com/in/michaela-ealey-b0a74360',
  },
  email: 'ealey12@comcast.net',
  phone: '+12406916249',
};

describe('mapClayRowToCandidate — real production payload (Michaela Ealey)', () => {
  it('extracts first + last name from the nested enrichlinkedin_data blob', () => {
    const mapped = mapClayRowToCandidate(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    expect(mapped.firstName).toBe('Michaela');
    expect(mapped.lastName).toBe('Ealey');
  });

  it('reads sidecar email and phone from lowercase top-level keys', () => {
    const mapped = mapClayRowToCandidate(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    expect(mapped.email).toBe('ealey12@comcast.net');
    expect(mapped.phone).toBe('+12406916249');
  });

  it('uses title over headline when title is non-degenerate', () => {
    // Real row has title="Billing Specialist" and headline="Billing Coordinator at Kelley Drye & Warren LLP"
    // Both are non-degenerate — we should prefer title.
    const mapped = mapClayRowToCandidate(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    expect(mapped.jobTitle).toBe('Billing Specialist');
  });

  it('picks current_company from org', () => {
    const mapped = mapClayRowToCandidate(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    expect(mapped.client).toBe('Kelley Drye & Warren LLP');
  });

  it('parses location_name with a 3-part Maryland format', () => {
    const mapped = mapClayRowToCandidate(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    expect(mapped.location).toBe('Temple Hills Park, Maryland, United States');
    expect(mapped.city).toBe('Temple Hills Park');
    expect(mapped.state).toBe('Maryland');
    expect(mapped.country).toBe('United States');
  });

  it('populates linkedin_url from enrichlinkedin_data.url', () => {
    const mapped = mapClayRowToCandidate(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    expect(mapped.linkedinUrl).toBe('https://www.linkedin.com/in/michaela-ealey-b0a74360');
  });

  it('preserves the experience array as structured JSONB', () => {
    const mapped = mapClayRowToCandidate(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    expect(Array.isArray(mapped.experience)).toBe(true);
    expect(mapped.experience).toHaveLength(2);
  });

  it('stores the full raw payload under extra_attributes.clay (including fields not promoted to columns)', () => {
    const mapped = mapClayRowToCandidate(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    // education, languages, num_followers, connections, slug, etc. all land here
    expect(mapped.extra_attributes.clay).toEqual(REAL_CLAY_PAYLOAD_MICHAELA);
    // Sanity: the nested blob is reachable
    const clay = (mapped.extra_attributes as { clay: Record<string, unknown> }).clay;
    const linkedIn = clay.enrichlinkedin_data as Record<string, unknown>;
    expect(linkedIn.connections).toBe(260);
    expect(linkedIn.num_followers).toBe(261);
    expect(linkedIn.slug).toBe('michaela-ealey-b0a74360');
  });

  it('computes a stable fingerprint from profile_id + last_refresh', () => {
    const fp = computeClayFingerprint(REAL_CLAY_PAYLOAD_MICHAELA, PROD_CONFIG);
    expect(fp).toBe('clay:216822394:2026-04-15 19:54:39.698');
  });
});

describe('computeClayFingerprint', () => {
  it('produces a stable fingerprint from profile_id + last_refresh', () => {
    const fp = computeClayFingerprint(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(fp).toBe('clay:1070321963:2026-04-15 18:42:29.033');
  });

  it('returns the same fingerprint for repeated calls (idempotency foundation)', () => {
    const fp1 = computeClayFingerprint(ISIS_SOTO_CLAY_ROW, CONFIG);
    const fp2 = computeClayFingerprint(ISIS_SOTO_CLAY_ROW, CONFIG);
    expect(fp1).toBe(fp2);
  });

  it('changes when last_refresh changes (re-enrichment triggers re-processing)', () => {
    const fp1 = computeClayFingerprint(ISIS_SOTO_CLAY_ROW, CONFIG);
    const refreshed = {
      ...ISIS_SOTO_CLAY_ROW,
      'Enrich person': {
        ...ISIS_SOTO_CLAY_ROW['Enrich person'],
        last_refresh: '2026-05-01 09:00:00.000',
      },
    };
    const fp2 = computeClayFingerprint(refreshed, CONFIG);
    expect(fp2).not.toBe(fp1);
  });

  it('falls back to clay:email when profile_id is missing', () => {
    const row = {
      'Personal Email': 'fallback@example.com',
      'Mobile Phone': '+15551234567',
      'Enrich person': { first_name: 'A', last_name: 'B' }, // no profile_id, no last_refresh
    };
    const fp = computeClayFingerprint(row, CONFIG);
    expect(fp).toBe('clay:fallback@example.com');
  });

  it('returns null when no usable identity is available', () => {
    const row = { 'Enrich person': { first_name: 'X' } };
    const fp = computeClayFingerprint(row, CONFIG);
    expect(fp).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Code review regression tests (2026-04-16) — covers patches P3, P4, P6
// ─────────────────────────────────────────────────────────────────────────────

describe('P3 — computeClayFingerprint type guard on profile_id', () => {
  const base = {
    'Personal Email': 'x@y.com',
    'Enrich person': { first_name: 'X', last_refresh: '2026-04-15' },
  };

  it('rejects profile_id = 0 (falsy number)', () => {
    const row = { ...base, 'Enrich person': { ...base['Enrich person'], profile_id: 0 } };
    const fp = computeClayFingerprint(row, CONFIG);
    // Falls through to email fallback, does NOT produce `clay:0:...`
    expect(fp).toBe('clay:x@y.com');
  });

  it('rejects profile_id as empty object', () => {
    const row = { ...base, 'Enrich person': { ...base['Enrich person'], profile_id: {} } };
    const fp = computeClayFingerprint(row, CONFIG);
    expect(fp).toBe('clay:x@y.com');
  });

  it('rejects profile_id as empty array', () => {
    const row = { ...base, 'Enrich person': { ...base['Enrich person'], profile_id: [] } };
    const fp = computeClayFingerprint(row, CONFIG);
    expect(fp).toBe('clay:x@y.com');
  });

  it('rejects profile_id as boolean false', () => {
    const row = { ...base, 'Enrich person': { ...base['Enrich person'], profile_id: false } };
    const fp = computeClayFingerprint(row, CONFIG);
    expect(fp).toBe('clay:x@y.com');
  });

  it('accepts profile_id as positive integer', () => {
    const row = { ...base, 'Enrich person': { ...base['Enrich person'], profile_id: 12345 } };
    const fp = computeClayFingerprint(row, CONFIG);
    expect(fp).toBe('clay:12345:2026-04-15');
  });

  it('accepts profile_id as non-empty string', () => {
    const row = { ...base, 'Enrich person': { ...base['Enrich person'], profile_id: 'abc-123' } };
    const fp = computeClayFingerprint(row, CONFIG);
    expect(fp).toBe('clay:abc-123:2026-04-15');
  });

  it('rejects profile_id as empty string (trim to empty)', () => {
    const row = { ...base, 'Enrich person': { ...base['Enrich person'], profile_id: '   ' } };
    const fp = computeClayFingerprint(row, CONFIG);
    expect(fp).toBe('clay:x@y.com');
  });
});

describe('P4 — parseClayLocation 4-part and edge shapes', () => {
  it('returns nulls for 4-part locations (unknown shape, preserve raw)', () => {
    expect(parseClayLocation('Region, City, State, Country')).toEqual({ city: null, state: null });
  });

  it('parses 3-part locations as city, state, drop country (real Clay shape)', () => {
    expect(parseClayLocation('Temple Hills Park, Maryland, United States')).toEqual({
      city: 'Temple Hills Park',
      state: 'Maryland',
    });
  });
});

describe('P6 — non-string sidecar coercion', () => {
  const baseLinkedin = {
    first_name: 'Test',
    last_name: 'User',
    url: 'https://linkedin.com/in/test',
    profile_id: 1,
    last_refresh: '2026-04-15',
  };

  it('coerces number email to string', () => {
    const row = {
      'Personal Email': 'x@y.com',
      'Mobile Phone': 14155551234,  // number instead of string
      'Enrich person': baseLinkedin,
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.phone).toBe('14155551234');
  });

  it('unwraps single-element array sidecar', () => {
    const row = {
      'Personal Email': ['wrapped@example.com'],
      'Mobile Phone': '+15551234567',
      'Enrich person': baseLinkedin,
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.email).toBe('wrapped@example.com');
  });

  it('drops object sidecar with empty string (logged warning)', () => {
    const row = {
      'Personal Email': { nested: 'bad' },
      'Mobile Phone': '+15551234567',
      'Enrich person': baseLinkedin,
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.email).toBe(null);  // empty string → null after coalesce
  });

  it('coerces boolean sidecar to string representation', () => {
    const row = {
      'Personal Email': 'x@y.com',
      'Mobile Phone': true,
      'Enrich person': baseLinkedin,
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.phone).toBe('true');
  });

  it('handles null sidecar as empty (no warning)', () => {
    const row = {
      'Personal Email': 'x@y.com',
      'Mobile Phone': null,
      'Enrich person': baseLinkedin,
    };
    const mapped = mapClayRowToCandidate(row, CONFIG);
    expect(mapped.phone).toBe(null);
  });
});
