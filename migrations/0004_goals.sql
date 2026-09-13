-- 「今日」目标引导：三张表，现有表不改。
-- goals 是「未来一段时间最重要的事」；goal_tasks 是挂在目标下的一次性待办；
-- goal_checkins 是按天幂等的打卡，date 与 events.date 同口径（Asia/Shanghai）。
CREATE TABLE goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  cue TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT '',
  target_label TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL,
  until TEXT,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX idx_goals_user ON goals(user_id, archived_at, position);

CREATE TABLE goal_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  done_at INTEGER
);
CREATE INDEX idx_goal_tasks_goal ON goal_tasks(goal_id, done_at, position);

CREATE TABLE goal_checkins (
  user_id INTEGER NOT NULL,
  goal_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (user_id, goal_id, date)
);
