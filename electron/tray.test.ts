import { describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const menuBuildFromTemplate = vi.fn((template: any[]) => template);
  const createFromDataURL = vi.fn(() => ({ isEmpty: () => false }));
  const createFromPath = vi.fn(() => ({ isEmpty: () => false, resize: () => ({ isEmpty: () => false }) }));
  class FakeTray {
    menu: any = [];
    tooltip = "";
    listeners = new Map<string, Array<(...args: any[]) => void>>();
    setContextMenu(menu: any) {
      this.menu = menu;
    }
    setToolTip(tooltip: string) {
      this.tooltip = tooltip;
    }
    on(event: string, cb: (...args: any[]) => void) {
      const list = this.listeners.get(event) ?? [];
      list.push(cb);
      this.listeners.set(event, list);
    }
    destroy = vi.fn();
  }
  return {
    Tray: FakeTray,
    Menu: { buildFromTemplate: menuBuildFromTemplate },
    nativeImage: { createFromDataURL, createFromPath },
  };
});

vi.mock("electron", () => electron);

import { TrayController, type TrayAction } from "./tray";

function fakeWindow() {
  return {
    isDestroyed: () => false,
    hide: vi.fn(),
    show: vi.fn(),
    isVisible: () => true,
  };
}

function menuItems(tray: InstanceType<typeof electron.Tray>): any[] {
  return (tray.menu as any[]) ?? [];
}

function itemByLabel(tray: InstanceType<typeof electron.Tray>, label: string) {
  return menuItems(tray).find((i) => i.label === label);
}

describe("TrayController", () => {
  function setup(platform: NodeJS.Platform = "win32") {
    const win = fakeWindow();
    const actions: TrayAction[] = [];
    const controller = new TrayController(
      () => win as never,
      (action) => actions.push(action),
      platform,
    );
    controller.show();
    return { win, actions, controller, tray: (controller as any).tray as InstanceType<typeof electron.Tray> };
  }

  it("creates a tray with Play/Pause, Next, Previous, Show/Hide Liner, Quit", () => {
    const { tray } = setup();
    const labels = menuItems(tray).map((i) => i.label).filter(Boolean);
    // Show/Hide is a single toggleable button — only one of them appears
    // When window is visible (default for fake window), label is "Hide Liner"
    expect(labels).toEqual(
      expect.arrayContaining(["Play", "Next", "Previous", "Hide Liner", "Quit"]),
    );
    expect(labels.filter((l) => l === "Show Liner" || l === "Hide Liner")).toHaveLength(1);
  });

  it("shows Previous and Next disabled when no track is loaded", () => {
    const { tray, controller } = setup();
    controller.update({ status: "idle", track: null });
    expect(itemByLabel(tray, "Previous")?.enabled).toBe(false);
    expect(itemByLabel(tray, "Next")?.enabled).toBe(false);
  });

  it("enables Next and Previous when a track is loaded", () => {
    const { tray, controller } = setup();
    controller.update({ status: "playing", track: { title: "My song", artist: "My artist" } });
    expect(itemByLabel(tray, "Previous")?.enabled).toBe(true);
    expect(itemByLabel(tray, "Next")?.enabled).toBe(true);
  });

  it("labels Play when paused and Pause when playing", () => {
    const { tray, controller } = setup();
    expect(itemByLabel(tray, "Play")?.label).toBe("Play");

    controller.update({ status: "playing", track: { title: "Song" } });
    expect(itemByLabel(tray, "Pause")?.label).toBe("Pause");
  });

  it("updates the tooltip to include track title and artist while playing", () => {
    const { tray, controller } = setup();
    expect(tray.tooltip).toBe("Liner");
    controller.update({ status: "playing", track: { title: "My song", artist: "My artist" } });
    expect(tray.tooltip).toBe("Liner — My song · My artist");
    controller.update({ status: "idle", track: null });
    expect(tray.tooltip).toBe("Liner");
  });

  it("routes tray menu actions through the send callback (playing track)", () => {
    const { actions, controller } = setup();
    controller.update({ status: "playing", track: { title: "X" } });
    const tray = (controller as any).tray as InstanceType<typeof electron.Tray>;
    expect(tray).toBeDefined();
    for (const item of menuItems(tray)) {
      if (typeof item.click === "function") item.click();
    }
    // with playing status: actions should be ["pause", "next", "prev"]
    expect(actions).toEqual(expect.arrayContaining(["pause", "next", "prev"]));
  });

  it("routes tray menu actions through the send callback (idle track)", () => {
    const { actions, controller } = setup();
    controller.update({ status: "idle", track: null });
    const tray = (controller as any).tray as InstanceType<typeof electron.Tray>;
    expect(tray).toBeDefined();
    for (const item of menuItems(tray)) {
      if (typeof item.click === "function") item.click();
    }
    // with idle status: actions should be ["play", "next", "prev"] (Next/Prev may be disabled)
    expect(actions).toEqual(expect.arrayContaining(["play", "next", "prev"]));
  });

  it("does nothing on darwin (menu bar, not tray)", () => {
    const win = fakeWindow();
    const controller = new TrayController(
      () => win as never,
      () => {},
      "darwin",
    );
    controller.show();
    const tray = (controller as any).tray;
    expect(tray).toBeNull();
  });

  it("destroys the tray on destroy", () => {
    const { controller } = setup();
    const tray = (controller as any).tray as InstanceType<typeof electron.Tray>;
    expect(tray).not.toBeNull();
    controller.destroy();
    expect((controller as any).tray).toBeNull();
    expect(tray.destroy).toHaveBeenCalledTimes(1);
  });
});