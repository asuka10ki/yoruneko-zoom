export function normalizeRoomName(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value)
    .replace(/[\r\n\t]/g, "")
    .replace(/[ \u3000]+/g, " ")
    .trim();

  return normalized.length > 0 ? normalized : null;
}

export function normalizeRoomList(values: unknown[]): string[] {
  const rooms: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const room = normalizeRoomName(value);
    if (!room || seen.has(room)) {
      continue;
    }

    seen.add(room);
    rooms.push(room);
  }

  return rooms;
}
