import { apiFetch } from "./telegram-client";
import type { TaskDTO, PresenceDTO, ActivityDTO, WorkspaceDTO, UserDTO, CommentDTO, TaskStatus, Priority } from "@/types";

export type RecurrenceFrequency = "DAILY" | "WEEKDAYS" | "WEEKLY" | "MONTHLY" | "CUSTOM";

export function getOrCreateWorkspace() {
  return apiFetch<{ user: UserDTO; workspace: WorkspaceDTO }>("/api/auth");
}

export function joinWorkspace(token: string) {
  return apiFetch<{ workspace: WorkspaceDTO }>("/api/auth", { method: "POST", body: JSON.stringify({ token }) });
}

export function listTasks(status?: "active" | "done") {
  const qs = status === "done" ? "?status=done" : "";
  return apiFetch<{ tasks: TaskDTO[] }>(`/api/tasks${qs}`);
}

export function createTask(input: {
  title: string;
  description?: string;
  assigneeId: string;
  deadlineAt: string;
  priority?: Priority;
  progress?: number;
  recurrenceId?: string;
}) {
  return apiFetch<{ task: TaskDTO }>("/api/tasks", { method: "POST", body: JSON.stringify(input) });
}

export function createRecurringTask(input: {
  title: string;
  description?: string;
  assigneeId: string;
  priority: Priority;
  frequency: RecurrenceFrequency;
  weekdays: number[];
  timeOfDay: string;
}) {
  return apiFetch<{ recurrence: { id: string } }>("/api/recurring", { method: "POST", body: JSON.stringify(input) });
}

export function updateTask(
  id: string,
  input: Partial<{ title: string; description: string | null; assigneeId: string; status: TaskStatus; progress: number; priority: Priority; deadlineAt: string }>
) {
  return apiFetch<{ task: TaskDTO }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteTask(id: string) {
  return apiFetch<{ ok: true }>(`/api/tasks/${id}`, { method: "DELETE" });
}

export function addComment(taskId: string, text: string) {
  return apiFetch<{ comment: CommentDTO }>(`/api/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ text }) });
}

export async function apiFetchComments(taskId: string): Promise<CommentDTO[]> {
  const { comments } = await apiFetch<{ comments: CommentDTO[] }>(`/api/tasks/${taskId}/comments`);
  return comments;
}

export function getPresence() {
  return apiFetch<{ presences: PresenceDTO[] }>("/api/presence");
}

export function getActivity(limit = 20) {
  return apiFetch<{ activity: ActivityDTO[] }>(`/api/activity?limit=${limit}`);
}

export function setPresence(status: "ONLINE" | "AWAY" | "WORKING", workingTaskId?: string | null) {
  return apiFetch<{ presence: PresenceDTO }>("/api/presence", { method: "POST", body: JSON.stringify({ status, workingTaskId }) });
}
