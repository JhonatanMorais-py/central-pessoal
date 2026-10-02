import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTasks } from "../src/tasks.js";

test("resume tarefas pendentes, concluídas e atrasadas", () => {
  const items = [
    { concluida: false, data_limite: "2026-09-30" },
    { concluida: false, data_limite: "2026-10-10" },
    { concluida: false, data_limite: null },
    { concluida: true, data_limite: "2026-09-20" },
  ];
  assert.deepEqual(summarizeTasks(items, "2026-10-01"), {
    pending: 3,
    completed: 1,
    overdue: 1,
  });
});
