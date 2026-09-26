"use client";

import { useMemo, useState } from "react";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace-context";
import { PresenceHeader } from "./components/PresenceHeader";
import { SummaryStrip, DoneStats } from "./components/SummaryStrip";
import { TaskCard, DoneTaskCard } from "./components/TaskCard";
import { EmptyState } from "./components/EmptyState";
import { ActivityFeed } from "./components/ActivityFeed";
import { BottomNav, Fab, type ViewName } from "./components/BottomNav";
import { NewTaskSheet } from "./components/NewTaskSheet";
import { TaskDetailSheet } from "./components/TaskDetailSheet";
import { Toasts } from "./components/Toasts";
import { InviteScreen } from "./components/InviteScreen";
import { DevBadge } from "./components/DevBadge";

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

  return (
    <>
      <Toasts />
      <header className="top">
        <div className="top-row">
          <div className="wordmark">
            <span className="dot" />
            <span className="name">Tandem</span>
          </div>
        </div>
        <PresenceHeader />
      </header>

      <main>
        {view === "home" && <HomeView onOpenTask={setOpenTaskId} />}
        {view === "tasks" && <TasksView onOpenTask={setOpenTaskId} />}
        {view === "done" && <DoneView />}
        {view === "activity" && <ActivityView />}
      </main>

      <Fab onClick={() => setNewSheetOpen(true)} />
      <BottomNav view={view} onChange={setView} />

      <NewTaskSheet open={newSheetOpen} onClose={() => setNewSheetOpen(false)} />
      <TaskDetailSheet taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </>
  );
}

function HomeView({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { user, tasks, doneTasks, activity } = useWorkspace();
  const sorted = useMemo(() => [...tasks].sort((a, b) => +new Date(a.deadlineAt) - +new Date(b.deadlineAt)).slice(0, 4), [tasks]);
  const doneToday = useMemo(
    () => doneTasks.filter((t) => t.completedAt && Date.now() - +new Date(t.completedAt) < 24 * 3600_000).length,
    [doneTasks]
  );
  const avgProgress = tasks.length ? Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length) : 0;

  return (
    <div className="section">
      <SummaryStrip active={tasks.length} doneToday={doneToday} avgProgress={avgProgress} />
      <div className="section-head">
        <div className="title">Активные</div>
        <div className="count">{tasks.length} всего</div>
      </div>
      <div className="task-list stagger">
        {sorted.length === 0 ? (
          <EmptyState kind="home" />
        ) : (
          sorted.map((t) => <TaskCard key={t.id} task={t} currentUserId={user!.id} onOpen={onOpenTask} />)
        )}
      </div>
      <div className="section-head">
        <div className="title">Последняя активность</div>
      </div>
      <ActivityFeed items={activity} limit={5} />
    </div>
  );
}

function TasksView({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const { user, tasks } = useWorkspace();
  const sorted = useMemo(() => [...tasks].sort((a, b) => +new Date(a.deadlineAt) - +new Date(b.deadlineAt)), [tasks]);

  return (
    <div className="section">
      <div className="section-head" style={{ marginTop: 14 }}>
        <div className="title">Все активные</div>
        <div className="count">{tasks.length} открыто</div>
      </div>
      <div className="task-list stagger">
        {sorted.length === 0 ? <EmptyState kind="tasks" /> : sorted.map((t) => <TaskCard key={t.id} task={t} currentUserId={user!.id} onOpen={onOpenTask} />)}
      </div>
    </div>
  );
}

function DoneView() {
  const { user, doneTasks } = useWorkspace();
  const sorted = useMemo(
    () => [...doneTasks].sort((a, b) => +new Date(b.completedAt ?? b.createdAt) - +new Date(a.completedAt ?? a.createdAt)),
    [doneTasks]
  );
  const onTimeCount = doneTasks.filter((t) => t.completedAt && +new Date(t.completedAt) <= +new Date(t.deadlineAt)).length;
  const pct = doneTasks.length ? Math.round((onTimeCount / doneTasks.length) * 100) : 0;

  return (
    <div className="section">
      <DoneStats completed={doneTasks.length} onTimePct={pct} />
      <div className="section-head">
        <div className="title">Завершено</div>
      </div>
      <div className="task-list stagger">
        {sorted.length === 0 ? <EmptyState kind="done" /> : sorted.map((t) => <DoneTaskCard key={t.id} task={t} currentUserId={user!.id} />)}
      </div>
    </div>
  );
}

function ActivityView() {
  const { activity } = useWorkspace();
  return (
    <div className="section">
      <div className="section-head" style={{ marginTop: 14 }}>
        <div className="title">Активность</div>
      </div>
      <ActivityFeed items={activity} />
    </div>
  );
}
