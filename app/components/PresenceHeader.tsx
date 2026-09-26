import { useWorkspace } from "@/lib/workspace-context";
import type { UserDTO, TaskDTO } from "@/types";

const presenceLabel: Record<string, string> = { ONLINE: "В сети", AWAY: "Не в сети", OFFLINE: "Не в сети", WORKING: "Работает" };

export function PresenceHeader() {
  const { user, workspace, presences, tasks, doneTasks } = useWorkspace();
  if (!user || !workspace) return null;

  const order = [user.id, ...workspace.members.map((m) => m.userId).filter((id) => id !== user.id)];
  const friend = findFriendUser(user.id, [...tasks, ...doneTasks]);

  return (
    <div className="people-row">
      {order.map((uid) => {
        const isSelf = uid === user.id;
        const presence = presences[uid];
        const status = presence?.status ?? "OFFLINE";
        const workingTask = presence?.workingTaskId ? tasks.find((t) => t.id === presence.workingTaskId) : null;
        const label = status === "WORKING" && workingTask ? `Работает · ${workingTask.title}` : presenceLabel[status];
        const name = isSelf ? "Вы" : friend?.firstName ?? "Партнёр";
        const initials = name.slice(0, 1).toUpperCase();

        return (
          <div className={`person${isSelf ? " self" : ""}`} key={uid}>
            <div className={`avatar ${isSelf ? "you" : "alex"}`}>
              {initials}
              <span className={`presence-dot ${status.toLowerCase()}`} />
            </div>
            <div className="person-text">
              <div className="pname">{name}</div>
              <div className={`pstate${status === "WORKING" ? " working" : ""}`}>{label}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// The member list from /api/auth only carries userIds. The friend's
// display name comes from whichever task we've already fetched that names
// them as assignee or creator — good enough for a two-person app once any
// task exists. Falls back to "Партнёр" for a brand-new, empty workspace.
function findFriendUser(selfId: string, tasks: TaskDTO[]): UserDTO | null {
  for (const t of tasks) {
    if (t.assignee.id !== selfId) return t.assignee;
    if (t.creator.id !== selfId) return t.creator;
  }
  return null;
}
