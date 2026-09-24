// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { readHostTheme } from "./hostSignerBridge";

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
