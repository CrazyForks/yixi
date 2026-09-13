-- 每日快照：那天 /today 展示了几个目标、打了几个卡、划掉几条子任务。
-- 由 00:00（Asia/Shanghai）的 cron 写入，写了就不改；没跑的日子就是空位。
CREATE TABLE goal_days (
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  shown INTEGER NOT NULL,
  done INTEGER NOT NULL,
  tasks_done INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
);
