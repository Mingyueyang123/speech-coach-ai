import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FloatingTools, PracticeClock } from "@/components/FloatingTools";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("practice tools", () => {
  it("counts independently, survives hiding, and pauses", () => {
    vi.useFakeTimers();
    render(<PracticeClock elapsed={0} practicing={false} />);
    fireEvent.click(screen.getByTitle("开始独立计时"));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("timer")).toHaveTextContent("00:03");
    fireEvent.click(screen.getByTitle("隐藏计时器"));
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByTitle("显示计时器"));
    expect(screen.getByRole("timer")).toHaveTextContent("00:05");
    fireEvent.click(screen.getByTitle("暂停独立计时"));
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByRole("timer")).toHaveTextContent("00:05");
  });
  it("shows recorded elapsed time without allowing a reset", () => {
    render(<PracticeClock elapsed={75} practicing />);
    expect(screen.getByRole("timer")).toHaveTextContent("01:15");
    expect(screen.getByTitle("重置独立计时")).toBeDisabled();
  });
  it("explains unavailable desktop PiP while keeping the script visible", () => {
    render(<FloatingTools><p>练习台词</p></FloatingTools>);
    fireEvent.click(screen.getByTitle("桌面悬浮"));
    expect(screen.getByRole("status")).toHaveTextContent("桌面 Chrome");
    expect(screen.getByText("练习台词")).toBeVisible();
  });
  it("keeps the same running clock when moving into and out of desktop PiP", async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const child = {
      document: document.implementation.createHTMLDocument("PiP"),
      addEventListener: events.addEventListener.bind(events),
      close: () => events.dispatchEvent(new Event("pagehide")),
    };
    vi.stubGlobal("documentPictureInPicture", { requestWindow: vi.fn().mockResolvedValue(child) });
    render(<FloatingTools><PracticeClock elapsed={0} practicing={false} /></FloatingTools>);
    fireEvent.click(screen.getByTitle("开始独立计时"));
    act(() => vi.advanceTimersByTime(3000));
    await act(async () => { fireEvent.click(screen.getByTitle("桌面悬浮")); });
    expect(within(child.document.body).getByRole("timer", { hidden: true }).textContent).toBe("00:03");
    act(() => vi.advanceTimersByTime(2000));
    act(() => { child.close(); });
    expect(screen.getByRole("timer")).toHaveTextContent("00:05");
    expect(screen.getByTitle("暂停独立计时")).toBeEnabled();
  });
});
