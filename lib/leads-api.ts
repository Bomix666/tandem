// Клиентские вызовы /api/leads/* для раздела «Клиенты» в Mini App.
// Авторизация — тем же apiFetch (Telegram initData), что и у задач.

import { apiFetch } from "./telegram-client";
import type {
  AnalyticsDTO,
  DashboardDTO,
  FollowUpDTO,
  LeadDTO,
  LeadFilterDTO,
  LeadSearchDTO,
  LeadStatusDTO,
  LeadsMetaDTO,
  OutreachChannelDTO,
  OutreachDTO,
  OutreachStatusDTO,
  SenderDTO,
} from "@/types/leads";

export function getLeadsMeta() {
  return apiFetch<LeadsMetaDTO>("/api/leads/meta");
}

export function setSender(sender: Partial<SenderDTO>) {
  return apiFetch<LeadsMetaDTO>("/api/leads/meta", { method: "PATCH", body: JSON.stringify({ sender }) });
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
  return apiFetch<{ text: string; subject: string | null; recipient: string | null; warnings: string[]; engine: string; note: string | null }>(
    `/api/leads/${id}/proposal`,
    { method: "POST" }
  );
}

export type TaskFromLeadResponse =
  | { status: "created"; task: { id: string; title: string } }
  | { status: "exists"; task: { id: string; title: string; createdAt: string } };

/** «exists» — не ошибка, а вопрос пользователю: создать ли ещё одну задачу (force). */
export function createTaskFromLead(id: string, force = false) {
  return apiFetch<TaskFromLeadResponse>(`/api/leads/${id}/task`, { method: "POST", body: JSON.stringify({ force }) });
}

export type StartSearchInput =
  | { niche: string; city: string; requested: number; extra?: string | null; source?: "osm" | "yandex" }
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

// ---------- Sales OS: дашборд, обращения, follow-up, аналитика ----------

export function getDashboard() {
  return apiFetch<{ dashboard: DashboardDTO }>("/api/leads/dashboard");
}

export function getAnalytics(period: 0 | 7 | 30) {
  return apiFetch<{ analytics: AnalyticsDTO }>(`/api/leads/analytics?period=${period}`);
}

/** «✨ Подготовить письмо» / «💬 Сообщение»: открыть черновик канала или создать его. */
export function prepareOutreach(leadId: string, channel: OutreachChannelDTO) {
  return apiFetch<{ outreach: OutreachDTO; reused: boolean }>(`/api/leads/${leadId}/outreach`, { method: "POST", body: JSON.stringify({ channel }) });
}

export function getOutreach(id: string) {
  return apiFetch<{ outreach: OutreachDTO }>(`/api/leads/outreach/${id}`);
}

export function listOutreach(status: OutreachStatusDTO, page = 0) {
  return apiFetch<{ counts: Record<OutreachStatusDTO, number>; items: OutreachDTO[]; total: number }>(`/api/leads/outreach?status=${status}&page=${page}`);
}

export function saveOutreachText(id: string, subject: string | null, body: string) {
  return apiFetch<{ outreach: OutreachDTO }>(`/api/leads/outreach/${id}`, { method: "PATCH", body: JSON.stringify({ subject, body }) });
}

export type OutreachAction = "regenerate" | "ready" | "send" | "sent" | "replied" | "rejected" | "client";

/** Действия с обращением. «send» — отправить с подключённой почты; «sent» — отметка, что отправил сам. */
export function outreachAction(id: string, action: OutreachAction) {
  return apiFetch<{ outreach: OutreachDTO }>(`/api/leads/outreach/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
}

export function discardOutreach(id: string) {
  return apiFetch<{ leadId: string }>(`/api/leads/outreach/${id}`, { method: "DELETE" });
}

export function setFollowUp(leadId: string, when: { days: number } | { at: string }, outreachId?: string | null) {
  return apiFetch<{ followUp: { taskId: string; at: string; created: boolean } }>(`/api/leads/${leadId}/followup`, {
    method: "POST",
    body: JSON.stringify({ ...when, outreachId: outreachId ?? null }),
  });
}

export function listFollowUps(page = 0) {
  return apiFetch<{ items: FollowUpDTO[]; total: number; counts: DashboardDTO["followUps"] }>(`/api/leads/followups?page=${page}`);
}

export type FollowUpClose = "replied" | "rejected" | "client" | "again" | "done";

export function followUpAction(taskId: string, action: { action: "snooze"; days: number } | { action: "close"; how: FollowUpClose }) {
  return apiFetch<{ followUp: FollowUpDTO | null }>(`/api/leads/followups/${taskId}`, { method: "POST", body: JSON.stringify(action) });
}
