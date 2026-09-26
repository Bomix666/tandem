// Поддельные Яндекс/OSM/сайты для ручной проверки раздела «Клиенты» локально,
// без ключа Яндекса и без зависимости от перегруженных серверов OSM.
//   npx tsx scripts/dev-fake-sources.ts            # слушает 127.0.0.1:4455
// Затем запустить приложение с переменными, которые напечатает скрипт.

import { fakeSourcesEnv, startFakeSourcesServer } from "./lib/fake-sources";

async function main() {
  const port = Number(process.env.FAKE_SOURCES_PORT ?? 4455);
  const { state } = await startFakeSourcesServer(port);
  console.log(`Поддельные источники: http://127.0.0.1:${port}`);
  console.log("Переменные для приложения:");
  for (const [k, v] of Object.entries(fakeSourcesEnv(port))) console.log(`  ${k}=${v}`);
  console.log("Поиск по Москве/Казани вернёт тестовые бизнесы. Ctrl+C — остановить.");
  process.on("SIGINT", () => process.exit(0));
  void state;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
