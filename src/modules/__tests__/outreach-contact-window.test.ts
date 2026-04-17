import { describe, it, expect } from "vitest";
import {
  isWithinContactWindow,
  nextAllowedSendTime,
  inferTimezone,
} from "../outreach/contact-window";

describe("inferTimezone", () => {
  it("returns Eastern for NY", () => {
    expect(inferTimezone("NY")).toBe("America/New_York");
  });

  it("returns Central for TX", () => {
    expect(inferTimezone("TX")).toBe("America/Chicago");
  });

  it("returns Pacific for CA", () => {
    expect(inferTimezone("CA")).toBe("America/Los_Angeles");
  });

  it("returns Mountain for CO", () => {
    expect(inferTimezone("CO")).toBe("America/Denver");
  });

  it("returns Phoenix for AZ (no DST)", () => {
    expect(inferTimezone("AZ")).toBe("America/Phoenix");
  });

  it("returns default for null state", () => {
    expect(inferTimezone(null)).toBe("America/New_York");
  });

  it("returns default for unknown state", () => {
    expect(inferTimezone("XX")).toBe("America/New_York");
  });

  it("normalizes lowercase state codes", () => {
    expect(inferTimezone("ca")).toBe("America/Los_Angeles");
  });
});

describe("isWithinContactWindow", () => {
  // Use known UTC times that map to specific Eastern hours.
  // Eastern = UTC-4 (EDT) or UTC-5 (EST). April = EDT = UTC-4.
  // So 14:00 UTC = 10:00 AM Eastern, 11:00 UTC = 7:00 AM Eastern, etc.

  it("returns true during business hours (10 AM Eastern = 14:00 UTC in April)", () => {
    const now = new Date("2026-04-16T14:00:00Z"); // 10 AM EDT
    expect(isWithinContactWindow({ state: "NY" }, now)).toBe(true);
  });

  it("returns false before window (7 AM Eastern = 11:00 UTC)", () => {
    const now = new Date("2026-04-16T11:00:00Z"); // 7 AM EDT
    expect(isWithinContactWindow({ state: "NY" }, now)).toBe(false);
  });

  it("returns false after window (9 PM Eastern = 01:00 UTC next day)", () => {
    const now = new Date("2026-04-17T01:00:00Z"); // 9 PM EDT
    expect(isWithinContactWindow({ state: "NY" }, now)).toBe(false);
  });

  it("returns true at exactly window start (9 AM Eastern = 13:00 UTC)", () => {
    const now = new Date("2026-04-16T13:00:00Z"); // 9 AM EDT
    expect(isWithinContactWindow({ state: "NY" }, now)).toBe(true);
  });

  it("returns false at exactly window end (8 PM Eastern = 00:00 UTC next day)", () => {
    const now = new Date("2026-04-17T00:00:00Z"); // 8 PM EDT = 20:00
    expect(isWithinContactWindow({ state: "NY" }, now)).toBe(false);
  });

  it("uses default window when no preferences and null state", () => {
    const now = new Date("2026-04-16T18:00:00Z"); // 2 PM EDT
    expect(isWithinContactWindow({ state: null }, now)).toBe(true);
  });

  it("respects Pacific timezone for CA candidates", () => {
    // 9 AM Pacific = 16:00 UTC (PDT = UTC-7)
    const now = new Date("2026-04-16T16:00:00Z");
    expect(isWithinContactWindow({ state: "CA" }, now)).toBe(true);
  });

  it("rejects sends at 6 AM Pacific for CA candidates", () => {
    // 6 AM Pacific = 13:00 UTC (PDT = UTC-7)
    const now = new Date("2026-04-16T13:00:00Z");
    expect(isWithinContactWindow({ state: "CA" }, now)).toBe(false);
  });
});

describe("nextAllowedSendTime", () => {
  it("returns null when currently within window", () => {
    // Force a time we know is within the window
    const now = new Date("2026-04-16T14:00:00-04:00"); // 2 PM Eastern
    const result = nextAllowedSendTime({ state: "NY" }, now);
    expect(result).toBeNull();
  });

  it("returns a future date when outside window", () => {
    // 11 PM Eastern — after window closes
    const now = new Date("2026-04-16T23:00:00-04:00");
    const result = nextAllowedSendTime({ state: "NY" }, now);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThan(now.getTime());
  });
});
