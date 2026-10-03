"use client";

// Верхняя панель оболочки: круглая кнопка «домой», пилюля с числом активных
// задач и аватары — партнёр (с индикатором присутствия) и вы.

import { haptic } from "@/lib/telegram-client";
import { useWorkspace } from "@/lib/workspace-context";
import type { TaskDTO, UserDTO } from "@/types";

const presenceLabel: Record<string, string> = { ONLINE: "в сети", AWAY: "не в сети", OFFLINE: "не в сети", WORKING: "работает" };

function plural(n: number, forms: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

export function TopBar({ onHome, onTasks }: { onHome: () => void; onTasks: () => void }) {
  const { user, workspace, presences, tasks, doneTasks, showToast } = useWorkspace();
  if (!user || !workspace) return null;

  const friendId = workspace.members.map((m) => m.userId).find((id) => id !== user.id);
  const friend = findFriendUser(user.id, [...tasks, ...doneTasks]);
  const friendName = friend?.firstName ?? "Партнёр";
  const presence = friendId ? presences[friendId] : undefined;
  const status = presence?.status ?? "OFFLINE";
  const workingTask = presence?.workingTaskId ? tasks.find((t) => t.id === presence.workingTaskId) : null;
  const tap = (fn: () => void) => () => {
    haptic("light");
    fn();
  };

  return (
    <div className="top-row">
      <div className="top-left">
        <button className="circle-btn" onClick={tap(onHome)} aria-label="Главная">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4" y="4" width="6.5" height="6.5" rx="2.2" />
            <rect x="13.5" y="4" width="6.5" height="6.5" rx="2.2" />
            <rect x="4" y="13.5" width="6.5" height="6.5" rx="2.2" />
            <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2.2" />
          </svg>
        </button>
        <button className="top-pill" onClick={tap(onTasks)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="5" y="4.5" width="14" height="16" rx="3" />
            <path d="M9 3.5h6v3H9zM9 11h6M9 15h4" />
          </svg>
          <span>
            {tasks.length} {plural(tasks.length, ["активная задача", "активные задачи", "активных задач"])}
          </span>
        </button>
      </div>
      <div className="top-right">
        {friendId && (
          <button
            className="top-av"
            aria-label={friendName}
            onClick={tap(() => showToast(`${friendName}: ${status === "WORKING" && workingTask ? `работает · ${workingTask.title}` : presenceLabel[status]}`))}
          >
            {friendName.slice(0, 1).toUpperCase()}
            <span className={`presence-dot ${status.toLowerCase()}`} />
          </button>
        )}
        <div className="top-av me" aria-label="Вы">
          {user.firstName.slice(0, 1).toUpperCase()}
        </div>
      </div>
    </div>
  );
}

// В списке участников (/api/auth) только id. Имя партнёра берём из уже
// загруженных задач, где он исполнитель или автор; для пустого пространства —
// «Партнёр».
function findFriendUser(selfId: string, tasks: TaskDTO[]): UserDTO | null {
  for (const t of tasks) {
    if (t.assignee.id !== selfId) return t.assignee;
    if (t.creator.id !== selfId) return t.creator;
  }
  return null;
}
