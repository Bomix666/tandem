import { describe, expect, it } from "vitest";
import { resolveNiche } from "../niches";
import { pointInArea } from "../osm/geo";
import { centroid, featureToPlace, kindsOf, kindsForWords, osmIdFromUnique, osmiumFilterExpressions } from "../osm/tags";
import { nicheToSql } from "../providers/osm-local";

describe("импорт OSM: что считается бизнесом", () => {
  it("магазины, мастерские, медицина и коммерческие заведения — да; скамейки и госорганы — нет", () => {
    expect(kindsOf({ shop: "hairdresser" })).toEqual(["shop=hairdresser"]);
    expect(kindsOf({ amenity: "dentist", healthcare: "dentist" })).toEqual(["healthcare=dentist", "amenity=dentist"]);
    expect(kindsOf({ amenity: "bench" })).toEqual([]);
    expect(kindsOf({ office: "government" })).toEqual([]);
    expect(kindsOf({ shop: "vacant" })).toEqual([]);
    expect(osmiumFilterExpressions()).toContain("nwr/shop");
  });

  it("id из osmium: точки, линии и площадные объекты", () => {
    expect(osmIdFromUnique("n123")).toBe("node/123");
    expect(osmIdFromUnique("w5")).toBe("way/5");
    expect(osmIdFromUnique("a10")).toBe("way/5"); // чётный — линия
    expect(osmIdFromUnique("a11")).toBe("relation/5"); // нечётный — отношение
    expect(osmIdFromUnique("x1")).toBeNull();
  });

  it("строка geojsonseq → OsmPlace: центр полигона, контакты, нужные теги", () => {
    const line =
      "\x1e" +
      JSON.stringify({
        type: "Feature",
        id: "a246",
        geometry: { type: "Polygon", coordinates: [[[37, 55], [37.2, 55], [37.2, 55.2], [37, 55.2], [37, 55]]] },
        properties: { name: "Барбершоп Woodoo", shop: "hairdresser", male: "yes", "contact:phone": "+7 495 1", website: "woodoo.ru", building: "yes", "addr:street": "Невская" },
      });
    const p = featureToPlace(line)!;
    expect(p.id).toBe("way/123");
    expect(p.lat).toBeCloseTo(55.08, 2);
    expect(p).toMatchObject({ name: "Барбершоп Woodoo", kinds: ["shop=hairdresser"], phone: "+7 495 1", website: "woodoo.ru", hasContact: true });
    expect(p.tags).not.toHaveProperty("building");
    expect(p.tags["addr:street"]).toBe("Невская");
  });

  it("без названия или не бизнес — пропускается", () => {
    const f = (properties: object) => featureToPlace(JSON.stringify({ id: "n1", geometry: { type: "Point", coordinates: [37, 55] }, properties }));
    expect(f({ shop: "bakery" })).toBeNull();
    expect(f({ name: "Лавочка", amenity: "bench" })).toBeNull();
    expect(centroid({ type: "Point", coordinates: [37.5, 55.7] })).toEqual([55.7, 37.5]);
  });
});

describe("поиск по локальной копии", () => {
  it("граница города: точка внутри контура, дырки и мультиполигоны", () => {
    const square = [[37, 55], [38, 55], [38, 56], [37, 56], [37, 55]] as [number, number][];
    const hole = [[37.4, 55.4], [37.6, 55.4], [37.6, 55.6], [37.4, 55.6], [37.4, 55.4]] as [number, number][];
    const poly = { type: "Polygon" as const, coordinates: [square, hole] };
    expect(pointInArea(55.2, 37.2, poly)).toBe(true);
    expect(pointInArea(55.5, 37.5, poly)).toBe(false); // в дырке
    expect(pointInArea(56.5, 37.5, poly)).toBe(false);
    expect(pointInArea(55.5, 39.5, { type: "MultiPolygon", coordinates: [[square], [[[39, 55], [40, 55], [40, 56], [39, 56], [39, 55]]]] })).toBe(true);
  });

  it("фильтры ниши Overpass → SQL с параметрами", () => {
    const sql = nicheToSql(resolveNiche("Барбершопы"), 5)!;
    expect(sql.where).toContain('"kinds" @> ARRAY[$5]::text[]');
    expect(sql.where).toContain('"tags"->>$6 = $7');
    expect(sql.where).toContain('"name" ~* $');
    expect(sql.params.slice(0, 3)).toEqual(["shop=hairdresser", "hairdresser", "barber"]);
  });

  it("своя ниша: основы слов в названии + виды OSM с таким русским названием", () => {
    const sql = nicheToSql(resolveNiche("Автомойки"), 1)!;
    expect(sql.params[0]).toEqual(["%автомой%"]);
    expect(kindsForWords(["автомой"])).toContain("amenity=car_wash");
    expect(sql.where).toContain('"kinds" && $2::text[]');
  });

  it("своя ниша: «магазин» в названии ниши не тянет все цветочные и зоомагазины", () => {
    const sql = nicheToSql(resolveNiche("Магазин игрушек"), 1)!;
    expect(sql.params).toEqual([["%игруш%"]]); // без видов OSM: «Цветочный магазин» / «Зоомагазин» не подходят
  });
});
