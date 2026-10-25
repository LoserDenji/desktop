import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => {
  const { EventEmitter } = require("node:events") as typeof import("node:events");
  const ipcOn = new Map<string, (...args: unknown[]) => unknown>();
  const windows: FakeWindow[] = [];
  let nextId = 1;

  class FakeContents extends EventEmitter {
    id = nextId++;
    send = vi.fn();
    executeJavaScript = vi.fn(async () => 1);
  }

  class FakeWindow extends EventEmitter {
    webContents = new FakeContents();
    visible: boolean;
    destroyed = false;
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    loadFile = vi.fn(async () => {});
    loadURL = vi.fn(async () => {});
    constructor(options: { show?: boolean } = {}) {
      super();
      this.visible = options.show ?? true;
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
    isVisible() {
      return this.visible;
    }
    getBounds() {
      return this.bounds;
    }
    setBounds(b: { x: number; y: number; width: number; height: number }) {
      this.bounds = b;
    }
    showInactive = vi.fn(() => {
      this.visible = true;
    });
    hide = vi.fn(() => {
      this.visible = false;
    });
    opacity = 1;
    setOpacity = vi.fn((value: number) => {
      this.opacity = value;
    });
    setAlwaysOnTop = vi.fn();
    moveTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
  }

  const display = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  return {
    ipcOn,
    windows,
    FakeWindow,
    module: {
      BrowserWindow: FakeWindow,
      ipcMain: {
        on: (channel: string, handler: (...args: unknown[]) => unknown) => ipcOn.set(channel, handler),
        handle: () => {},
      },
      screen: { getPrimaryDisplay: () => display, getDisplayMatching: () => display },
      globalShortcut: { register: () => true, unregister: () => {} },
      app: { getPath: () => require("node:os").tmpdir() + "/liner-overlay-test-missing" },
    },
  };
});

vi.mock("electron", () => electron.module);

import { OverlayManager } from "./overlay";

type Win = InstanceType<typeof electron.FakeWindow>;

function setup(signedIn = true) {
  const manager = new OverlayManager("/preload.cjs", "/dist");
  const main = new electron.FakeWindow({ show: true }) as Win;
  manager.setMainWindow(main as never);
  manager.bindAuthSource(() => signedIn, () => {});
  const overlays = () => electron.windows.filter((w) => w !== main) as Win[];
  const ready = (win: Win) => electron.ipcOn.get("overlay:ready")?.({ sender: win.webContents });
  return { manager, main, overlays, ready };
}

describe("minimize-to-tray routing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    electron.windows.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the overlay when showOnMinimize is called and conditions are met", async () => {
    const { manager, overlays, ready } = setup();
    expect(overlays()).toHaveLength(0);
    // simulate the tray-minimize path calling showOnMinimize
    manager.showOnMinimize();
    await vi.advanceTimersByTimeAsync(50);
    // overlay window may or may not exist yet (depends on warm state), but if it does
    // it should be visible after content is ready
    const [overlay] = overlays();
    expect(overlay).toBeDefined();
    ready(overlay);
    expect(overlay.isVisible()).toBe(true);
  });

  it("does not auto-open the overlay when autoShowOnMinimize setting is off", async () => {
    const { manager, overlays } = setup();
    (manager as any).autoShowOnMinimize = false;
    manager.showOnMinimize();
    await vi.advanceTimersByTimeAsync(100);
    expect(overlays()).toHaveLength(0);
  });

  it("does not auto-open the overlay when disabled is false", async () => {
    const { manager, overlays } = setup();
    (manager as any).enabled = false;
    manager.showOnMinimize();
    await vi.advanceTimersByTimeAsync(100);
    expect(overlays()).toHaveLength(0);
  });
});