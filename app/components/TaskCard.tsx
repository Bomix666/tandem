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
            {task.priority === "URGENT" || task.priority === "HIGH" ? (
              <span className={`prio-pill ${task.priority.toLowerCase()}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
                </svg>
                {task.priority === "URGENT" ? "Срочно" : "Высокий"}
              </span>
            ) : (
              <span className={`pdot ${task.priority.toLowerCase()}`} />
            )}
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
