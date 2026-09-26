import { Countdown, CountdownSubLabel } from "./Countdown";
import { ProgressRing } from "./ProgressRing";
import type { TaskDTO } from "@/types";

export function TaskCard({ task, currentUserId, onOpen }: { task: TaskDTO; currentUserId: string; onOpen: (id: string) => void }) {
  const isYou = task.assigneeId === currentUserId;
  return (
    <div className="task-card" onClick={() => onOpen(task.id)}>
      <div className="task-top">
        <div>
          <div className="task-title">{task.title}</div>
          <div className="task-meta">
            <span className={`pdot ${task.priority.toLowerCase()}`} />
            <span className={`chip ${isYou ? "you" : "alex"}`}>{isYou ? "Вы" : task.assignee.firstName}</span>
          </div>
        </div>
      </div>
      <div className="task-bottom">
        <div className="countdown-wrap">
          <div>
            <Countdown deadline={task.deadlineAt} />
            <CountdownSubLabel deadline={task.deadlineAt} />
          </div>
        </div>
        <ProgressRing pct={task.progress} size={34} stroke={3} />
      </div>
    </div>
  );
}

export function DoneTaskCard({ task, currentUserId }: { task: TaskDTO; currentUserId: string }) {
  const isYou = task.assigneeId === currentUserId;
  const completedAgo = task.completedAt ? relTime(task.completedAt) : "";
  return (
    <div className="task-card done-card">
      <div className="task-top">
        <div>
          <div className="task-title">{task.title}</div>
          <div className="task-meta">
            <span className={`chip ${isYou ? "you" : "alex"}`}>{isYou ? "Вы" : task.assignee.firstName}</span>
            <span className="label" style={{ textTransform: "none", letterSpacing: 0 }}>
              завершено {completedAgo}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return m + " мин назад";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " ч назад";
  const d = Math.floor(h / 24);
  if (d === 1) return "вчера";
  return d + " дн назад";
}
