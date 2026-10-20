// Справочник ниш: что искать в Яндексе, какими тегами искать в OSM, по каким
// словам проверять категорию и что предлагать клиенту. Любую нишу можно
// ввести вручную — для неё строится универсальный вариант (customNiche).

/** Пункт предложения в двух формах: «услуги и цены» / «услугами и ценами». */
export interface OfferItem {
  nom: string;
  instr: string;
}

export interface NicheSpec {
  key: string;
  label: string; // «Барбершопы» — как в меню
  singular: string; // «барбершоп» — как в карточке
  accusative: string; // «ваш барбершоп» — для текста предложения
  query: string; // текст запроса в Яндекс
  keywords: string[]; // основы слов для проверки категории/названия
  osmFilters: string[]; // фильтры Overpass без bbox, например ["shop"="hairdresser"]
  offer: OfferItem[];
}

const item = (nom: string, instr: string): OfferItem => ({ nom, instr });

export const NICHE_PRESETS: NicheSpec[] = [
  {
    key: "barbershop",
    label: "Барбершопы",
    singular: "барбершоп",
    accusative: "ваш барбершоп",
    query: "барбершоп",
    // «парикмахерская» — не барбершоп: такие точки остаются в выдаче, но без балла за нишу
    keywords: ["барбер", "barber"],
    // только мужские парикмахерские: все парикмахерские Москвы упираются в лимит выдачи
    osmFilters: [
      '["shop"="hairdresser"]["hairdresser"="barber"]',
      '["shop"="hairdresser"]["male"="yes"]',
      '["shop"="hairdresser"]["name"~"барбер|barber",i]',
    ],
    offer: [
      item("услуги и цены", "услугами и ценами"),
      item("мастера", "мастерами"),
      item("фото работ", "фотографиями"),
      item("карта", "картой"),
      item("кнопка записи", "кнопкой записи"),
    ],
  },
  {
    key: "beauty",
    label: "Салоны красоты",
    singular: "салон красоты",
    accusative: "ваш салон красоты",
    query: "салон красоты",
    keywords: ["салон красоты", "красот", "beauty", "маникюр", "ногт", "косметолог"],
    osmFilters: ['["shop"="beauty"]'],
    offer: [
      item("каталог услуг с ценами", "каталогом услуг и ценами"),
      item("мастера", "мастерами"),
      item("портфолио", "портфолио"),
      item("отзывы", "отзывами"),
      item("онлайн-запись", "онлайн-записью"),
    ],
  },
  {
    key: "dentistry",
    label: "Стоматологии",
    singular: "стоматология",
    accusative: "вашу стоматологию",
    query: "стоматология",
    keywords: ["стоматолог", "dental", "дент"],
    osmFilters: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
    offer: [
      item("услуги и цены", "услугами и ценами"),
      item("врачи", "врачами"),
      item("лицензии и документы", "лицензиями и документами"),
      item("отзывы", "отзывами"),
      item("запись на приём", "записью на приём"),
    ],
  },
  {
    key: "autoservice",
    label: "Автосервисы",
    singular: "автосервис",
    accusative: "ваш автосервис",
    query: "автосервис",
    keywords: ["автосервис", "автотехцентр", "авторемонт", "ремонт авто", "шиномонтаж"],
    osmFilters: ['["shop"="car_repair"]'],
    offer: [
      item("перечень работ и цены", "перечнем работ и ценами"),
      item("запрос расчёта стоимости", "запросом расчёта стоимости"),
      item("фото работ", "фотографиями работ"),
      item("карта", "картой"),
      item("форма заявки", "формой заявки"),
    ],
  },
  {
    key: "phone_repair",
    label: "Ремонт телефонов",
    singular: "сервис по ремонту телефонов",
    accusative: "ваш сервис по ремонту телефонов",
    query: "ремонт телефонов",
    keywords: ["ремонт телефон", "ремонт смартфон", "сервисный центр", "ремонт электрон", "ремонт мобил"],
    osmFilters: ['["craft"="electronics_repair"]', '["shop"="mobile_phone"]["repair"]'],
    offer: [
      item("прайс на ремонт по моделям", "прайсом на ремонт по моделям"),
      item("форма заявки", "формой заявки"),
      item("гарантия и сроки", "гарантией и сроками"),
      item("отзывы", "отзывами"),
      item("карта", "картой"),
    ],
  },
  {
    key: "cafe",
    label: "Кафе и кофейни",
    singular: "кафе",
    accusative: "ваше кафе",
    query: "кафе",
    keywords: ["кафе", "кофейн", "кофе", "coffee", "бистро"],
    osmFilters: ['["amenity"="cafe"]'],
    offer: [
      item("меню с ценами", "меню и ценами"),
      item("фото", "фотографиями"),
      item("бронирование столов", "бронированием столов"),
      item("доставка и самовывоз", "доставкой и самовывозом"),
      item("карта", "картой"),
    ],
  },
  {
    key: "fitness",
    label: "Фитнес-студии",
    singular: "фитнес-студия",
    accusative: "вашу фитнес-студию",
    query: "фитнес-студия",
    keywords: ["фитнес", "спортзал", "тренаж", "йога", "пилатес", "fitness", "gym"],
    osmFilters: ['["leisure"="fitness_centre"]'],
    offer: [
      item("расписание", "расписанием"),
      item("тренеры", "тренерами"),
      item("абонементы и цены", "абонементами и ценами"),
      item("заявка на пробное занятие", "заявкой на пробное занятие"),
      item("карта", "картой"),
    ],
  },
  {
    key: "flowers",
    label: "Цветочные магазины",
    singular: "цветочный магазин",
    accusative: "ваш цветочный магазин",
    query: "цветочный магазин",
    keywords: ["цвет", "флорист", "букет"],
    osmFilters: ['["shop"="florist"]'],
    offer: [
      item("каталог букетов с ценами", "каталогом букетов и ценами"),
      item("заказ онлайн", "заказом онлайн"),
      item("доставка", "условиями доставки"),
      item("отзывы", "отзывами"),
      item("контакты", "контактами"),
    ],
  },
];

const DEFAULT_OFFER: OfferItem[] = [
  item("услуги и цены", "услугами и ценами"),
  item("фото работ", "фотографиями работ"),
  item("отзывы", "отзывами"),
  item("карта и контакты", "картой и контактами"),
  item("форма заявки", "формой заявки"),
];

export const CITY_PRESETS = ["Москва", "Санкт-Петербург", "Казань", "Екатеринбург", "Новосибирск", "Нижний Новгород"];

/** Ниша по введённому тексту: ищет пресет, иначе строит универсальную. */
export function resolveNiche(input: string): NicheSpec {
  const text = input.trim().toLowerCase().replace(/ё/g, "е");
  const preset = NICHE_PRESETS.find(
    (n) =>
      n.label.toLowerCase() === text ||
      n.singular === text ||
      n.query === text ||
      n.keywords.some((k) => k.length >= 4 && text.includes(k))
  );
  return preset ?? customNiche(input);
}

// Слова о форме бизнеса, а не о нише: «магазин» есть и у цветочного, и у зоомагазина.
const GENERIC_WORDS = ["магазин", "салон", "студи", "центр", "сервис", "компани", "услуг", "мастерск", "агентств", "ремонт"];

export function customNiche(input: string): NicheSpec {
  const label = input.trim().replace(/\s+/g, " ");
  const words = label
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 4);
  // «Магазин игрушек» ищем по «игрушек»; если общие все слова («Салоны») — по ним, иначе искать нечем.
  const specific = words.filter((w) => !GENERIC_WORDS.some((g) => w.startsWith(g)));
  // Основы слов: «автомойки» → «автомо», чтобы ловить разные окончания.
  const keywords = (specific.length ? specific : words).map((w) => w.slice(0, Math.max(4, w.length - 2)));
  return {
    key: "custom",
    label: label.charAt(0).toUpperCase() + label.slice(1),
    singular: label.toLowerCase(),
    accusative: "ваш бизнес",
    query: label.toLowerCase(),
    keywords,
    osmFilters: [], // своя ниша: OSM ищет по основам слов в названиях заведений (buildOverpassQuery)
    offer: DEFAULT_OFFER,
  };
}

/** Совпадает ли бизнес с нишей по категориям или названию. */
export function matchesNiche(niche: NicheSpec, categories: string[], name: string): boolean {
  const hay = [...categories, name].join(" ").toLowerCase().replace(/ё/g, "е");
  return niche.keywords.some((k) => hay.includes(k));
}
