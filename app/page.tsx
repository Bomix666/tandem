"use client";

import { useEffect, useMemo, useState } from "react";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace-context";
import { TopBar } from "./components/TopBar";
import { DoneStats } from "./components/SummaryStrip";
import { TaskCard, DoneTaskCard } from "./components/TaskCard";
import { EmptyState } from "./components/EmptyState";
import { ActivityFeed } from "./components/ActivityFeed";
import { BottomNav, type ViewName } from "./components/BottomNav";
import { NewTaskSheet } from "./components/NewTaskSheet";
import { TaskDetailSheet } from "./components/TaskDetailSheet";
import { Toasts } from "./components/Toasts";
import { InviteScreen } from "./components/InviteScreen";
import { DevBadge } from "./components/DevBadge";
import { LeadsView } from "./components/leads/LeadsView";
import * as leadsApi from "@/lib/leads-api";
import type { DashboardDTO } from "@/types/leads";
import type { TaskDTO } from "@/types";

export default function Page() {
  return (
    <WorkspaceProvider>
      <DevBadge />
      <Shell />
    </WorkspaceProvider>
  );
}

function Shell() {
  const { loading, error, user, workspace } = useWorkspace();
  const [view, setView] = useState<ViewName>("home");
  const [newSheetOpen, setNewSheetOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [leadSearchOpen, setLeadSearchOpen] = useState(false);

  if (error) {
    return (
      <div className="section" style={{ paddingTop: 60 }}>
        <div className="empty">
          <div className="headline serif">Не удалось открыть Tandem</div>
          <div className="sub">{error}</div>
        </div>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="section" style={{ paddingTop: 60 }}>
        <div className="label">Загрузка…</div>
      </div>
    );
  }

  if ((workspace?.members.length ?? 1) < 2) {
    return (
      <>
        <Toasts />
        <InviteScreen />
      </>
    );
  }

  // центральная кнопка: на «Клиентах» — поиск клиентов, на остальных экранах — новая задача
  const centerAction = () => (view === "leads" ? setLeadSearchOpen(true) : setNewSheetOpen(true));

  return (
    <>
      <Toasts />
      <header className="top">
        <TopBar onHome={() => setView("home")} onTasks={() => setView("tasks")} />
      </header>

      <main>
        {view === "home" && <HomeView onOpenTask={setOpenTaskId} onGo={setView} />}
        {view === "tasks" && <TasksView onOpenTask={setOpenTaskId} onNewTask={() => setNewSheetOpen(true)} />}
        {view === "leads" && <LeadsView searchOpen={leadSearchOpen} onSearchOpenChange={setLeadSearchOpen} />}
        {view === "activity" && <ActivityView />}
      </main>

      <BottomNav view={view} onChange={setView} onCenter={centerAction} />

      <NewTaskSheet open={newSheetOpen} onClose={() => setNewSheetOpen(false)} />
      <TaskDetailSheet taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </>
  );
}

const DAY = 24 * 3600_000;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const byDeadline = (a: TaskDTO, b: TaskDTO) => +new Date(a.deadlineAt) - +new Date(b.deadlineAt);
const byCompleted = (a: TaskDTO, b: TaskDTO) => +new Date(b.completedAt ?? b.createdAt) - +new Date(a.completedAt ?? a.createdAt);

function plural(n: number, forms: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** Что сегодня в Sales OS — для карточки на главной (только реальные числа). */
function salesLine(d: DashboardDTO | null): string {
  if (!d) return "Клиенты, письма и follow-up — в одном месте.";
  const parts: string[] = [];
  if (d.today.followUps) parts.push(`${d.today.followUps} follow-up`);
  if (d.pipeline.toContact) parts.push(`${d.pipeline.toContact} ${plural(d.pipeline.toContact, ["лид", "лида", "лидов"])} ждут письма`);
  if (d.today.replies) parts.push(`${d.today.replies} ${plural(d.today.replies, ["ответ", "ответа", "ответов"])}`);
  if (parts.length) return `Сегодня: ${parts.join(", ")}.`;
  if (d.today.hot) return `${d.today.hot} ${plural(d.today.hot, ["горячий лид", "горячих лида", "горячих лидов"])} — можно брать в работу.`;
  return "Срочных дел по клиентам нет — самое время найти новых.";
}

type HomeTab = "todo" | "progress" | "done";

function HomeView({ onOpenTask, onGo }: { onOpenTask: (id: string) => void; onGo: (v: ViewName) => void }) {
  const { user, tasks, doneTasks, activity } = useWorkspace();
  const [tab, setTab] = useState<HomeTab>("todo");
  const [dashboard, setDashboard] = useState<DashboardDTO | null>(null);

  useEffect(() => {
    let cancelled = false;
    leadsApi
      .getDashboard()
      .then((r) => !cancelled && setDashboard(r.dashboard))
      .catch(() => void 0);
    return () => {
      cancelled = true;
    };
  }, []);

  const now = new Date();
  const todo = useMemo(() => tasks.filter((t) => t.status !== "IN_PROGRESS").sort(byDeadline), [tasks]);
  const inProgress = useMemo(() => tasks.filter((t) => t.status === "IN_PROGRESS").sort(byDeadline), [tasks]);
  const done = useMemo(() => [...doneTasks].sort(byCompleted), [doneTasks]);
  const doneToday = useMemo(() => doneTasks.filter((t) => t.completedAt && sameDay(new Date(t.completedAt), new Date())).length, [doneTasks]);
  const totalToday = tasks.length + doneToday;
  const pct = totalToday ? Math.round((doneToday / totalToday) * 100) : 0;
  const date = now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "short", year: "numeric" }).replace(" г.", "");
  const shown = tab === "todo" ? todo : tab === "progress" ? inProgress : done;

  return (
    <div className="section">
      <div className="greet">
        <div className="date">{date.charAt(0).toUpperCase() + date.slice(1)}</div>
        <h1>
          Набираем
          <br />
          <em>темп</em> сегодня
        </h1>
      </div>

      <div className="hero" onClick={() => onGo("leads")}>
        <div className="h-title">Sales OS</div>
        <div className="h-sub">{salesLine(dashboard)}</div>
        <div className="h-btn">Открыть клиентов</div>
        <div className="orb">
          <i />
          <i />
          <i />
          <b>OS</b>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Прогресс сегодня</div>
          <div className="date-pill">{now.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" })}</div>
        </div>
        <div className="prog-row">
          <div className="sub">
            {doneToday}/{totalToday} {plural(totalToday, ["задача", "задачи", "задач"])}
          </div>
          <div className="pct">{pct}%</div>
        </div>
        <div className={`glowbar${pct === 0 ? " zero" : ""}`}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="section-head">
        <div className="title">Все задачи</div>
        <button className="count" onClick={() => onGo("tasks")}>
          Смотреть все
        </button>
      </div>
      <div className="pills">
        <div className={`pickchip${tab === "todo" ? " active" : ""}`} onClick={() => setTab("todo")}>
          К выполнению ( {todo.length} )
        </div>
        <div className={`pickchip${tab === "progress" ? " active" : ""}`} onClick={() => setTab("progress")}>
          В работе ( {inProgress.length} )
        </div>
        <div className={`pickchip${tab === "done" ? " active" : ""}`} onClick={() => setTab("done")}>
          Готово ( {done.length} )
        </div>
      </div>
      <div className="task-list stagger" style={{ marginTop: 12 }}>
        {shown.length === 0 ? (
          <EmptyState kind={tab === "done" ? "done" : "home"} />
        ) : tab === "done" ? (
          shown.slice(0, 4).map((t) => <DoneTaskCard key={t.id} task={t} currentUserId={user!.id} />)
        ) : (
          shown.slice(0, 4).map((t) => <TaskCard key={t.id} task={t} currentUserId={user!.id} onOpen={onOpenTask} />)
        )}
      </div>

      <div className="section-head">
        <div className="title">Последняя активность</div>
        <button className="count" onClick={() => onGo("activity")}>
          Вся лента
        </button>
      </div>
      <div className="feed-card">
        <ActivityFeed items={activity} limit={5} />
      </div>
    </div>
  );
}

type TasksTab = "all" | "mine" | "partner" | "done";

/** «Фокус недели»: сколько задач закрыто по дням за последние 5 дней. */
function WeekFocus({ doneTasks, onNewTask }: { doneTasks: TaskDTO[]; onNewTask: () => void }) {
  const today = new Date();
  const days = [4, 3, 2, 1, 0].map((back) => {
    const d = new Date(today.getTime() - back * DAY);
    return { d, n: doneTasks.filter((t) => t.completedAt && sameDay(new Date(t.completedAt), d)).length };
  });
  const max = Math.max(1, ...days.map((x) => x.n));
  const total = days.reduce((s, x) => s + x.n, 0);
  const onTime = doneTasks.filter((t) => t.completedAt && +new Date(t.completedAt) <= +new Date(t.deadlineAt)).length;
  const pct = doneTasks.length ? Math.round((onTime / doneTasks.length) * 100) : 0;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{total ? "Хороший темп!" : "Неделя только начинается"}</div>
          <div className="card-sub">
            Закрыто за 5 дней: {total} · вовремя — {pct}%
          </div>
        </div>
        <div className="big-pct">{pct}%</div>
      </div>
      <div className="week">
        {days.map(({ d, n }, i) => (
          <div key={i} className={`day${i === days.length - 1 ? " today" : ""}`}>
            <div className="badge">{n}</div>
            <div className="cap">
              <i style={{ height: n ? `calc(${Math.max(22, (n / max) * 100)}% - 6px)` : 0 }} />
            </div>
            <div className="num">{d.getDate()}</div>
          </div>
        ))}
      </div>
      <button className="primary-btn" onClick={onNewTask}>
        ✦ Новая задача
      </button>
    </div>
  );
}

function TasksView({ onOpenTask, onNewTask }: { onOpenTask: (id: string) => void; onNewTask: () => void }) {
  const { user, tasks, doneTasks } = useWorkspace();
  const [tab, setTab] = useState<TasksTab>("all");
  const sorted = useMemo(() => [...tasks].sort(byDeadline), [tasks]);
  const mine = sorted.filter((t) => t.assigneeId === user!.id);
  const partner = sorted.filter((t) => t.assigneeId !== user!.id);
  const done = useMemo(() => [...doneTasks].sort(byCompleted), [doneTasks]);
  const onTimeCount = doneTasks.filter((t) => t.completedAt && +new Date(t.completedAt) <= +new Date(t.deadlineAt)).length;
  const onTimePct = doneTasks.length ? Math.round((onTimeCount / doneTasks.length) * 100) : 0;
  const active = tab === "mine" ? mine : tab === "partner" ? partner : sorted;
  const tabs: { key: TasksTab; label: string; n: number }[] = [
    { key: "all", label: "Активные", n: sorted.length },
    { key: "mine", label: "Мои", n: mine.length },
    { key: "partner", label: "Партнёра", n: partner.length },
    { key: "done", label: "Готово", n: done.length },
  ];

  return (
    <div className="section">
      <h1 className="screen-title">Задачи</h1>
      <div className="pills" style={{ marginTop: 14 }}>
        {tabs.map((t) => (
          <div key={t.key} className={`pickchip${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label} ( {t.n} )
          </div>
        ))}
      </div>

      {tab === "done" ? (
        <>
          <DoneStats completed={doneTasks.length} onTimePct={onTimePct} />
          <div className="section-head">
            <div className="title">Завершено</div>
          </div>
          <div className="task-list stagger">
            {done.length === 0 ? <EmptyState kind="done" /> : done.map((t) => <DoneTaskCard key={t.id} task={t} currentUserId={user!.id} />)}
          </div>
        </>
      ) : (
        <>
          <div className="section-head" style={{ marginTop: 20 }}>
            <div className="title">Фокус недели</div>
          </div>
          <WeekFocus doneTasks={doneTasks} onNewTask={onNewTask} />
          <div className="section-head">
            <div className="title">{tab === "mine" ? "Мои задачи" : tab === "partner" ? "Задачи партнёра" : "Все активные"}</div>
            <div className="count">{active.length} открыто</div>
          </div>
          <div className="task-list stagger">
            {active.length === 0 ? <EmptyState kind="tasks" /> : active.map((t) => <TaskCard key={t.id} task={t} currentUserId={user!.id} onOpen={onOpenTask} />)}
          </div>
        </>
      )}
    </div>
  );
}

function ActivityView() {
  const { activity } = useWorkspace();
  return (
    <div className="section">
      <h1 className="screen-title">Лента</h1>
      <div className="feed-card" style={{ marginTop: 16 }}>
        <ActivityFeed items={activity} />
      </div>
    </div>
  );
}
