const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function parseMoney(value) {
  const clean = String(value ?? "")
    .replace(/[^\d,.-]/g, "")
    .trim();
  if (!clean) return NaN;
  const normalized = clean.includes(",")
    ? clean.replace(/\./g, "").replace(",", ".")
    : /^-?\d{1,3}(\.\d{3})+$/.test(clean)
      ? clean.replace(/\./g, "")
      : clean;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
}

export function summarizeFinance(items, now = new Date()) {
  const month = now.getMonth();
  const year = now.getFullYear();
  const summary = {
    balance: 0,
    incomeMonth: 0,
    expenseMonth: 0,
    payable: 0,
    receivable: 0,
  };
  for (const item of items) {
    const value = Number(item.valor) || 0;
    if (item.status === "pendente") {
      if (item.tipo === "entrada") summary.receivable += value;
      else summary.payable += value;
      continue;
    }
    const date = item.data_realizacao
      ? new Date(`${item.data_realizacao}T12:00:00`)
      : null;
    if (item.tipo === "entrada") summary.balance += value;
    else summary.balance -= value;
    if (date?.getMonth() === month && date?.getFullYear() === year) {
      if (item.tipo === "entrada") summary.incomeMonth += value;
      else summary.expenseMonth += value;
    }
  }
  return summary;
}

export function createFinanceController({ client, check, notice, run }) {
  const $ = (id) => document.getElementById(id);
  let items = [];
  let user = null;
  let deleteId = null;

  const today = () => new Date().toLocaleDateString("en-CA");
  const formatDate = (date) =>
    date
      ? new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "—";
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const actionButton = (label, handler, className = "text-button") => {
    const node = element("button", label, className);
    node.type = "button";
    node.onclick = () => run(handler);
    return node;
  };

  function updateSummary() {
    const summary = summarizeFinance(items);
    $("summary-balance").textContent = brl.format(summary.balance);
    $("summary-income").textContent = brl.format(summary.incomeMonth);
    $("summary-expense").textContent = brl.format(summary.expenseMonth);
    $("summary-pending").textContent = brl.format(
      summary.payable + summary.receivable,
    );
    $("summary-pending-detail").textContent = `${brl.format(summary.payable)} a pagar · ${brl.format(summary.receivable)} a receber`;
  }

  function filteredItems() {
    const search = $("finance-search").value.trim().toLocaleLowerCase("pt-BR");
    const type = $("finance-type-filter").value;
    const status = $("finance-status-filter").value;
    return items.filter(
      (item) =>
        (!type || item.tipo === type) &&
        (!status || item.status === status) &&
        (!search ||
          `${item.descricao} ${item.categoria || ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(search)),
    );
  }

  function render() {
    updateSummary();
    const list = $("finance-list");
    list.replaceChildren();
    const filtered = filteredItems();
    $("finance-count").textContent = items.length;
    $("finance-list-count").textContent = `${filtered.length} ${filtered.length === 1 ? "registro" : "registros"}`;
    if (!filtered.length) {
      const empty = element("div", null, "empty finance-empty");
      empty.append(
        element("span", "◒"),
        element(
          "h3",
          items.length
            ? "Nenhum lançamento corresponde aos filtros."
            : "Seu financeiro começa com um lançamento.",
        ),
        element(
          "p",
          items.length
            ? "Ajuste a busca ou os filtros para ver outros registros."
            : "Registre uma entrada, saída, conta a pagar ou a receber.",
        ),
      );
      list.append(empty);
      return;
    }
    const currentDay = today();
    for (const item of filtered) {
      const overdue =
        item.status === "pendente" && item.data_vencimento < currentDay;
      const row = element("article", null, "finance-row");
      row.dataset.id = item.id;
      const mark = element(
        "span",
        item.tipo === "entrada" ? "↙" : "↗",
        `movement-mark ${item.tipo}`,
      );
      const description = element("div", null, "movement-description");
      description.append(
        element("strong", item.descricao),
        element(
          "span",
          item.categoria ||
            (item.tipo === "entrada" ? "Entrada" : "Saída"),
        ),
      );
      const due = element("div", null, "movement-date");
      due.append(
        element("small", item.status === "pendente" ? "VENCIMENTO" : "REALIZADO EM"),
        element(
          "span",
          formatDate(
            item.status === "pendente"
              ? item.data_vencimento
              : item.data_realizacao,
          ),
        ),
      );
      const value = element(
        "strong",
        `${item.tipo === "entrada" ? "+" : "−"} ${brl.format(item.valor)}`,
        `movement-value ${item.tipo}`,
      );
      const state = element(
        "span",
        overdue
          ? "Vencido"
          : item.status === "pendente"
            ? item.tipo === "entrada"
              ? "A receber"
              : "A pagar"
            : item.tipo === "entrada"
              ? "Recebido"
              : "Pago",
        `movement-status ${item.status}${overdue ? " overdue" : ""}`,
      );
      const actions = element("div", null, "movement-actions");
      if (item.status === "pendente")
        actions.append(
          actionButton(
            item.tipo === "entrada" ? "Marcar recebido" : "Marcar pago",
            () => markRealized(item),
          ),
        );
      actions.append(
        actionButton("Editar", async () => openForm(item)),
        actionButton(
          "Excluir",
          async () => {
            deleteId = item.id;
            $("finance-delete-dialog").showModal();
          },
          "text-button delete-button",
        ),
      );
      row.append(mark, description, due, value, state, actions);
      list.append(row);
    }
  }

  async function refresh() {
    if (!user) return;
    items = check(
      await client
        .from("fin_lancamentos")
        .select("*")
        .order("data_vencimento", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(1000),
    );
    render();
  }

  function openForm(item = null) {
    $("finance-form").reset();
    $("finance-id").value = item?.id || "";
    $("finance-dialog-title").textContent = item
      ? "Editar lançamento"
      : "Novo lançamento";
    $("finance-description").value = item?.descricao || "";
    const type = item?.tipo || "entrada";
    document.querySelector(
      `input[name="finance-type"][value="${type}"]`,
    ).checked = true;
    $("finance-value").value = item
      ? Number(item.valor).toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";
    $("finance-due-date").value = item?.data_vencimento || today();
    $("finance-status").value = item?.status || "pendente";
    $("finance-realized-date").value = item?.data_realizacao || "";
    $("finance-category").value = item?.categoria || "";
    $("finance-notes").value = item?.observacoes || "";
    syncRealizedDate();
    $("finance-dialog").showModal();
    $("finance-description").focus();
  }

  function syncRealizedDate() {
    const realized = $("finance-status").value === "realizado";
    $("finance-realized-date").disabled = !realized;
    $("finance-realized-date").required = realized;
    if (realized && !$("finance-realized-date").value)
      $("finance-realized-date").value = today();
    if (!realized) $("finance-realized-date").value = "";
  }

  async function save() {
    const value = parseMoney($("finance-value").value);
    if (!Number.isFinite(value) || value <= 0)
      throw new Error("Informe um valor financeiro maior que zero.");
    const status = $("finance-status").value;
    const payload = {
      user_id: user.id,
      descricao: $("finance-description").value.trim(),
      tipo: document.querySelector('input[name="finance-type"]:checked')
        ?.value,
      status,
      valor: value,
      data_vencimento: $("finance-due-date").value,
      data_realizacao:
        status === "realizado" ? $("finance-realized-date").value : null,
      categoria: $("finance-category").value.trim() || null,
      observacoes: $("finance-notes").value.trim() || null,
    };
    if (!payload.descricao || !payload.tipo || !payload.data_vencimento)
      throw new Error("Preencha descrição, tipo, valor e vencimento.");
    const id = $("finance-id").value;
    if (id)
      check(
        await client.from("fin_lancamentos").update(payload).eq("id", id),
      );
    else check(await client.from("fin_lancamentos").insert(payload));
    $("finance-dialog").close();
    await refresh();
    notice(id ? "Lançamento atualizado." : "Lançamento salvo.");
  }

  async function markRealized(item) {
    check(
      await client
        .from("fin_lancamentos")
        .update({ status: "realizado", data_realizacao: today() })
        .eq("id", item.id),
    );
    await refresh();
    notice(item.tipo === "entrada" ? "Entrada recebida." : "Saída paga.");
  }

  $("finance-form").onsubmit = (event) => {
    event.preventDefault();
    run(save);
  };
  $("finance-status").onchange = syncRealizedDate;
  $("finance-close").onclick = () => $("finance-dialog").close();
  $("finance-cancel").onclick = () => $("finance-dialog").close();
  $("finance-add-top").onclick = () => openForm();
  $("new-finance").onclick = () => openForm();
  for (const id of [
    "finance-search",
    "finance-type-filter",
    "finance-status-filter",
  ])
    $(id).addEventListener(id === "finance-search" ? "input" : "change", render);
  $("finance-delete-cancel").onclick = () =>
    $("finance-delete-dialog").close();
  $("finance-delete-confirm").onclick = () => {
    $("finance-delete-dialog").close();
    run(async () => {
      check(await client.from("fin_lancamentos").delete().eq("id", deleteId));
      await refresh();
      notice("Lançamento excluído.");
    });
  };

  return {
    openForm,
    refresh,
    async setUser(nextUser) {
      user = nextUser;
      if (user) await refresh();
      else {
        items = [];
        render();
      }
    },
  };
}
