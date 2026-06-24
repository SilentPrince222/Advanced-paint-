import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Next.js server modules — no-op in vitest (stripe-executor, flow-repo, etc.)
vi.mock("server-only", () => ({}));
