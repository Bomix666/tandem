"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { initTelegramWebApp, getStartParam } from "./telegram-client";
import { subscribeRealtime } from "./realtime";
import * as api from "./api";
import type { TaskDTO, PresenceDTO, ActivityDTO, WorkspaceDTO, UserDTO, Priority } from "@/types";

// SSE — основной источник realtime-обновлений (см. app/api/stream/route.ts
// и lib/pubsub.ts). Поллинг ниже — не основной механизм, а редкий фолбэк
// на случай, если SSE-соединение недоступно (прокси без поддержки
// text/event-stream, разрыв без auto-reconnect и т.п.).
const FALLBACK_POLL_MS = 20000;

interface Toast { id: number; text: string }

interface WorkspaceState {
  user: UserDTO | null;
  workspace: WorkspaceDTO | null;
  otherMemberId: string | null;
  tasks: TaskDTO[];
  doneTasks: TaskDTO[];
  presences: Record<string, PresenceDTO>;
  activity: ActivityDTO[];
  loading: boolean;
  error: string | null;
  toasts: Toast[];
  showToast: (text: string) => void;
  createTask: (input: { title: string; description?: string; assigneeId: string; deadlineAt: string; priority: Priority; recurrenceId?: string }) => Promise<void>;
  updateProgress: (taskId: string, progress: number) => Promise<void>;
  completeTask: (taskId: string) => Promise<void>;
  reopenTask: (taskId: string) => Promise<void>;
  addComment: (taskId: string, text: string) => Promise<void>;
  startWorking: (taskId: string) => Promise<void>;
  stopWorking: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceDTO | null>(null);
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [doneTasks, setDoneTasks] = useState<TaskDTO[]>([]);
  const [presences, setPresences] = useState<Record<string, PresenceDTO>>({});
  const [activity, setActivity] = useState<ActivityDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const showToast = useCallback((text: string) => {
    const tid = ++toastId.current;
    setToasts((t) => [...t, { id: tid, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== tid)), 2200);
  }, []);

  const otherMemberId = workspace && user ? workspace.members.map((m) => m.userId).find((id) => id !== user.id) ?? null : null;

  const refreshAll = useCallback(async () => {
    const [{ workspace: freshWorkspace }, { tasks }, { tasks: done }, { presences: p }, { activity: a }] = await Promise.all([
      api.getOrCreateWorkspace(),
      api.listTasks(),
      api.listTasks("done"),
      api.getPresence(),
      api.getActivity(),
    ]);
    setWorkspace(freshWorkspace);
    setTasks(tasks);
    setDoneTasks(done);
    setPresences(Object.fromEntries(p.map((x) => [x.userId, x])));
    setActivity(a);
  }, []);

  useEffect(() => {
    let cancelled = false;
    initTelegramWebApp();

    (async () => {
      try {
        // Если пользователь открыл Mini App по инвайт-ссылке
        // (?startapp=invite_<token>) и ещё нигде не состоит — сначала
        // пробуем вступить в пространство друга. Если он уже где-то
        // состоит (обычный повторный запуск с сохранившимся
        // start_param) — join вернёт ошибку, её просто игнорируем и
        // идём по обычному пути ниже.
        const startParam = getStartParam();
        if (startParam?.startsWith("invite_")) {
          await api.joinWorkspace(startParam.replace("invite_", "")).catch(() => void 0);
        }

        const { user, workspace } = await api.getOrCreateWorkspace();
        if (cancelled) return;
        setUser(user);
        setWorkspace(workspace);
        await refreshAll();
        await api.setPresence("ONLINE");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить рабочее пространство");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!user) return;
    // Основное обновление — по SSE-событию (см. lib/realtime.ts).
    const unsubscribe = subscribeRealtime(() => {
      refreshAll().catch(() => void 0);
    });
    // Редкий фолбэк-поллинг на случай, если SSE недоступен или тихо оборвался.
    const interval = setInterval(() => {
      refreshAll().catch(() => void 0);
    }, FALLBACK_POLL_MS);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [user, refreshAll]);

  useEffect(() => {
    if (!user) return;
    // Heartbeat so presence doesn't go stale while the app stays open but
    // idle; a periodic server-side sweep should additionally demote any
    // presence row whose lastSeenAt falls too far behind (see
    // app/api/presence/route.ts's doc comment) to catch clients that
    // disappear without calling this at all (killed app, locked phone).
    const heartbeat = setInterval(() => {
      api.setPresence("ONLINE").catch(() => void 0);
    }, 25000);
    const onHide = () => {
      if (document.visibilityState === "hidden") api.setPresence("AWAY").catch(() => void 0);
      else api.setPresence("ONLINE").catch(() => void 0);
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [user]);

  const createTask: WorkspaceState["createTask"] = async (input) => {
    await api.createTask(input);
    showToast("Задача создана");
    await refreshAll();
  };

  const updateProgress: WorkspaceState["updateProgress"] = async (taskId, progress) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, progress } : t))); // optimistic
    try {
      await api.updateTask(taskId, { progress, status: progress > 0 ? "IN_PROGRESS" : "TODO" });
    } catch {
      await refreshAll(); // rollback to server truth
      showToast("Не удалось сохранить прогресс");
    }
  };

  const completeTask: WorkspaceState["completeTask"] = async (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    setTasks((prev) => prev.filter((t) => t.id !== taskId)); // optimistic
    if (task) setDoneTasks((prev) => [{ ...task, status: "DONE", progress: 100 }, ...prev]);
    try {
      await api.updateTask(taskId, { status: "DONE", progress: 100 });
      showToast("Задача выполнена");
    } catch {
      await refreshAll();
      showToast("Не удалось завершить задачу");
    }
  };

  const reopenTask: WorkspaceState["reopenTask"] = async (taskId) => {
    await api.updateTask(taskId, { status: "IN_PROGRESS", progress: 90 });
    await refreshAll();
  };

  const addComment: WorkspaceState["addComment"] = async (taskId, text) => {
    await api.addComment(taskId, text);
    await refreshAll();
  };

  const startWorking: WorkspaceState["startWorking"] = async (taskId) => {
    await api.setPresence("WORKING", taskId);
    showToast("Работа начата");
    await refreshAll();
  };

  const stopWorking: WorkspaceState["stopWorking"] = async () => {
    await api.setPresence("ONLINE");
    await refreshAll();
  };

  return (
    <WorkspaceContext.Provider
      value={{
        user,
        workspace,
        otherMemberId,
        tasks,
        doneTasks,
        presences,
        activity,
        loading,
        error,
        toasts,
        showToast,
        createTask,
        updateProgress,
        completeTask,
        reopenTask,
        addComment,
        startWorking,
        stopWorking,
        refreshAll,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return ctx;
}
