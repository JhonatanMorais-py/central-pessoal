export function summarizeTasks(items, today = new Date().toLocaleDateString("en-CA")) {
  return items.reduce(
    (summary, item) => {
      if (item.concluida) summary.completed += 1;
      else {
        summary.pending += 1;
        if (item.data_limite && item.data_limite < today) summary.overdue += 1;
      }
      return summary;
    },
    { pending: 0, completed: 0, overdue: 0 },
  );
}

export function createTaskController({ client, check, notice, run }) {
  const $ = (id) => document.getElementById(id);
  let items = [];
  let user = null;
  let deleteId = null;

  const today = () => new Date().toLocaleDateString("en-CA");
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
  const formatDate = (date) =>
    date
      ? new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      : "Sem prazo";

  function filteredItems() {
    const search = $("task-search").value.trim().toLocaleLowerCase("pt-BR");
    const status = $("task-status-filter").value;
    return items.filter(
      (item) =>
        (!status ||
          (status === "completed" ? item.concluida : !item.concluida)) &&
        (!search ||
          `${item.titulo} ${item.descricao || ""}`
            .toLocaleLowerCase("pt-BR")
            .includes(search)),
    );
  }

  function render() {
    const summary = summarizeTasks(items, today());
    $("task-pending").textContent = summary.pending;
    $("task-completed").textContent = summary.completed;
    $("task-overdue").textContent = summary.overdue;
    $("task-count").textContent = summary.pending;

    const filtered = filteredItems();
    $("task-list-count").textContent = `${filtered.length} ${filtered.length === 1 ? "tarefa" : "tarefas"}`;
    const list = $("task-list");
    list.replaceChildren();
    if (!filtered.length) {
      const empty = element("div", null, "empty task-empty");
      empty.append(
        element("span", null, "empty-mark"),
        element(
          "h3",
          items.length
            ? "Nenhuma tarefa corresponde aos filtros."
            : "Sua lista de tarefas está vazia.",
        ),
        element(
          "p",
          items.length
            ? "Ajuste a busca ou o filtro para encontrar outras tarefas."
            : "Crie uma tarefa e marque quando ela estiver concluída.",
        ),
      );
      list.append(empty);
      return;
    }

    const currentDay = today();
    for (const item of filtered) {
      const overdue = !item.concluida && item.data_limite && item.data_limite < currentDay;
      const row = element(
        "article",
        null,
        `task-row${item.concluida ? " completed" : ""}${overdue ? " overdue" : ""}`,
      );
      row.dataset.id = item.id;
      const toggle = element("button", null, "task-toggle");
      toggle.type = "button";
      toggle.setAttribute(
        "aria-label",
        item.concluida ? `Reabrir ${item.titulo}` : `Concluir ${item.titulo}`,
      );
      toggle.setAttribute("aria-pressed", String(item.concluida));
      toggle.onclick = () => run(() => toggleCompleted(item));

      const content = element("div", null, "task-content");
      content.append(element("strong", item.titulo));
      if (item.descricao) content.append(element("p", item.descricao));
      content.append(
        element(
          "small",
          item.concluida
            ? `Concluída${item.concluida_em ? ` em ${new Date(item.concluida_em).toLocaleDateString("pt-BR")}` : ""}`
            : overdue
              ? `Atrasada desde ${formatDate(item.data_limite)}`
              : item.data_limite
                ? `Prazo: ${formatDate(item.data_limite)}`
                : "Sem prazo definido",
          "task-meta",
        ),
      );

      const actions = element("div", null, "task-row-actions");
      actions.append(
        actionButton("Editar", () => openForm(item)),
        actionButton(
          "Excluir",
          () => {
            deleteId = item.id;
            $("task-delete-dialog").showModal();
          },
          "text-button delete-button",
        ),
      );
      row.append(toggle, content, actions);
      list.append(row);
    }
  }

  async function refresh() {
    if (!user) return;
    items = check(
      await client
        .from("tarefas")
        .select("*")
        .order("concluida", { ascending: true })
        .order("data_limite", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(1000),
    );
    render();
  }

  function openForm(item = null) {
    $("task-form").reset();
    $("task-id").value = item?.id || "";
    $("task-dialog-title").textContent = item ? "Editar tarefa" : "Nova tarefa";
    $("task-title").value = item?.titulo || "";
    $("task-due-date").value = item?.data_limite || "";
    $("task-description").value = item?.descricao || "";
    $("task-is-completed").checked = !!item?.concluida;
    $("task-dialog").showModal();
    $("task-title").focus();
  }

  async function save() {
    const id = $("task-id").value;
    const completed = $("task-is-completed").checked;
    const previous = items.find((item) => item.id === id);
    const payload = {
      user_id: user.id,
      titulo: $("task-title").value.trim(),
      descricao: $("task-description").value.trim() || null,
      data_limite: $("task-due-date").value || null,
      concluida: completed,
      concluida_em: completed ? previous?.concluida_em || new Date().toISOString() : null,
    };
    if (!payload.titulo) throw new Error("Informe o título da tarefa.");
    if (id) check(await client.from("tarefas").update(payload).eq("id", id));
    else check(await client.from("tarefas").insert(payload));
    $("task-dialog").close();
    await refresh();
    notice(id ? "Tarefa atualizada." : "Tarefa criada.");
  }

  async function toggleCompleted(item) {
    const completed = !item.concluida;
    check(
      await client
        .from("tarefas")
        .update({
          concluida: completed,
          concluida_em: completed ? new Date().toISOString() : null,
        })
        .eq("id", item.id),
    );
    await refresh();
    notice(completed ? "Tarefa concluída." : "Tarefa reaberta.");
  }

  $("task-form").onsubmit = (event) => {
    event.preventDefault();
    run(save);
  };
  $("task-close").onclick = () => $("task-dialog").close();
  $("task-cancel").onclick = () => $("task-dialog").close();
  $("task-add-top").onclick = () => openForm();
  $("new-task").onclick = () => openForm();
  $("task-search").addEventListener("input", render);
  $("task-status-filter").addEventListener("change", render);
  $("task-delete-cancel").onclick = () => $("task-delete-dialog").close();
  $("task-delete-confirm").onclick = () => {
    $("task-delete-dialog").close();
    run(async () => {
      check(await client.from("tarefas").delete().eq("id", deleteId));
      await refresh();
      notice("Tarefa excluída.");
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
