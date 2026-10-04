import { describe, expect, it, vi } from "vitest";
import { printReport } from "../lib/export";

describe("printReport", () => {
  it("names the PDF after the report while printing, then restores the page title", () => {
    document.title = "Pain Point Radar";
    let titleDuringPrint = "";
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      titleDuringPrint = document.title;
    });

    printReport("pain-points-figma");
    expect(print).toHaveBeenCalledOnce();
    expect(titleDuringPrint).toBe("pain-points-figma");

    window.dispatchEvent(new Event("afterprint"));
    expect(document.title).toBe("Pain Point Radar");
    print.mockRestore();
  });
});
