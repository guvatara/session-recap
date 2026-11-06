# Foundry VTT v14: что учесть при разработке модулей

Проверено на практике (модуль под dnd5e/PF2e, Foundry v14.370 Stable, ноябрь 2026).

## Критичные изменения (сломают старый код)

**1. Кастомные чат-команды — только через `ChatLog.CHAT_COMMANDS`**

Старый паттерн «перехватить неизвестную команду хуком `chatMessage` и вернуть `false`» не работает: `ChatLog.processMessage` выбрасывает `Error: /cmd не является командой чата` ещё до хука. Регистрация:

```js
const ChatLogClass = foundry.applications.sidebar.tabs.ChatLog;
ChatLogClass.CHAT_COMMANDS.recap = {
  rgx: /^\/recap(?:\s+(.+))?$/,
  fn: async (command, match, chatData, createOptions) => {
    // ...обработка...
    return false; // не создавать сообщение от самой команды
  }
};
```

Записи — `{ rgx, fn, mode?, isRoll?, isMultiline? }`, матчатся в порядке вставки. Хук `chatMessage` в v14 формально ещё есть, но для команд его недостаточно — оставляйте его только как fallback для v12–13.

**2. Хук `renderChatMessage` удалён → `renderChatMessageHTML`**

Новый хук: `(message, html /* HTMLElement */, context)`. jQuery больше не передаётся — работайте с DOM напрямую (`querySelector`, `addEventListener`). Для кросс-версии вешайте оба хука: неизвестное имя в `Hooks.on` не вызывает ошибку, просто не сработает.

**3. jQuery в хуках рендера ушёл везде**

Приложения — ApplicationV2, в хуках приходит `HTMLElement`. Паттерн-адаптер:

```js
const el = html instanceof HTMLElement ? html : html?.[0];
```

## Deprecated, но пока работает (до v16)

- `ChatMessage.create({ whisper: [...] })` — поле есть в схеме, но рекомендована опция `messageMode` (`"public" | "gm" | "blind" | "self"`, ключи `CONFIG.ChatMessage.modes`)
- `ChatLog.MESSAGE_PATTERNS`, `ChatLog.MULTILINE_COMMANDS` — заменены на `CHAT_COMMANDS` (записи проксируются)
- `rollMode` в опциях создания сообщения → `messageMode`

## Что НЕ изменилось (можно не трогать)

- Документные хуки: `createChatMessage`, `deleteCombat` и т.д. — работают как раньше
- `ChatMessage.getWhisperRecipients("GM")`, `game.users.activeGM`
- `game.settings.register` / world-scope настройки
- Формат `module.json`; поля `url` / `manifest` / `download` для установки по ссылке

## Совместимость v12–v14 в одном модуле

```js
const ChatLogClass = foundry?.applications?.sidebar?.tabs?.ChatLog ?? globalThis.ChatLog;
if (ChatLogClass?.CHAT_COMMANDS) { /* v14: нативная команда */ }
// иначе v12–13: fallback на Hooks.on("chatMessage", ...)
```

В `module.json`: `"compatibility": { "minimum": "12", "verified": "14" }`.

## Детекция бросков dnd5e / PF2e (системно-зависимые флаги)

- Урон dnd5e: `message.flags.dnd5e.roll.type === "damage"` (лечение — `"healing"` или damage с `damageTypes` включающим `"healing"`)
- Урон PF2e: `message.flags.pf2e.context.type === "damage-roll"` (лечение — тот же тип, но `context.options` содержит строку с `healing`)
- Нат. 20/1 системно-независимо: перебирать `roll.dice`, брать кости `faces === 20`, учитывать только `result.active`

## Источники истины

- API-доки актуальной версии: `foundryvtt.com/api` (сейчас отдаёт v14; хуки — `functions/hookEvents.*.html`)
- Типы сообщества: github.com/League-of-Foundry-Developers/foundry-vtt-types — точные сигнатуры (`ChatCommandPattern`, `ChatCommandCallback`)
- Ченджлоги мажорных модулей (midi-qol и др.) — быстрый способ узнать о ломающих изменениях
