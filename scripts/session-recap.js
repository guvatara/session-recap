/**
 * Session Recap Lite
 * Маленький модуль: собирает события сессии (нат. 20 / нат. 1 на d20,
 * ручные заметки GM) и по команде /recap публикует сводку в чат.
 *
 * Команды чата:
 *   /recap            — опубликовать сводку (видят все)
 *   /recap gm         — сводку видит только GM
 *   /recap note Текст — добавить заметку в сводку
 *   /recap clear      — очистить накопленные события
 */

const MODULE_ID = "session-recap";

/* ---------- Хранилище: события живут в world-настройке, переживают F5 ---------- */

function getEvents() {
  return game.settings.get(MODULE_ID, "events") ?? [];
}

async function addEvent(kind, text) {
  const events = getEvents();
  events.push({
    kind,                       // "crit" | "fumble" | "note"
    text,
    time: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
  });
  await game.settings.set(MODULE_ID, "events", events);
}

/* ---------- Инициализация ---------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "events", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });
});

/* ---------- Сбор событий: смотрим броски d20 в новых сообщениях чата ---------- */

Hooks.on("createChatMessage", (message) => {
  // Реагируем только на сообщения с бросками
  const rolls = message.rolls;
  if (!rolls?.length) return;

  const actorName = message.speaker?.alias ?? "Кто-то";

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

/* ---------- Команда /recap ---------- */

Hooks.on("chatMessage", (chatLog, text) => {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/recap")) return; // не наша команда — пропускаем дальше

  const rest = trimmed.slice("/recap".length).trim();

  if (rest.startsWith("note")) {
    const noteText = rest.slice(4).trim();
    if (noteText) {
      addEvent("note", noteText);
      ui.notifications.info("Session Recap: заметка добавлена.");
    }
  } else if (rest === "clear") {
    game.settings.set(MODULE_ID, "events", []);
    ui.notifications.info("Session Recap: события очищены.");
  } else {
    postRecap(rest === "gm");
  }

  return false; // не отправляем саму команду в чат
});

/* ---------- Публикация сводки ---------- */

async function postRecap(gmOnly = false) {
  const events = getEvents();

  const icons = { crit: "🎯", fumble: "💥", note: "📝" };
  const rows = events.length
    ? events.map(e => `<li class="recap-${e.kind}"><span class="recap-time">${e.time}</span> ${icons[e.kind]} ${e.text}</li>`).join("")
    : `<li class="recap-empty">Пока ничего не произошло — сессия только начинается!</li>`;

  const content = `
    <div class="session-recap">
      <h3>📜 Сводка сессии</h3>
      <ul>${rows}</ul>
    </div>`;

  await ChatMessage.create({
    content,
    whisper: gmOnly ? ChatMessage.getWhisperRecipients("GM") : []
  });
}
