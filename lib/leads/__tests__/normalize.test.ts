import { describe, expect, it } from "vitest";
import {
  addressInCity,
  classifyUrl,
  formatPhone,
  nameSimilarity,
  normalizeAddress,
  normalizeName,
  normalizePhone,
  socialFromHandle,
} from "../normalize";

describe("normalizePhone / formatPhone", () => {
  it("приводит российские номера к одному виду", () => {
    expect(normalizePhone("+7 (495) 123-45-67")).toBe("74951234567");
    expect(normalizePhone("8 495 123 45 67")).toBe("74951234567");
    expect(normalizePhone("4951234567")).toBe("74951234567");
  });
  it("отбрасывает добавочный номер", () => {
    expect(normalizePhone("+7 495 123-45-67 доб. 12")).toBe("74951234567");
  });
  it("не считает телефоном короткие числа", () => {
    expect(normalizePhone("123")).toBeNull();
  });
  it("форматирует для показа", () => {
    expect(formatPhone("74951234567")).toBe("+7 495 123-45-67");
  });
});

describe("normalizeName", () => {
  it("убирает кавычки, регистр и организационно-правовую форму", () => {
    expect(normalizeName("ООО «Black Barber»")).toBe("black barber");
    expect(normalizeName("Барбершоп «Ёж»")).toBe("барбершоп еж");
  });
});

describe("normalizeAddress", () => {
  it("адрес из Яндекса и из OSM совпадает", () => {
    expect(normalizeAddress("Россия, Москва, Тверская улица, 7", "Москва")).toBe(normalizeAddress("Тверская улица, 7"));
  });
  it("«ул. Тверская, д. 7» = «Тверская улица, 7»", () => {
    expect(normalizeAddress("ул. Тверская, д. 7")).toBe(normalizeAddress("Тверская улица, 7"));
  });
  it("проверяет принадлежность городу", () => {
    expect(addressInCity("Россия, Москва, Тверская улица, 7", "москва")).toBe(true);
    expect(addressInCity("Россия, Московская область, Химки", "Москва")).toBe(false);
  });
});

describe("classifyUrl", () => {
  it("собственный сайт", () => {
    expect(classifyUrl("blackbarber.ru")).toEqual({ kind: "own", url: "http://blackbarber.ru/", domain: "blackbarber.ru" });
  });
  it("разные сайты на общем хостинге — разные ключи для поиска дублей", () => {
    const a = classifyUrl("https://sites.google.com/view/barber-one/home");
    const b = classifyUrl("https://sites.google.com/view/barber-two");
    expect(a).toMatchObject({ kind: "own", domain: "sites.google.com/view/barber-one" });
    expect(b).toMatchObject({ kind: "own", domain: "sites.google.com/view/barber-two" });
  });
  it("соцсеть вместо сайта", () => {
    expect(classifyUrl("www.instagram.com/blackbarber")).toEqual({
      kind: "social",
      social: { type: "instagram", url: "https://instagram.com/blackbarber" },
    });
    expect(classifyUrl("https://taplink.cc/blackbarber")).toMatchObject({ kind: "social", social: { type: "taplink" } });
  });
  it("страница онлайн-записи", () => {
    expect(classifyUrl("https://n123.yclients.com/company/1")).toMatchObject({ kind: "booking", name: "YCLIENTS" });
  });
  it("справочники, кнопки «поделиться» и главные страницы соцсетей игнорируются", () => {
    expect(classifyUrl("https://yandex.ru/maps/org/1")).toEqual({ kind: "ignore" });
    expect(classifyUrl("https://vk.com/share.php?url=x")).toEqual({ kind: "ignore" });
    expect(classifyUrl("https://instagram.com/")).toEqual({ kind: "ignore" });
    expect(classifyUrl("javascript:void(0)")).toEqual({ kind: "ignore" });
  });
});

describe("socialFromHandle", () => {
  it("строит ссылку из имени аккаунта в OSM", () => {
    expect(socialFromHandle("instagram", "@blackbarber")).toEqual({ type: "instagram", url: "https://instagram.com/blackbarber" });
    expect(socialFromHandle("vk", "https://vk.com/club1")).toEqual({ type: "vk", url: "https://vk.com/club1" });
    expect(socialFromHandle("telegram", "плохое имя!")).toBeNull();
  });
});

describe("nameSimilarity", () => {
  it("одинаковые и похожие названия", () => {
    expect(nameSimilarity("Black Barber", "BLACK BARBER")).toBe(1);
    expect(nameSimilarity("Black Barber", "Барбершоп Black Barber")).toBeGreaterThan(0.5);
  });
  it("разные названия", () => {
    expect(nameSimilarity("Black Barber", "Цветы у дома")).toBeLessThan(0.2);
  });
});
