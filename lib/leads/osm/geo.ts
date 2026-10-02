// Геометрия для локального поиска: попадает ли точка в контур города/региона.
// Контур — GeoJSON Polygon / MultiPolygon от Nominatim (координаты [lon, lat]).

type Ring = [number, number][];

export interface AreaGeometry {
  type: "Polygon" | "MultiPolygon";
  coordinates: Ring[] | Ring[][];
}

function inRing(lat: number, lon: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Внешний контур минус дырки. */
function inPolygon(lat: number, lon: number, rings: Ring[]): boolean {
  if (!rings.length || !inRing(lat, lon, rings[0]!)) return false;
  return !rings.slice(1).some((hole) => inRing(lat, lon, hole));
}

export function pointInArea(lat: number, lon: number, g: AreaGeometry): boolean {
  if (g.type === "Polygon") return inPolygon(lat, lon, g.coordinates as Ring[]);
  return (g.coordinates as Ring[][]).some((poly) => inPolygon(lat, lon, poly));
}

export function isAreaGeometry(g: unknown): g is AreaGeometry {
  const t = (g as { type?: unknown } | null)?.type;
  return (t === "Polygon" || t === "MultiPolygon") && Array.isArray((g as { coordinates?: unknown }).coordinates);
}
