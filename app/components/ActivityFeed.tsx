import { useWorkspace } from "@/lib/workspace-context";
import { relTime } from "./TaskCard";
import { EmptyState } from "./EmptyState";
import type { ActivityDTO } from "@/types";

const VERB: Record<string, string> = {
  task_created: "создал(а)",
  task_updated: "обновил(а)",
  task_completed: "завершил(а)",
  task_reopened: "вернул(а) в работу",
  task_deleted: "удалил(а)",
  deadline_changed: "изменил(а) дедлайн у",
  progress_changed: "изменил(а) прогресс по",
  comment_added: "оставил(а) комментарий к",
  attachment_added: "прикрепил(а) файл к",
  work_started: "начал(а) работу над",
  work_stopped: "закончил(а) работу над",
};

function describeRest(a: ActivityDTO, taskTitle?: string) {
  const verb = VERB[a.type] ?? "обновил(а)";
  return taskTitle ? `${verb} «${taskTitle}»` : verb;
}

export function ActivityFeed({ items, limit }: { items: ActivityDTO[]; limit?: number }) {
  const { user } = useWorkspace();
  const list = limit ? items.slice(0, limit) : items;

  if (list.length === 0) return <EmptyState kind="activity" />;

  return (
    <div className="activity-list">
      {list.map((a) => {
        const isSelf = a.actorId === user?.id;
        const actorName = isSelf ? "Вы" : a.actor?.firstName ?? "Партнёр";
        const taskTitle = a.task?.title ?? (a.meta?.title as string | undefined);
        return (
          <div className="activity-item" key={a.id}>
            <div className="activity-dot" />
            <div className="activity-text">
              <b>{actorName}</b> {describeRest(a, taskTitle)}
            </div>
            <div className="activity-time">{relTime(a.createdAt)}</div>
          </div>
        );
      })}
    </div>
  );
}
