import { describe, it, expect, vi, beforeEach } from "vitest";

const poolCtor = vi.fn();

vi.mock("pg", () => ({
  Pool: poolCtor,
}));

describe("getDb — C1 TLS verification", () => {
  beforeEach(async () => {
    vi.resetModules();
    poolCtor.mockClear();
    delete process.env.DATABASE_CA_CERT;
    delete process.env.DATABASE_URL;
  });

  it("C1 — DATABASE_CA_CERT must enable rejectUnauthorized TLS verification", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@host:5432/db";
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----";

    const { getDb } = await import("./db");
    getDb();

    expect(poolCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionString: process.env.DATABASE_URL,
        ssl: expect.objectContaining({
          ca: process.env.DATABASE_CA_CERT,
          rejectUnauthorized: true,
        }),
      }),
    );
  });

  it("C1 — production must not rely on sslmode=no-verify without DATABASE_CA_CERT", async () => {
    process.env.DATABASE_URL =
      "postgresql://user:pass@host:5432/db?sslmode=no-verify";

    const { getDb } = await import("./db");
    getDb();

    const ssl = poolCtor.mock.calls[0]?.[0]?.ssl;
    expect(ssl).toEqual(
      expect.objectContaining({ rejectUnauthorized: true }),
    );
  });
});
