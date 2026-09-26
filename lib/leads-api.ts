// Клиентские вызовы /api/leads/* для раздела «Клиенты» в Mini App.
// Авторизация — тем же apiFetch (Telegram initData), что и у задач.

import { apiFetch } from "./telegram-client";
import type { LeadDTO, LeadFilterDTO, LeadSearchDTO, LeadStatusDTO, LeadsMetaDTO } from "@/types/leads";

export function getLeadsMeta() {
  return apiFetch<LeadsMetaDTO>("/api/leads/meta");
}

export function setAvgCheck(avgCheck: number) {
  return apiFetch<LeadsMetaDTO>("/api/leads/meta", { method: "PATCH", body: JSON.stringify({ avgCheck }) });
}

export function listLeads(filter: LeadFilterDTO, query: string, page = 0) {
  const qs = new URLSearchParams({ filter, page: String(page) });
  if (query.trim()) qs.set("q", query.trim());
  return apiFetch<{ leads: LeadDTO[]; total: number; page: number; pageSize: number }>(`/api/leads?${qs}`);
}

export function getLead(id: string) {
  return apiFetch<{ lead: LeadDTO }>(`/api/leads/${id}`);
}

export function updateLead(id: string, input: { status?: LeadStatusDTO; saved?: boolean }) {
  return apiFetch<{ lead: LeadDTO }>(`/api/leads/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function createProposal(id: string) {
  return apiFetch<{ text: string; engine: string; note: string | null }>(`/api/leads/${id}/proposal`, { method: "POST" });
}

export type TaskFromLeadResponse =
  | { status: "created"; task: { id: string; title: string } }
  | { status: "exists"; task: { id: string; title: string; createdAt: string } };

/** «exists» — не ошибка, а вопрос пользователю: создать ли ещё одну задачу (force). */
export function createTaskFromLead(id: string, force = false) {
  return apiFetch<TaskFromLeadResponse>(`/api/leads/${id}/task`, { method: "POST", body: JSON.stringify({ force }) });
}

export type StartSearchInput =
  | { niche: string; city: string; requested: number; extra?: string | null; osmOnly?: boolean }
  | { fromSearchId: string; mode: "more" | "retry" };

export class SearchStartError extends Error {
  constructor(public reason: "busy" | "not_configured" | "other") {
    super(reason);
  }
}

export async function startSearch(input: StartSearchInput): Promise<LeadSearchDTO> {
  try {
    const { search } = await apiFetch<{ search: LeadSearchDTO }>("/api/leads/searches", { method: "POST", body: JSON.stringify(input) });
    return search;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    throw new SearchStartError(msg.includes("busy") ? "busy" : msg.includes("not_configured") ? "not_configured" : "other");
  }
}

export function getSearch(id: string) {
  return apiFetch<{ search: LeadSearchDTO; leads: LeadDTO[] }>(`/api/leads/searches/${id}`);
}

export function listSearches(page = 0) {
  return apiFetch<{ searches: LeadSearchDTO[]; total: number }>(`/api/leads/searches?page=${page}`);
}
