import type { Adventure, GameState, Room } from "../world/schema.js";

/**
 * Renders the `/map` command: an ASCII layout of authored rooms, connected by
 * their exits, with the player (`@`) and any characters shown in whichever
 * room they currently occupy.
 *
 * Rooms are placed on a grid by walking exits breadth-first from the player's
 * room: compass directions (n/s/e/w and diagonals) move within the current
 * level, `up`/`down` move to an adjacent level (its own flat grid, rendered
 * separately) so a hub room with both compass and vertical exits doesn't fight
 * over the same axis. The first exit to reach a room wins its cell (falling
 * back to the nearest free cell on a collision); anything left over — a
 * direction with no spatial meaning ("in", "a brass door"), or an edge that
 * doesn't land where its direction implies — is listed in a legend instead of
 * drawn as a grid line.
 */

type Delta = { dx: number; dy: number };

const COMPASS_DELTAS: Record<string, Delta> = {
  north: { dx: 0, dy: -1 },
  n: { dx: 0, dy: -1 },
  south: { dx: 0, dy: 1 },
  s: { dx: 0, dy: 1 },
  east: { dx: 1, dy: 0 },
  e: { dx: 1, dy: 0 },
  west: { dx: -1, dy: 0 },
  w: { dx: -1, dy: 0 },
  northeast: { dx: 1, dy: -1 },
  ne: { dx: 1, dy: -1 },
  northwest: { dx: -1, dy: -1 },
  nw: { dx: -1, dy: -1 },
  southeast: { dx: 1, dy: 1 },
  se: { dx: 1, dy: 1 },
  southwest: { dx: -1, dy: 1 },
  sw: { dx: -1, dy: 1 },
};

const VERTICAL_DELTAS: Record<string, number> = {
  up: -1,
  u: -1,
  down: 1,
  d: 1,
};

interface Point {
  x: number;
  y: number;
  z: number;
}

/** Nearest unoccupied (x, y) cell on level `z`, searching outward ring by
 * ring. Two exits from the same room can converge on the same cell (a cycle,
 * or two directions that happen to point the same way); the second room still
 * needs *somewhere* to go rather than silently overwriting the first. */
function findFreeCell(occupied: Set<string>, z: number, x: number, y: number): Point {
  const key = (cx: number, cy: number) => `${z}:${cx},${cy}`;
  if (!occupied.has(key(x, y))) return { x, y, z };
  for (let r = 1; r < 64; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = x + dx;
        const cy = y + dy;
        if (!occupied.has(key(cx, cy))) return { x: cx, y: cy, z };
      }
    }
  }
  return { x, y, z };
}

/** Breadth-first placement: first exit to reach a room fixes its cell. */
function layoutRooms(rooms: Room[], startId: string): Map<string, Point> {
  const byId = new Map(rooms.map((r) => [r.id, r]));
  if (!byId.has(startId)) return new Map();

  const positions = new Map<string, Point>([[startId, { x: 0, y: 0, z: 0 }]]);
  const occupied = new Set<string>(["0:0,0"]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    const room = byId.get(id)!;
    const pos = positions.get(id)!;
    for (const [dir, targetId] of Object.entries(room.exits ?? {})) {
      if (!byId.has(targetId) || positions.has(targetId)) continue;
      const key = dir.trim().toLowerCase();
      const compass = COMPASS_DELTAS[key];
      const dz = VERTICAL_DELTAS[key];
      let cell: Point;
      if (compass) {
        cell = findFreeCell(occupied, pos.z, pos.x + compass.dx, pos.y + compass.dy);
      } else if (dz !== undefined) {
        cell = findFreeCell(occupied, pos.z + dz, pos.x, pos.y);
      } else {
        continue; // non-spatial direction — resolved in the legend, not placed
      }
      positions.set(targetId, cell);
      occupied.add(`${cell.z}:${cell.x},${cell.y}`);
      queue.push(targetId);
    }
  }
  return positions;
}

/** The room BFS placement should start from: the player's current room if
 * it's a real one, else the adventure's declared start, else the first room. */
function resolveStartId(rooms: Room[], adventure: Adventure, location: string | null): string {
  if (location && rooms.some((r) => r.id === location)) return location;
  return adventure.start.room ?? rooms[0]!.id;
}

export interface MapRoom {
  id: string;
  name: string;
  /** grid position; omitted if no directional exit reaches this room */
  x?: number;
  y?: number;
  /** 0 = the level containing the start room; negative is "up", positive "down" */
  level?: number;
  exits: Record<string, string>;
}

export interface MapModel {
  title: string;
  rooms: MapRoom[];
}

/**
 * The structured, adventure-authored counterpart to {@link buildMap}: every
 * room's exits plus its computed grid position, meant to be serialized (e.g.
 * to `map.yaml`) rather than printed. Unlike `buildMap`, this reflects the
 * adventure as authored — it isn't parameterized by a live {@link GameState}.
 */
export function buildMapModel(adventure: Adventure): MapModel {
  const rooms = adventure.entities?.rooms ?? [];
  const positions =
    rooms.length === 0 ? new Map<string, Point>() : layoutRooms(rooms, resolveStartId(rooms, adventure, null));

  return {
    title: adventure.meta.title,
    rooms: rooms.map((room) => {
      const p = positions.get(room.id);
      return {
        id: room.id,
        name: room.name,
        ...(p ? { x: p.x, y: p.y, level: p.z } : {}),
        exits: { ...(room.exits ?? {}) },
      };
    }),
  };
}

/** " @" / " (Grimble)" / " @ (Grimble, Rex)" — whoever is standing here. */
function occupantSuffix(adventure: Adventure, state: GameState, roomId: string): string {
  let suffix = "";
  if (state.location === roomId) suffix += " @";
  const names = (adventure.entities?.characters ?? [])
    .filter((c) => (state.characters[c.id]?.location ?? c.location) === roomId)
    .map((c) => c.name);
  if (names.length) suffix += ` (${names.join(", ")})`;
  return suffix;
}

function cellLabel(adventure: Adventure, state: GameState, room: Room): string {
  const name = room.name.length > 24 ? `${room.name.slice(0, 23)}…` : room.name;
  return `${name}${occupantSuffix(adventure, state, room.id)}`;
}

/** Render one level's rooms as a flat grid of boxes joined by connector lines. */
function renderLevel(
  roomIds: string[],
  positions: Map<string, Point>,
  byId: Map<string, Room>,
  connectors: Set<string>,
  adventure: Adventure,
  state: GameState,
): string[] {
  const xs = roomIds.map((id) => positions.get(id)!.x);
  const ys = roomIds.map((id) => positions.get(id)!.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX + 1;
  const height = Math.max(...ys) - minY + 1;

  const grid: (string | undefined)[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => undefined),
  );
  for (const id of roomIds) {
    const p = positions.get(id)!;
    grid[p.y - minY]![p.x - minX] = id;
  }

  const colWidths = Array.from({ length: width }, (_, x) => {
    let max = 3;
    for (let y = 0; y < height; y++) {
      const id = grid[y]![x];
      if (id) max = Math.max(max, cellLabel(adventure, state, byId.get(id)!).length);
    }
    return max;
  });

  const z = positions.get(roomIds[0]!)!.z;
  const hasConnector = (ax: number, ay: number, bx: number, by: number) =>
    connectors.has(`${z}:${ax},${ay}->${bx},${by}`) || connectors.has(`${z}:${bx},${by}->${ax},${ay}`);

  const blockWidth = (x: number) => colWidths[x]! + 4; // "[ " + label + " ]"
  const GAP = 3;

  const lines: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const id = grid[y]![x];
      row +=
        id !== undefined
          ? `[ ${cellLabel(adventure, state, byId.get(id)!).padEnd(colWidths[x]!)} ]`
          : " ".repeat(blockWidth(x));
      if (x < width - 1) {
        const gx = x + minX;
        const gy = y + minY;
        row += hasConnector(gx, gy, gx + 1, gy) ? "-".repeat(GAP) : " ".repeat(GAP);
      }
    }
    lines.push(row.trimEnd());

    if (y === height - 1) continue;

    let connectorRow = "";
    for (let x = 0; x < width; x++) {
      const gx = x + minX;
      const gy = y + minY;
      const bw = blockWidth(x);
      const vertical = hasConnector(gx, gy, gx, gy + 1);
      const mid = Math.floor(bw / 2);
      connectorRow += vertical ? " ".repeat(mid) + "|" + " ".repeat(bw - mid - 1) : " ".repeat(bw);
      if (x < width - 1) {
        const southeast = hasConnector(gx, gy, gx + 1, gy + 1);
        const southwest = hasConnector(gx + 1, gy, gx, gy + 1);
        const diag = southeast && southwest ? "X" : southeast ? "\\" : southwest ? "/" : " ";
        connectorRow += diag.padEnd(GAP);
      }
    }
    if (connectorRow.trim().length > 0) lines.push(connectorRow.trimEnd());
  }
  return lines;
}

function levelHeading(z: number): string {
  if (z === 0) return "Main level";
  if (z < 0) return `${-z} level${-z === 1 ? "" : "s"} up`;
  return `${z} level${z === 1 ? "" : "s"} down`;
}

export function buildMap(adventure: Adventure, state: GameState): string {
  const rooms = adventure.entities?.rooms ?? [];
  if (rooms.length === 0) return "No rooms authored for this adventure.";

  const positions = layoutRooms(rooms, resolveStartId(rooms, adventure, state.location));
  const byId = new Map(rooms.map((r) => [r.id, r]));

  // Every exit, classified as a drawable (same-level, compass) grid connector
  // or a legend line — including every up/down edge, since a flat per-level
  // grid can't draw a line between levels.
  const legend: string[] = [];
  const connectors = new Set<string>(); // "z:x,y->x2,y2"

  for (const room of rooms) {
    const from = positions.get(room.id);
    for (const [dir, targetId] of Object.entries(room.exits ?? {})) {
      const target = byId.get(targetId);
      const compass = COMPASS_DELTAS[dir.trim().toLowerCase()];
      const to = positions.get(targetId);
      const isGridEdge =
        !!compass &&
        !!from &&
        !!to &&
        from.z === to.z &&
        to.x - from.x === compass.dx &&
        to.y - from.y === compass.dy;
      if (isGridEdge) {
        connectors.add(`${from.z}:${from.x},${from.y}->${to!.x},${to!.y}`);
      } else {
        const destLabel = target ? target.name : `${targetId} (unmapped)`;
        legend.push(`  ${room.name} --${dir}--> ${destLabel}`);
      }
    }
  }

  if (positions.size === 0) {
    // Shouldn't happen (startId is always a real room), but stay defensive.
    return "No rooms could be placed on the map.";
  }

  const byLevel = new Map<number, string[]>();
  for (const [id, p] of positions) {
    const list = byLevel.get(p.z) ?? [];
    list.push(id);
    byLevel.set(p.z, list);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);

  const out = [`Map — ${adventure.meta.title}`];
  for (const z of levels) {
    out.push("", `-- ${levelHeading(z)} --`);
    out.push(...renderLevel(byLevel.get(z)!, positions, byId, connectors, adventure, state));
  }

  const orphans = rooms.filter((r) => !positions.has(r.id));
  if (orphans.length) {
    out.push("", "Other rooms (no direct path from here):");
    for (const r of orphans) {
      out.push(`  ${r.name}${occupantSuffix(adventure, state, r.id)}`);
    }
  }

  if (legend.length) {
    out.push("", "Other connections:");
    out.push(...legend);
  }

  out.push("", "@ = you");

  return out.join("\n");
}
