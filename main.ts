// news-image-20261122 — "The World in One Frame"
// Sums up 22 November 2026's world news in a single 1024x1024 image,
// drawn entirely in code: a hand-built PNG encoder, a 5x7 bitmap font,
// a dotted world map, and seven story panels. Node 22, stdlib only.
// Deterministic: the same input always produces identical bytes.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WIDTH = 1024;
const HEIGHT = 1024;

// ---------- PNG encoder (stdlib only) ----------

const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  const typeBuf = Buffer.from(type, "ascii");
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function encodePNG(rgba: Buffer, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = 1 + width * 4;
  const raw = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Canvas: a raw RGBA pixel buffer with shape helpers ----------

type RGBA = [number, number, number, number];

class Canvas {
  readonly width: number;
  readonly height: number;
  readonly pixels: Buffer;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
  }

  setPixel(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels[i] = c[0];
    this.pixels[i + 1] = c[1];
    this.pixels[i + 2] = c[2];
    this.pixels[i + 3] = c[3];
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.width + xx) * 4;
        this.pixels[i] = c[0];
        this.pixels[i + 1] = c[1];
        this.pixels[i + 2] = c[2];
        this.pixels[i + 3] = c[3];
      }
    }
  }

  fillCircle(cx: number, cy: number, r: number, c: RGBA): void {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) this.setPixel(x, y, c);
      }
    }
  }

  ring(cx: number, cy: number, r: number, t: number, c: RGBA): void {
    for (let y = cy - r - t; y <= cy + r + t; y++) {
      for (let x = cx - r - t; x <= cx + r + t; x++) {
        const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        if (d <= r + t / 2 && d >= r - t / 2) this.setPixel(x, y, c);
      }
    }
  }

  // Bresenham line.
  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.setPixel(x, y, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
}

// ---------- Palette ----------

const INK: RGBA = [11, 18, 32, 255]; // deep navy paper
const PANEL: RGBA = [17, 28, 46, 255]; // raised panel
const PAPER: RGBA = [244, 241, 232, 255]; // warm off-white
const MUTED: RGBA = [154, 167, 184, 255]; // grey-blue
const FAINT: RGBA = [74, 90, 112, 255]; // dim line
const GOLD: RGBA = [232, 179, 60, 255]; // masthead accent
const RED: RGBA = [228, 87, 46, 255]; // conflict
const TEAL: RGBA = [46, 196, 182, 255]; // climate / deals
const SKY: RGBA = [96, 165, 250, 255]; // diplomacy
const ROSE: RGBA = [244, 114, 182, 255]; // markets
const LIME: RGBA = [163, 230, 53, 255]; // culture

// ---------- 5x7 bitmap font, hand-drawn (part 1: A-M) ----------
// Each glyph is 7 rows of 5 cells; "1" is ink, "0" is empty.

const FONT: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
};

// ---------- 5x7 bitmap font, hand-drawn (part 2: N-Z, digits, punctuation) ----------

Object.assign(FONT, {
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "%": ["11001", "10010", "00100", "01000", "01001", "10011", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
});

// ---------- Text rendering ----------

function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0;
  return text.length * 6 * scale - scale;
}

function drawText(cv: Canvas, text: string, x: number, y: number, scale: number, color: RGBA): void {
  const upper = text.toUpperCase();
  let cx = x;
  for (const ch of upper) {
    const glyph = FONT[ch] ?? FONT[" "];
    for (let r = 0; r < 7; r++) {
      const row = glyph[r];
      for (let c = 0; c < 5; c++) {
        if (row[c] === "1") cv.fillRect(cx + c * scale, y + r * scale, scale, scale, color);
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(cv: Canvas, text: string, cx: number, y: number, scale: number, color: RGBA): void {
  drawText(cv, text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, color);
}

function wrapText(text: string, maxWidth: number, scale: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (textWidth(next, scale) <= maxWidth) {
      cur = next;
    } else {
      if (cur) lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------- Dotted world map, hand-drawn (48 x 20 cells) ----------
// "#" is land, "." is sea. Equirectangular: col 0 = 180W, row 0 = 75N.

const MAP: string[] = [
  "..############..###..........#################..",
  "..#############.####........###################.",
  "...############............####################.",
  "...###########..........#####.#################.",
  "....#########............#####.################.",
  "....########..............#####.##############..",
  ".....######................####.####.########...",
  "......####................###########.##.###....",
  ".......###..................#########.##.###....",
  "........##..................#########.##.###....",
  "............####............########.....####...",
  "............######...........######......###....",
  "............#####............#####......######..",
  "............#####.............####......######..",
  ".............####.............###.......#####...",
  ".............###.............##..........####...",
  ".............##...........................###...",
  "..............#.................................",
  "..............#.................................",
  "..............##................................",
];

const MAP_X = 56;
const MAP_Y = 128;
const CELL = 19;
const LAND: RGBA = [96, 116, 148, 255];

function mapPoint(col: number, row: number): [number, number] {
  return [MAP_X + col * CELL + 9, MAP_Y + row * CELL + 9];
}

// ---------- The seven stories of 22 November 2026 ----------

interface Story {
  n: number;
  tag: string;
  color: RGBA;
  title: string;
  detail: string;
  col: number;
  row: number;
}

const STORIES: Story[] = [
  {
    n: 1,
    tag: "CLIMATE",
    color: TEAL,
    title: "COP31 TALKS DRAG INTO OVERTIME",
    detail: "ANTALYA DEADLOCK OVER FOSSIL FUELS AS SUMMIT ENTERS DAY 2 OF EXTRA TIME.",
    col: 28,
    row: 6,
  },
  {
    n: 2,
    tag: "CONFLICT",
    color: RED,
    title: "IRAN STRIKES BAHRAIN SITE",
    detail: "TEHRAN HITS INDUSTRIAL SITE AND US NAVY POSITIONS AS GULF TENSIONS SPIKE.",
    col: 31,
    row: 7,
  },
  {
    n: 3,
    tag: "JUSTICE",
    color: GOLD,
    title: "EL CHAPO ISIDRO CAPTURED",
    detail: "CARTEL BOSS SEIZED IN SINALOA. 11 KILLED IN THE VIOLENCE THAT FOLLOWED.",
    col: 10,
    row: 7,
  },
  {
    n: 4,
    tag: "CONFLICT",
    color: RED,
    title: "RUSSIA HITS ZELENSKY HOMETOWN",
    detail: "MISSILE STRIKE ON KRYVYI RIH KILLS 2. UKRAINE HITS RUSSIAN SHIP IN THE BALTIC.",
    col: 28,
    row: 4,
  },
  {
    n: 5,
    tag: "DIPLOMACY",
    color: SKY,
    title: "TRUMP, XI AND PUTIN MEET",
    detail: "TRILATERAL SUMMIT IN SHENZHEN AGREES TO BEGIN TALKS ON NUCLEAR RISK REDUCTION.",
    col: 39,
    row: 8,
  },
  {
    n: 6,
    tag: "ECONOMY",
    color: ROSE,
    title: "AI SELL-OFF DRAGS STOCKS DOWN",
    detail: "DOW AND S&P 500 FALL INTO CORRECTION. S&P 500 DOWN 3.70% ON THE WEEK.",
    col: 11,
    row: 5,
  },
  {
    n: 7,
    tag: "TRADE",
    color: LIME,
    title: "EU AND INDONESIA SIGN TRADE DEAL",
    detail: "TEN YEARS OF TALKS END IN A DEAL BETWEEN BRUSSELS AND JAKARTA.",
    col: 42,
    row: 11,
  },
];

// ---------- Layout ----------

function drawStory(cv: Canvas, s: Story, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, PANEL);
  cv.fillRect(x, y, 6, h, s.color);
  // Number badge.
  cv.fillCircle(x + 30, y + 24, 13, s.color);
  drawText(cv, String(s.n), x + 30 - 5, y + 24 - 7, 2, PAPER);
  // Tag.
  drawText(cv, s.tag, x + 52, y + 12, 1, s.color);
  // Headline, wrapped.
  const titleLines = wrapText(s.title, w - 52 - 12, 2);
  titleLines.forEach((line, i) => {
    drawText(cv, line, x + 52, y + 28 + i * 16, 2, PAPER);
  });
  // Detail, wrapped.
  const detailY = y + 28 + titleLines.length * 16 + 6;
  const detailLines = wrapText(s.detail, w - 52 - 12, 1);
  detailLines.forEach((line, i) => {
    drawText(cv, line, x + 52, detailY + i * 9, 1, MUTED);
  });
}

function draw(): Canvas {
  const cv = new Canvas(WIDTH, HEIGHT);
  cv.fillRect(0, 0, WIDTH, HEIGHT, INK);

  // Masthead.
  drawTextCentered(cv, "THE WORLD IN ONE FRAME", WIDTH / 2, 26, 4, PAPER);
  drawTextCentered(cv, "SUNDAY, 22 NOVEMBER 2026 . 7 STORIES, ONE PLANET", WIDTH / 2, 78, 2, GOLD);
  cv.fillRect(40, 104, WIDTH - 80, 3, GOLD);

  // Map label and dotted world map.
  drawText(cv, "WHERE IT HAPPENED", MAP_X, 110, 1, MUTED);
  for (let r = 0; r < MAP.length; r++) {
    for (let c = 0; c < MAP[r].length; c++) {
      if (MAP[r][c] === "#") {
        cv.fillCircle(MAP_X + c * CELL + 9, MAP_Y + r * CELL + 9, 4, LAND);
      }
    }
  }
  // Numbered markers on the map.
  for (const s of STORIES) {
    const [mx, my] = mapPoint(s.col, s.row);
    cv.fillCircle(mx, my, 12, s.color);
    cv.ring(mx, my, 12, 2, PAPER);
    drawText(cv, String(s.n), mx - 5, my - 7, 2, PAPER);
  }

  // Story panels: 4 left, 3 right.
  const panelW = 456;
  const panelH = 94;
  const gap = 6;
  const top = 528;
  for (let i = 0; i < STORIES.length; i++) {
    const col = i < 4 ? 0 : 1;
    const row = i < 4 ? i : i - 4;
    const x = 40 + col * (panelW + 32);
    const y = top + row * (panelH + gap);
    drawStory(cv, STORIES[i], x, y, panelW, panelH);
  }

  // Footer ticker.
  cv.fillRect(40, 936, WIDTH - 80, 2, GOLD);
  drawTextCentered(
    cv,
    "S&P 500 -3.70% . BRENT CRUDE $89.95 . GTA VI $3.8BN IN ONE DAY . INDONESIA FACTORY FIRE: 3 DEAD, 36 MISSING",
    WIDTH / 2,
    952,
    1,
    PAPER,
  );
  drawTextCentered(cv, "DRAWN ENTIRELY BY CODE . NO PHOTOGRAPHS . 22 NOVEMBER 2026", WIDTH / 2, 976, 1, MUTED);

  return cv;
}

function main(): void {
  const cv = draw();
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), encodePNG(cv.pixels, WIDTH, HEIGHT));
}

main();
