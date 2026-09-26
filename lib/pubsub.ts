// Внутрипроцессный pub/sub. Работает только если backend развёрнут как
// один постоянно живущий Node-процесс (см. README §6) — на классическом
// Vercel serverless разные вызовы функции не разделяют память, и
// подписчик из одного вызова не увидит publish() из другого. Для
// serverless-хостинга замени этот файл на Pusher/Ably-клиент с той же
// сигнатурой (publish/subscribe) — вызовы в API-роутах менять не придётся.

export interface RealtimeEvent {
  type: "tasks_changed" | "presence_changed" | "activity_changed" | "comments_changed" | "leads_changed";
  workspaceId: string;
  payload?: unknown;
}

type Listener = (event: RealtimeEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function publish(event: RealtimeEvent) {
  const set = listeners.get(event.workspaceId);
  if (!set) return;
  for (const listener of set) listener(event);
}

export function subscribe(workspaceId: string, listener: Listener): () => void {
  let set = listeners.get(workspaceId);
  if (!set) {
    set = new Set();
    listeners.set(workspaceId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(workspaceId);
  };
}
