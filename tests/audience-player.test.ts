import { afterEach, expect, it, vi } from "vitest";
import { AudiencePlayer } from "@/lib/audience-player";
afterEach(() => vi.unstubAllGlobals());
it("cancels pending speech without starting late playback", async () => {
  let complete!: (response: Response) => void;
  const fetch = vi.fn().mockImplementation(() => new Promise(resolve => { complete = resolve; })); vi.stubGlobal("fetch", fetch);
  const Audio = vi.fn(); vi.stubGlobal("Audio", Audio);
  const player = new AudiencePlayer(); const play = player.play("Question?", "en-US");
  player.cancel(); complete(new Response("audio"));
  await expect(play).rejects.toThrow(); expect(Audio).not.toHaveBeenCalled(); expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});
it("stops playing and releases the object URL", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("audio")));
  const pause = vi.fn(), play = vi.fn().mockResolvedValue(undefined), load = vi.fn();
  vi.stubGlobal("Audio", class { pause = pause; play = play; load = load; removeAttribute() {} });
  URL.createObjectURL = vi.fn().mockReturnValue("blob:local"); URL.revokeObjectURL = vi.fn();
  const player = new AudiencePlayer(); await player.play("你好", "zh-CN"); player.cancel();
  expect(pause).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:local");
});
