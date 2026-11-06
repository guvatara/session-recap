/**
 * Session Recap Lite
 * Маленький модуль: собирает события сессии (нат. 20 / нат. 1 на d20,
 * нанесённый урон, завершённые бои, ручные заметки GM), публикует сводку
 * в чат и сохраняет её страницей журнала.
 *
 * Команды чата:
 *   /recap            — опубликовать сводку (видят все)
 *   /recap gm         — сводку видит только GM
 *   /recap journal    — сохранить сводку страницей журнала
 *   /recap note Текст — добавить заметку в сводку
 *   /recap clear      — очистить накопленные события и статистику
 *
 * Настройки мира (Configure Settings -> Module Settings):
 *   - автопубликация сводки при завершении боя
 *   - видимость автосводки (только GM / все)
 */

const MODULE_ID = "session-recap";

/* ---------- Хранилище: события и статистика живут в world-настройках ---------- */

function getEvents() {
  return game.settings.get(MODULE_ID, "events") ?? [];
}

function getStats() {
  return game.settings.get(MODULE_ID, "stats") ?? { damageTotal: 0, damageByActor: {} };
}

async function addEvent(kind, text) {
  const events = getEvents();
  events.push({
    kind,                       // "crit" | "fumble" | "note" | "combat"
    text,
    time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  });
  await game.settings.set(MODULE_ID, "events", events);
}

async function addDamage(actorName, amount) {
  const stats = getStats();
  stats.damageTotal = (stats.damageTotal ?? 0) + amount;
  stats.damageByActor = stats.damageByActor ?? {};
  stats.damageByActor[actorName] = (stats.damageByActor[actorName] ?? 0) + amount;
  await game.settings.set(MODULE_ID, "stats", stats);
}

/* ---------- Инициализация ---------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "events", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, "stats", {
    scope: "world",
    config: false,
    type: Object,
    default: { damageTotal: 0, damageByActor: {} }
  });

  game.settings.register(MODULE_ID, "autoRecapCombat", {
    name: "Сводка после боя",
    hint: "Автоматически публиковать сводку сессии, когда GM завершает бой.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "autoRecapGmOnly", {
    name: "Автосводку видит только GM",
    hint: "Если выключено, автосводка после боя публикуется для всех игроков.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  // Foundry v14+: нативная регистрация команды /recap в реестре ChatLog
  const ChatLogClass = foundry?.applications?.sidebar?.tabs?.ChatLog ?? globalThis.ChatLog;
  if (ChatLogClass?.CHAT_COMMANDS) {
    ChatLogClass.CHAT_COMMANDS.recap = {
      rgx: /^\/recap(?:\s+(.+))?$/,
      fn: async (command, match) => {
        await handleRecapCommand((match[1] ?? "").trim());
        return false; // не создавать сообщение от самой команды
      }
    };
  }
});

/* ---------- Определение типа броска: dnd5e и PF2e ---------- */

function isDamageRoll(message) {
  // D&D 5e: flags.dnd5e.roll.type === "damage"
  if (message.flags?.dnd5e?.roll?.type === "damage") return true;
  // PF2e: flags.pf2e.context.type === "damage-roll"
  if (message.flags?.pf2e?.context?.type === "damage-roll") return true;
  return false;
}

/* ---------- Сбор событий из новых сообщений чата ---------- */

Hooks.on("createChatMessage", (message) => {
  const rolls = message.rolls;
  if (!rolls?.length) return;

  const actorName = message.speaker?.alias ?? "Кто-то";

  // Подсчёт урона
  if (isDamageRoll(message)) {
    const total = rolls.reduce((sum, roll) => sum + (roll.total ?? 0), 0);
    if (total > 0) addDamage(actorName, Math.round(total));
  }

  // Натуральные 20 и 1 на d20
  for (const roll of rolls) {
    for (const die of roll.dice ?? []) {
      if (die.faces !== 20) continue;
      for (const result of die.results) {
        if (!result.active) continue; // переброшенные кости не считаем
        if (result.result === 20) {
          addEvent("crit", `${actorName} выбил натуральную 20!`);
        } else if (result.result === 1) {
          addEvent("fumble", `${actorName} выбросил натуральную 1...`);
        }
      }
    }
  }
});

/* ---------- Автосводка при завершении боя ---------- */

Hooks.on("deleteCombat", async () => {
  if (!game.settings.get(MODULE_ID, "autoRecapCombat")) return;

  // Публикует только один активный GM, а не все подключённые
  const activeGM = game.users.activeGM;
  if (!game.user.isGM || (activeGM && game.user.id !== activeGM.id)) return;

  await addEvent("combat", "Бой завершён");
  await postRecap(game.settings.get(MODULE_ID, "autoRecapGmOnly"));
});

/* ---------- Команда /recap ---------- */

async function handleRecapCommand(rest) {
  if (rest.startsWith("note")) {
    const noteText = rest.slice(4).trim();
    if (noteText) {
      await addEvent("note", noteText);
      ui.notifications.info("Session Recap: заметка добавлена.");
    }
  } else if (rest === "clear") {
    await game.settings.set(MODULE_ID, "events", []);
    await game.settings.set(MODULE_ID, "stats", { damageTotal: 0, damageByActor: {} });
    ui.notifications.info("Session Recap: события и статистика очищены.");
  } else if (rest === "journal") {
    await saveRecapToJournal();
  } else {
    await postRecap(rest === "gm");
  }
}

// Foundry v12–13: перехват команды через хук ввода (в v14 работает CHAT_COMMANDS выше)
Hooks.on("chatMessage", (chatLog, text) => {
  const ChatLogClass = foundry?.applications?.sidebar?.tabs?.ChatLog ?? globalThis.ChatLog;
  if (ChatLogClass?.CHAT_COMMANDS) return; // v14: команда уже обработана нативно

  const trimmed = text.trim();
  if (!trimmed.startsWith("/recap")) return; // не наша команда — пропускаем дальше

  handleRecapCommand(trimmed.slice("/recap".length).trim());
  return false; // не отправляем саму команду в чат
});

/* ---------- HTML сводки ---------- */

function buildRecapHtml({ withButton = false } = {}) {
  const events = getEvents();
  const stats = getStats();

  const icons = { crit: "🎯", fumble: "💥", note: "📝", combat: "⚔️" };
  const rows = events.length
    ? events.map(e => `<li class="recap-${e.kind}"><span class="recap-time">${e.time}</span> ${icons[e.kind] ?? "•"} ${e.text}</li>`).join("")
    : `<li class="recap-empty">Пока ничего не произошло — сессия только начинается!</li>`;

  // Блок статистики урона (показываем, только если урон был)
  let statsBlock = "";
  if (stats.damageTotal > 0) {
    const entries = Object.entries(stats.damageByActor).sort((a, b) => b[1] - a[1]);
    const [topName, topDamage] = entries[0];
    const perActor = entries.map(([name, dmg]) => `${name} — ${dmg}`).join(", ");
    statsBlock = `
      <div class="recap-stats">
        ⚔️ <b>Урон за сессию:</b> ${stats.damageTotal} (лучший: ${topName} — ${topDamage})
        <div class="recap-stats-detail">${perActor}</div>
      </div>`;
  }

  const button = withButton
    ? `<button type="button" class="recap-save-journal">📓 Сохранить в журнал</button>`
    : "";

  return `
    <div class="session-recap">
      <h3>📜 Сводка сессии</h3>
      <ul>${rows}</ul>
      ${statsBlock}
      ${button}
    </div>`;
}

/* ---------- Публикация сводки в чат ---------- */

async function postRecap(gmOnly = false) {
  await ChatMessage.create({
    content: buildRecapHtml({ withButton: game.user.isGM }),
    whisper: gmOnly ? ChatMessage.getWhisperRecipients("GM") : [],
    flags: { [MODULE_ID]: { isRecap: true } }
  });
}

/* ---------- Кнопка «Сохранить в журнал» в сообщении сводки ---------- */

function attachJournalButton(message, el) {
  if (!el?.querySelector) return;
  if (!message.flags?.[MODULE_ID]?.isRecap) return;
  if (!game.user.isGM) return; // кнопка только для GM

  const button = el.querySelector(".recap-save-journal");
  if (button) button.addEventListener("click", () => saveRecapToJournal());
}

// Foundry v13+ (html — HTMLElement)
Hooks.on("renderChatMessageHTML", (message, html) => attachJournalButton(message, html));

// Foundry v12 (html — jQuery)
Hooks.on("renderChatMessage", (message, html) => {
  attachJournalButton(message, html instanceof HTMLElement ? html : html?.[0]);
});

/* ---------- Сохранение сводки страницей журнала ---------- */

async function saveRecapToJournal() {
  if (!game.user.isGM) {
    ui.notifications.warn("Session Recap: сохранять в журнал может только GM.");
    return;
  }

  const date = new Date().toLocaleDateString("ru-RU");
  const journal = await JournalEntry.create({
    name: `Сводка сессии — ${date}`,
    pages: [{
      name: "Сводка",
      type: "text",
      text: { format: 1, content: buildRecapHtml() }
    }]
  });

  if (journal) {
    ui.notifications.info(`Session Recap: создан журнал «${journal.name}».`);
    journal.sheet.render(true);
  }
}
