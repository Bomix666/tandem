// Поле «Дополнительно» из мастера поиска → понятные фильтры. Распознаём
// только явные формулировки; остальной текст сохраняется как есть и
// показывается в истории, но на отбор не влияет (и мы честно пишем об этом).

export interface SearchRequirements {
  noOwnSite: boolean; // «без сайта»
  excludeModern: boolean; // «без современного сайта», «с устаревшим сайтом»
  requirePhone: boolean;
  requireEmail: boolean;
  requireSocials: boolean;
}

export const NO_REQUIREMENTS: SearchRequirements = {
  noOwnSite: false,
  excludeModern: false,
  requirePhone: false,
  requireEmail: false,
  requireSocials: false,
};

export function parseRequirements(text?: string | null): SearchRequirements {
  const t = (text ?? "").toLowerCase().replace(/ё/g, "е");
  if (!t.trim()) return { ...NO_REQUIREMENTS };
  return {
    noOwnSite: /без\s+(собственного\s+|своего\s+)?сайта|нет\s+сайта|не\s+имеют\s+сайта/.test(t),
    excludeModern: /без\s+(современного|нормального|хорошего)\s+сайта|устаревш|старым\s+сайтом|плох\w*\s+сайт/.test(t),
    requirePhone: /телефон/.test(t),
    requireEmail: /e-?mail|почт|емейл|имейл/.test(t),
    requireSocials: /соцсет|инстаграм|instagram|вконтакте|\bвк\b|\bvk\b|телеграм|telegram/.test(t),
  };
}

export function describeRequirements(r: SearchRequirements): string[] {
  const out: string[] = [];
  if (r.noOwnSite) out.push("только бизнесы без собственного сайта");
  if (r.excludeModern) out.push("исключаю бизнесы с современным сайтом");
  if (r.requirePhone) out.push("нужен публичный телефон");
  if (r.requireEmail) out.push("нужен публичный email");
  if (r.requireSocials) out.push("нужны соцсети");
  return out;
}
