// Импорт локальной копии OpenStreetMap (основной источник бизнесов для поиска клиентов).
//
//   Geofabrik *.osm.pbf  →  osmium tags-filter (только бизнесы)  →  osmium export (geojsonseq)
//   →  таблица OsmPlace (upsert пачками)  →  удаление объектов, которых больше нет в выгрузке.
//
// Запуск:
//   npx tsx scripts/osm-import.ts --once         импортировать сейчас, если выгрузка обновилась
//   npx tsx scripts/osm-import.ts --once --force импортировать сейчас в любом случае
//   npx tsx scripts/osm-import.ts --loop         сервис: проверять раз в OSM_CHECK_HOURS часов,
//                                                обновлять, если данным больше OSM_MAX_AGE_DAYS дней
//
// Переменные окружения:
//   OSM_REGIONS     регионы Geofabrik через запятую: "russia" (по умолчанию),
//                   "russia/central-fed-district", полный URL или путь к локальному .pbf
//   OSM_DATA_DIR    куда качать и где держать временные файлы (по умолчанию ./data/osm)
//   OSM_BASE_URL    зеркало Geofabrik (по умолчанию https://download.geofabrik.de)
//
// Нужна утилита osmium (osmium-tool) — она есть в образе Dockerfile.osm.
// Данные © участники OpenStreetMap, лицензия ODbL.

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { PrismaClient } from "@prisma/client";
import { featureToPlace, osmiumFilterExpressions, type OsmPlaceRow } from "../lib/leads/osm/tags";

const prisma = new PrismaClient();

const REGIONS = (process.env.OSM_REGIONS || "russia").split(",").map((s) => s.trim()).filter(Boolean);
const DATA_DIR = path.resolve(process.env.OSM_DATA_DIR || "data/osm");
const BASE_URL = (process.env.OSM_BASE_URL || "https://download.geofabrik.de").replace(/\/$/, "");
const CHECK_HOURS = Number(process.env.OSM_CHECK_HOURS || 6);
const MAX_AGE_DAYS = Number(process.env.OSM_MAX_AGE_DAYS || 7);
const BATCH = 2000;
const USER_AGENT = "TandemLeads/1.0 (weekly OSM import)";

const args = new Set(process.argv.slice(2));
const force = args.has("--force");

function log(msg: string) {
  console.log(`[osm-import ${new Date().toISOString().slice(0, 19).replace("T", " ")}] ${msg}`);
}

interface Source {
  region: string;
  url: string | null; // null — локальный файл
  file: string;
}

function sourceFor(region: string): Source {
  if (/^https?:\/\//.test(region)) {
    return { region, url: region, file: path.join(DATA_DIR, path.basename(new URL(region).pathname)) };
  }
  if (region.endsWith(".pbf")) return { region, url: null, file: path.resolve(region) };
  const file = path.join(DATA_DIR, `${region.replace(/\//g, "_")}-latest.osm.pbf`);
  return { region, url: `${BASE_URL}/${region}-latest.osm.pbf`, file };
}

/** Дата выгрузки на сервере (Last-Modified) — по ней понимаем, обновилась ли она. */
async function remoteDate(src: Source): Promise<Date> {
  if (!src.url) return (await stat(src.file)).mtime;
  const res = await fetch(src.url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${src.url}: HTTP ${res.status}`);
  const lm = res.headers.get("last-modified");
  return lm ? new Date(lm) : new Date();
}

async function download(src: Source, date: Date): Promise<void> {
  if (!src.url) return;
  // уже скачанный файл той же даты не качаем повторно
  if (existsSync(src.file) && (await stat(src.file)).mtime.getTime() >= date.getTime()) {
    log(`${src.region}: файл уже скачан`);
    return;
  }
  const part = `${src.file}.part`;
  const res = await fetch(src.url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`${src.url}: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  log(`${src.region}: скачиваю ${total ? `${(total / 2 ** 30).toFixed(2)} ГБ` : ""} из ${src.url}`);
  let done = 0;
  let lastLog = Date.now();
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    done += chunk.length;
    if (Date.now() - lastLog > 30_000) {
      lastLog = Date.now();
      log(`${src.region}: ${(done / 2 ** 20).toFixed(0)} МБ${total ? ` (${Math.round((done / total) * 100)}%)` : ""}`);
    }
  });
  await pipeline(body, createWriteStream(part));
  if (total && done !== total) throw new Error(`${src.region}: скачано ${done} из ${total} байт`);
  await rename(part, src.file);
  // mtime = дата выгрузки, чтобы при следующем запуске не качать ту же самую
  await utimes(src.file, date, date);
}

function run(cmd: string, argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("error", (err) => reject(new Error(`${cmd}: ${err.message} — установлен ли osmium-tool?`)));
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${argv[0]} завершился с кодом ${code}`))));
  });
}

const UPSERT_SQL = `
INSERT INTO "OsmPlace" ("id", "name", "lat", "lon", "kinds", "tags", "phone", "website", "email", "hasContact", "importId", "updatedAt")
SELECT u."id", u."name", u."lat", u."lon", u."kinds", u."tags", u."phone", u."website", u."email", u."hasContact", $2, now()
FROM jsonb_to_recordset($1::jsonb) AS u(
  "id" text, "name" text, "lat" float8, "lon" float8, "kinds" text[], "tags" jsonb,
  "phone" text, "website" text, "email" text, "hasContact" boolean
)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name", "lat" = EXCLUDED."lat", "lon" = EXCLUDED."lon", "kinds" = EXCLUDED."kinds",
  "tags" = EXCLUDED."tags", "phone" = EXCLUDED."phone", "website" = EXCLUDED."website", "email" = EXCLUDED."email",
  "hasContact" = EXCLUDED."hasContact", "importId" = EXCLUDED."importId", "updatedAt" = now()`;

async function upsert(rows: Map<string, OsmPlaceRow>, importId: string) {
  if (!rows.size) return;
  await prisma.$executeRawUnsafe(UPSERT_SQL, JSON.stringify([...rows.values()]), importId);
}

/** Выгрузка региона → OsmPlace. Возвращает число загруженных объектов. */
async function importRegion(src: Source, importId: string): Promise<number> {
  const base = path.join(DATA_DIR, src.region.replace(/[^\w-]/g, "_"));
  const filtered = `${base}.business.osm.pbf`;
  const exported = `${base}.business.geojsonseq`;

  log(`${src.region}: отбираю бизнесы (osmium tags-filter)`);
  await run("osmium", ["tags-filter", src.file, ...osmiumFilterExpressions(), "-o", filtered, "--overwrite"]);
  log(`${src.region}: строю геометрию (osmium export)`);
  await run("osmium", [
    "export", filtered, "-f", "geojsonseq", "--add-unique-id=type_id", "--geometry-types=point,polygon",
    "-o", exported, "--overwrite",
  ]);

  log(`${src.region}: загружаю в базу`);
  let lines = 0;
  let places = 0;
  let batch = new Map<string, OsmPlaceRow>();
  const rl = createInterface({ input: createReadStream(exported, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    lines++;
    const row = featureToPlace(line);
    if (!row) continue;
    if (!batch.has(row.id)) places++;
    batch.set(row.id, row); // один объект может прийти дважды (точка + полигон) — берём последний
    if (batch.size >= BATCH) {
      await upsert(batch, importId);
      batch = new Map();
    }
    if (lines % 200_000 === 0) log(`${src.region}: обработано ${lines} объектов, бизнесов ${places}`);
  }
  await upsert(batch, importId);
  await rm(filtered, { force: true });
  await rm(exported, { force: true });
  log(`${src.region}: готово — ${places} бизнесов с названием`);
  return places;
}

async function lastDone() {
  return prisma.osmImport.findFirst({ where: { status: "DONE" }, orderBy: { finishedAt: "desc" } });
}

async function importAll(opts: { force: boolean }): Promise<void> {
  // импорт работает в одном контейнере: «зависшие» RUNNING — от прерванного запуска
  await prisma.osmImport.updateMany({
    where: { status: "RUNNING" },
    data: { status: "FAILED", finishedAt: new Date(), error: "прервано (перезапуск импорта)" },
  });

  await mkdir(DATA_DIR, { recursive: true });
  const sources = REGIONS.map(sourceFor);
  const dates = await Promise.all(sources.map(remoteDate));
  const sourceDate = new Date(Math.min(...dates.map((d) => d.getTime())));

  const prev = await lastDone();
  const sameRegions = prev && [...prev.regions].sort().join() === [...REGIONS].sort().join();
  if (!opts.force && prev && sameRegions && prev.sourceDate && prev.sourceDate.getTime() >= sourceDate.getTime()) {
    log(`данные актуальны (выгрузка от ${prev.sourceDate.toISOString().slice(0, 10)}), пропускаю`);
    return;
  }

  const imp = await prisma.osmImport.create({ data: { regions: REGIONS, status: "RUNNING", sourceDate } });
  log(`импорт ${imp.id}: ${REGIONS.join(", ")} (выгрузка от ${sourceDate.toISOString().slice(0, 10)})`);
  try {
    let places = 0;
    for (const [i, src] of sources.entries()) {
      await download(src, dates[i]!);
      places += await importRegion(src, imp.id);
    }
    // всё, что не пришло в этой выгрузке, — закрылось или перестало быть бизнесом
    const removed = await prisma.$executeRawUnsafe(`DELETE FROM "OsmPlace" WHERE "importId" <> $1`, imp.id);
    await prisma.$executeRawUnsafe(`ANALYZE "OsmPlace"`);
    const total = await prisma.osmPlace.count();
    await prisma.osmImport.update({
      where: { id: imp.id },
      data: { status: "DONE", places: total, finishedAt: new Date() },
    });
    log(`импорт ${imp.id} завершён: загружено ${places}, удалено устаревших ${removed}, всего в базе ${total}`);
  } catch (err) {
    const message = (err as Error).message.slice(0, 1000);
    await prisma.osmImport.update({ where: { id: imp.id }, data: { status: "FAILED", finishedAt: new Date(), error: message } });
    throw err;
  }
}

async function loop() {
  log(`сервис запущен: регионы ${REGIONS.join(", ")}, проверка раз в ${CHECK_HOURS} ч, обновление раз в ${MAX_AGE_DAYS} дн.`);
  let first = true;
  for (;;) {
    try {
      const prev = await lastDone();
      const age = prev?.finishedAt ? Date.now() - prev.finishedAt.getTime() : Infinity;
      if (age > MAX_AGE_DAYS * 86_400_000 || (first && force)) await importAll({ force: first && force });
      else log(`последний импорт ${Math.round(age / 3_600_000)} ч назад — обновление не нужно`);
    } catch (err) {
      log(`ошибка: ${(err as Error).message} — повторю при следующей проверке`);
    }
    first = false;
    await new Promise((r) => setTimeout(r, CHECK_HOURS * 3_600_000));
  }
}

async function main() {
  if (args.has("--loop")) await loop();
  else await importAll({ force });
}

main()
  .catch((err) => {
    log(`ошибка: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
