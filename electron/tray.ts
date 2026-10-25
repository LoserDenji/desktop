import { Tray, Menu, nativeImage, type BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type TrayAction = "play" | "pause" | "next" | "prev" | "show" | "hide" | "quit";

export interface TrayPlayerState {
  status?: string;
  track?: { title?: string; artist?: string } | null;
}

const PLAYING_STATUSES = new Set(["playing", "loading", "buffering"]);

function makeIcon(): ReturnType<typeof nativeImage.createFromDataURL> {
  // Load the app's 48x48 PNG icon and scale it down to 22px (Windows standard tray size).
  // Try multiple path resolutions to handle both dev and production environments.
  const candidatePaths = [
    // Dev/packaged app icon: the same public/icon.png the BrowserWindow uses
    path.join(process.env.VITE_PUBLIC ?? "", "icon.png"),
    // Production: APP_ROOT is set in main.ts
    path.join(process.env.APP_ROOT ?? "", "build", "icons", "48x48.png"),
    // Dev: __dirname points to dist-electron after Vite compiles
    path.join(__dirname, "build", "icons", "48x48.png"),
    // Alternative: one level up from dist-electron
    path.join(__dirname, "..", "build", "icons", "48x48.png"),
    // Absolute path from project root
    path.join(process.cwd(), "build", "icons", "48x48.png"),
  ];

  let img: ReturnType<typeof nativeImage.createFromPath> | null = null;
  let triedPaths: string[] = [];

  for (const iconPath of candidatePaths) {
    triedPaths.push(iconPath);
    try {
      img = nativeImage.createFromPath(iconPath);
      if (img && !img.isEmpty()) {
        console.log(`[tray] loaded icon from: ${iconPath}`);
        break;
      }
    } catch (err) {
      // Try next path
    }
  }

  if (!img || img.isEmpty()) {
    console.warn(`[tray] could not load icon from any path:`, triedPaths);
    return fallbackCircleIcon();
  }

  // Resize to 22px
  try {
    img = img.resize({ width: 22, height: 22 });
    if (img.isEmpty()) return fallbackCircleIcon();
  } catch {}

  // Convert to bitmap to strip alpha channel (prevents transparency in tray)
  try {
    const bitmap = img.toBitmap();
    if (bitmap && bitmap.length > 0) {
      const opaque = nativeImage.createFromBitmap(bitmap, { width: 22, height: 22 });
      if (!opaque.isEmpty()) return opaque;
    }
  } catch {}

  // Fallback: use original
  return img;
}

function fallbackCircleIcon(): ReturnType<typeof nativeImage.createFromDataURL> {
  const size = 22;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="#1db954"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

export class TrayController {
  private tray: Tray | null = null;
  private hasTrack = false;
  private playing = false;
  private trackTitle = "";
  private trackArtist = "";
  private appliedTooltip = "";
  private visible = true;
  private appliedMenuKey: string | null = null;

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly send: (action: TrayAction) => void,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  update(state: TrayPlayerState | null | undefined) {
    this.hasTrack = Boolean(state?.track);
    this.playing = PLAYING_STATUSES.has(state?.status ?? "");
    this.trackTitle = state?.track?.title?.trim() ?? "";
    this.trackArtist = state?.track?.artist?.trim() ?? "";
    this.refresh();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.refresh();
  }

  show(): boolean {
    if (this.tray) return true;
    if (this.platform === "darwin") return false;
    try {
      this.tray = new Tray(makeIcon());
      this.tray.setContextMenu(this.buildMenu());
      this.tray.setToolTip(this.tooltip());
      this.tray.on("click", () => this.send("show"));
      this.appliedTooltip = this.tooltip();
      this.appliedMenuKey = this.menuKey();
    } catch (err) {
      console.warn("[tray] could not create tray:", err);
      this.tray = null;
    }
    return this.tray !== null;
  }

  hide() {
    if (!this.tray) return;
    try {
      this.tray.destroy();
    } catch {}
    this.tray = null;
    this.appliedTooltip = "";
    this.appliedMenuKey = null;
  }

  destroy() {
    this.hide();
  }

  refresh() {
    if (!this.tray) return;
    const tooltip = this.tooltip();
    if (tooltip !== this.appliedTooltip) {
      try {
        this.tray.setToolTip(tooltip);
        this.appliedTooltip = tooltip;
      } catch {}
    }
    const menuKey = this.menuKey();
    if (menuKey !== this.appliedMenuKey) {
      try {
        this.tray.setContextMenu(this.buildMenu());
        this.appliedMenuKey = menuKey;
      } catch {}
    }
  }

  private tooltip(): string {
    if (this.hasTrack && this.trackTitle) {
      const artist = this.trackArtist ? ` · ${this.trackArtist}` : "";
      return `Liner — ${this.trackTitle}${artist}`;
    }
    return "Liner";
  }

  private menuKey(): string {
    return `${this.hasTrack ? (this.playing ? "playing" : "paused") : "none"}-${this.visible ? "visible" : "hidden"}`;
  }

  private buildMenu() {
    const playing = this.playing;
    const hasTrack = this.hasTrack;
    return Menu.buildFromTemplate([
      {
        label: playing ? "Pause" : "Play",
        click: () => this.send(playing ? "pause" : "play"),
      },
      {
        label: "Next",
        enabled: hasTrack,
        click: () => this.send("next"),
      },
      {
        label: "Previous",
        enabled: hasTrack,
        click: () => this.send("prev"),
      },
      { type: "separator" },
      {
        label: this.visible ? "Hide Liner" : "Show Liner",
        click: () => this.send(this.visible ? "hide" : "show"),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => this.send("quit"),
      },
    ]);
  }
}
