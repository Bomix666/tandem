"use client";

import { useEffect, useState } from "react";
import { useWorkspace } from "@/lib/workspace-context";
import { Countdown, CountdownSubLabel } from "./Countdown";
import { ProgressRing } from "./ProgressRing";
import { haptic, hapticSuccess } from "@/lib/telegram-client";
import { relTime } from "./TaskCard";
import type { CommentDTO } from "@/types";
import * as api from "@/lib/api";

const PRIORITY_LABEL: Record<string, string> = { LOW: "Низкий", MEDIUM: "Средний", HIGH: "Высокий", URGENT: "Срочно" };
const STATUS_LABEL: Record<string, string> = { TODO: "К выполнению", IN_PROGRESS: "В процессе", DONE: "Готово" };

export function TaskDetailSheet({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const { user, tasks, doneTasks, presences, updateProgress, completeTask, reopenTask, addComment, startWorking, stopWorking, showToast } =
    useWorkspace();
  const task = [...tasks, ...doneTasks].find((t) => t.id === taskId) ?? null;

  const [localProgress, setLocalProgress] = useState(task?.progress ?? 0);
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);

  useEffect(() => {
    setLocalProgress(task?.progress ?? 0);
  }, [task?.id, task?.progress]);

  useEffect(() => {
    if (!taskId) return;
    // Comments aren't included in the task list payload (kept light for
    // polling); fetch them lazily only when the sheet opens.
    setCommentsLoading(true);
    api
      .apiFetchComments(taskId)
      .then(setComments)
      .catch(() => setComments([]))
      .finally(() => setCommentsLoading(false));
  }, [taskId]);

  if (!task || !user) {
    return (
      <>
        <div className="scrim" />
        <div className="sheet" />
      </>
    );
  }

  const isWorkingOnThis = presences[user.id]?.workingTaskId === task.id;

  async function handleComplete() {
    haptic("medium");
    if (task!.progress >= 100) {
      await reopenTask(task!.id);
      return;
    }
    hapticSuccess();
    await completeTask(task!.id);
    onClose();
  }

  async function handleSendComment() {
    const text = commentText.trim();
    if (!text) return;
    setCommentText("");
    await addComment(task!.id, text);
    const fresh = await api.apiFetchComments(task!.id).catch(() => comments);
    setComments(fresh);
  }

  return (
    <>
      <div className={`scrim${taskId ? " show" : ""}`} onClick={onClose} />
      <div className={`sheet${taskId ? " show" : ""}`}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <div className="htitle" style={{ maxWidth: "80%" }}>
            {task.title}
          </div>
          <button className="iconbtn" onClick={onClose}>✕</button>
        </div>
        <div className="sheet-body">
          <div className="detail-countdown">
            <Countdown deadline={task.deadlineAt} big />
            <div className="label" style={{ marginTop: 4 }}>
              {task.status === "DONE" ? (
                "завершено"
              ) : (
                <DeadlineMeta deadline={task.deadlineAt} />
              )}
            </div>
          </div>
          <div className="detail-ring">
            <ProgressRing pct={localProgress} size={76} stroke={5} showLabel={false} />
          </div>
          {task.description && (
            <div style={{ fontSize: 13, color: "var(--ink-dim)", lineHeight: 1.5, marginBottom: 14 }}>{task.description}</div>
          )}
          <div className="detail-row">
            <div className="dl">Исполнитель</div>
            <div className="dv">{task.assigneeId === user.id ? "Вы" : task.assignee.firstName}</div>
          </div>
          <div className="detail-row">
            <div className="dl">Приоритет</div>
            <div className="dv">{PRIORITY_LABEL[task.priority]}</div>
          </div>
          <div className="detail-row">
            <div className="dl">Статус</div>
            <div className="dv">{STATUS_LABEL[task.status]}</div>
          </div>

          {task.status !== "DONE" && (
            <div className="field">
              <label className="flabel label">Прогресс</label>
              <input
                type="range"
                min={0}
                max={100}
                value={localProgress}
                className="progress-slider"
                onChange={(e) => setLocalProgress(Number(e.target.value))}
                onMouseUp={() => updateProgress(task.id, localProgress)}
                onTouchEnd={() => updateProgress(task.id, localProgress)}
              />
            </div>
          )}

          {task.status !== "DONE" &&
            (isWorkingOnThis ? (
              <button
                className="ghost-btn"
                style={{ color: "var(--amber)", borderColor: "rgba(231,178,76,.3)" }}
                onClick={async () => {
                  haptic("light");
                  await stopWorking();
                }}
              >
                Остановить работу
              </button>
            ) : (
              <button
                className="ghost-btn"
                onClick={async () => {
                  haptic("light");
                  await startWorking(task.id);
                }}
              >
                Начать работу над этим
              </button>
            ))}

          <button className="primary-btn" onClick={handleComplete}>
            {task.progress >= 100 ? "Вернуть в работу" : "Отметить выполненным"}
          </button>

          <div className="section-head" style={{ margin: "22px 0 6px" }}>
            <div className="title" style={{ fontSize: 14 }}>Комментарии</div>
          </div>
          <div>
            {commentsLoading ? (
              <div className="label" style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink-faint)" }}>
                Загрузка…
              </div>
            ) : comments.length === 0 ? (
              <div className="label" style={{ textTransform: "none", letterSpacing: 0, color: "var(--ink-faint)" }}>
                Пока нет комментариев
              </div>
            ) : (
              comments.map((c) => (
                <div className="comment" key={c.id}>
                  <div className={`avatar ${c.authorId === user.id ? "you" : "alex"} cav`}>
                    {(c.authorId === user.id ? "Вы" : c.author.firstName).slice(0, 1)}
                  </div>
                  <div className="comment-body">
                    <b style={{ display: "block", fontSize: 11, marginBottom: 2 }}>{c.authorId === user.id ? "Вы" : c.author.firstName}</b>
                    {c.text}
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="comment-input-row">
            <input
              type="text"
              placeholder="Добавить комментарий"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendComment()}
            />
            <button className="sendbtn" onClick={handleSendComment}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DeadlineMeta({ deadline }: { deadline: string }) {
  return <CountdownSubLabel deadline={deadline} />;
}
