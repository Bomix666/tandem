import { describe, expect, it } from "vitest";
import { redact } from "../redact";

// значения выдуманные — настоящие ключи и токены в тесты не попадают
describe("секреты не попадают в логи", () => {
  it("ключ в адресе, токен бота, Bearer", () => {
    expect(redact("GET https://search-maps.yandex.ru/v1/?apikey=00000000-test&text=x failed")).toBe("GET https://search-maps.yandex.ru/v1/?apikey=***&text=x failed");
    expect(redact("bot 1234567890:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA down")).toBe("bot ***:*** down");
    expect(redact("Authorization: Bearer test-0123456789abcdef")).toBe("Authorization: Bearer ***");
    expect(redact("обычный текст 12:30")).toBe("обычный текст 12:30");
  });
});
