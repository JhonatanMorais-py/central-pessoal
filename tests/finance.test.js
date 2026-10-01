import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMoney, summarizeFinance } from "../src/finance.js";

test("converte valores monetários digitados em português", () => {
  assert.equal(parseMoney("R$ 1.250,50"), 1250.5);
  assert.equal(parseMoney("1.250"), 1250);
  assert.equal(parseMoney("80,5"), 80.5);
  assert.equal(parseMoney("100"), 100);
  assert.equal(Number.isNaN(parseMoney("")), true);
});

test("resume saldo realizado, mês atual e contas em aberto", () => {
  const items = [
    { tipo: "entrada", status: "realizado", valor: 3000, data_realizacao: "2026-10-01" },
    { tipo: "saida", status: "realizado", valor: 750.25, data_realizacao: "2026-10-02" },
    { tipo: "entrada", status: "realizado", valor: 100, data_realizacao: "2026-09-30" },
    { tipo: "entrada", status: "pendente", valor: 500, data_realizacao: null },
    { tipo: "saida", status: "pendente", valor: 1200, data_realizacao: null },
  ];
  assert.deepEqual(summarizeFinance(items, new Date("2026-10-10T12:00:00")), {
    balance: 2349.75,
    incomeMonth: 3000,
    expenseMonth: 750.25,
    payable: 1200,
    receivable: 500,
  });
});
