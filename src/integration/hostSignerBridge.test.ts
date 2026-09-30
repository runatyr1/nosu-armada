// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { readHostDmRelays, readHostTheme } from "./hostSignerBridge";

describe("Nosu host theme bridge", () => {
  it("accepts a complete three-color palette", () => {
    expect(readHostTheme({
      name: "slate",
      mode: "dark",
      colors: {
        background: "#101215",
        text: "#e8eaed",
        primary: "#fafafa",
      },
    })).toEqual({
      name: "slate",
      mode: "dark",
      colors: {
        background: "#101215",
        text: "#e8eaed",
        primary: "#fafafa",
      },
    });
  });

  it("rejects malformed or non-hex palette values", () => {
    expect(readHostTheme({
      name: "bad",
      mode: "dark",
      colors: {
        background: "var(--secret)",
        text: "#ffffff",
        primary: "#ffffff",
      },
    })).toBeUndefined();
    expect(readHostTheme({ name: "incomplete", mode: "light", colors: {} })).toBeUndefined();
  });
});

describe("Nosu host DM relay bridge", () => {
  const pubkey = "a".repeat(64);

  it("accepts an empty choice and deduplicates valid relays", () => {
    expect(readHostDmRelays({ pubkey, relays: [] })).toEqual({ pubkey, relays: [] });
    expect(readHostDmRelays({ pubkey, relays: ["wss://relay.example/", "wss://relay.example"] }))
      .toEqual({ pubkey, relays: ["wss://relay.example"] });
  });

  it("rejects malformed keys and non-relay destinations", () => {
    expect(readHostDmRelays({ pubkey: "bad", relays: [] })).toBeUndefined();
    expect(readHostDmRelays({ pubkey, relays: ["https://relay.example"] })).toBeUndefined();
    expect(readHostDmRelays({ pubkey, relays: ["wss://user:pass@relay.example"] })).toBeUndefined();
  });
});
