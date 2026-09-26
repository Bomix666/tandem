const EMPTY_COPY: Record<string, [string, string]> = {
  home: ["Нет активных задач", "Всё чисто."],
  tasks: ["Нет открытых задач", "Добавьте задачу, чтобы начать."],
  done: ["Пока ничего не завершено", "Завершённые задачи соберутся здесь."],
  activity: ["Пока тихо", "Здесь появится ваша совместная активность."],
};

export function EmptyState({ kind }: { kind: keyof typeof EMPTY_COPY }) {
  const [headline, sub] = EMPTY_COPY[kind]!;
  return (
    <div className="empty">
      <div className="glyph">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </div>
      <div className="headline serif">{headline}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}
