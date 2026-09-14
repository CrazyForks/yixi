-- 子任务从「一次性待办」改成「每天勾一次」，并且每条可以绑自己的跳转目标。
-- goal_tasks.done_at 保留但从此不读不写：D1 有 DROP COLUMN，但一列旧数据换不来
-- 任何东西，留着比改表安全。
ALTER TABLE goal_tasks ADD COLUMN target TEXT NOT NULL DEFAULT '';
ALTER TABLE goal_tasks ADD COLUMN target_label TEXT NOT NULL DEFAULT '';

CREATE TABLE goal_task_checkins (
  user_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  date TEXT NOT NULL,            -- YYYY-MM-DD，Asia/Shanghai
  ts INTEGER NOT NULL,
  PRIMARY KEY (user_id, task_id, date)
);
CREATE INDEX idx_goal_task_checkins_day ON goal_task_checkins(user_id, date);

-- 旧的一次性完成记录换算成当天的一次勾选，历史不丢。线上此刻是 0 行，但写全。
INSERT OR IGNORE INTO goal_task_checkins (user_id, task_id, date, ts)
  SELECT user_id, id, strftime('%Y-%m-%d', done_at / 1000 + 8 * 3600, 'unixepoch'), done_at
  FROM goal_tasks WHERE done_at IS NOT NULL;
