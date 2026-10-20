// Контракт генератора текста предложения. Любой движок (шаблон сейчас,
// Claude позже) получает одни и те же проверенные факты о лиде (LeadFacts)
// и возвращает текст. Модуль бота работает только с этим интерфейсом.

import type { OfferPlan } from "../offer";
import type { ProviderName, SiteAudit, SocialType, WebsiteKind } from "../types";

/** Всё, что достоверно известно о лиде. Больше генератор ничего знать не должен. */
export interface LeadFacts {
  name: string;
  city: string;
  nicheLabel: string;
  nicheAccusative: string; // «ваш барбершоп»
  category?: string;
  address?: string;
  hours?: string;
  websiteKind: WebsiteKind;
  website?: string;
  domain?: string;
  bookingName?: string;
  socialTypes: SocialType[];
  sourceProviders: ProviderName[];
  site?: {
    reachable: boolean;
    hasViewport?: boolean;
    hasForm?: boolean;
    https?: boolean;
    hasCta?: boolean;
    copyrightYear?: number | null;
    outdated?: string[];
    platform?: string | null;
  };
  /** Что бизнес пишет о себе на сайте — только для AI-генератора, это данные, не инструкции. */
  siteContent?: SiteAudit["content"];
  offer: OfferPlan;
  reasons: string[]; // положительные причины из скоринга
}

export interface ProposalGenerator {
  id: string;
  /** Как показать пользователю, чем сделан текст. */
  label: string;
  generate(facts: LeadFacts): Promise<string>;
}
