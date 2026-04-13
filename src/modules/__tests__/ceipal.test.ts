import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapCeipalApplicantToCandidate, clearCeipalTokenCacheForTest } from '@/modules/ats/ceipal';
import type { CeipalApplicant } from '@/modules/ats/ceipal';

describe('mapCeipalApplicantToCandidate', () => {
  const fullApplicant: CeipalApplicant = {
    first_name: '  John  ',
    middle_name: 'M',
    last_name: '  Doe  ',
    email_address: '  john@test.com  ',
    alternate_email_address: 'john2@test.com',
    home_phone_number: '555-0001',
    mobile_number: '555-0002',
    work_phone_number: '555-0003',
    address: '123 Main St',
    city: 'Dallas',
    state: 'TX',
    country: 'USA',
    zip_code: '75001',
    job_title: 'A&P Technician',
    skills: 'Sheet Metal, Avionics, Composites',
    work_authorization: 'US Citizen',
    clearance: 'Secret',
  };

  it('maps all fields with trimming', () => {
    const result = mapCeipalApplicantToCandidate(fullApplicant);
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Doe');
    expect(result.middleName).toBe('M');
    expect(result.email).toBe('john@test.com');
    expect(result.alternateEmail).toBe('john2@test.com');
    expect(result.phone).toBe('555-0002'); // mobile preferred
    expect(result.homePhone).toBe('555-0001');
    expect(result.workPhone).toBe('555-0003');
    expect(result.address).toBe('123 Main St');
    expect(result.city).toBe('Dallas');
    expect(result.state).toBe('TX');
    expect(result.country).toBe('USA');
    expect(result.postalCode).toBe('75001');
    expect(result.jobTitle).toBe('A&P Technician');
    expect(result.workAuthorization).toBe('US Citizen');
    expect(result.clearance).toBe('Secret');
    expect(result.source).toBe('ceipal');
  });

  it('splits comma-separated skills into array', () => {
    const result = mapCeipalApplicantToCandidate(fullApplicant);
    expect(result.skills).toEqual(['Sheet Metal', 'Avionics', 'Composites']);
  });

  it('returns empty skills array when no skills', () => {
    const result = mapCeipalApplicantToCandidate({
      first_name: 'Jane',
      last_name: 'Doe',
      email_address: 'jane@test.com',
    });
    expect(result.skills).toEqual([]);
  });

  it('falls back to home phone when mobile is missing', () => {
    const result = mapCeipalApplicantToCandidate({
      first_name: 'Jane',
      last_name: 'Doe',
      email_address: 'jane@test.com',
      home_phone_number: '555-HOME',
    });
    expect(result.phone).toBe('555-HOME');
  });

  it('handles minimal applicant with only required fields', () => {
    const result = mapCeipalApplicantToCandidate({
      first_name: 'Min',
      last_name: 'Imal',
      email_address: 'min@test.com',
    });
    expect(result.firstName).toBe('Min');
    expect(result.lastName).toBe('Imal');
    expect(result.email).toBe('min@test.com');
    expect(result.source).toBe('ceipal');
    expect(result.middleName).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.skills).toEqual([]);
  });

  it('handles empty/whitespace-only fields', () => {
    const result = mapCeipalApplicantToCandidate({
      first_name: '  ',
      last_name: '  ',
      email_address: '  ',
      skills: ',,, ,',
    });
    expect(result.firstName).toBe('');
    expect(result.lastName).toBe('');
    expect(result.email).toBe('');
    expect(result.skills).toEqual([]);
  });
});

describe('clearCeipalTokenCacheForTest', () => {
  it('does not throw', () => {
    expect(() => clearCeipalTokenCacheForTest()).not.toThrow();
  });
});
