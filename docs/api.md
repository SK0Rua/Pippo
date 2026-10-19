# Довідник API

Усі маршрути під `/api`. Формат — JSON. Змінювальні запити **мають** мати
`content-type: application/json`, інакше `415`.

Авторизація — cookie `pippo_sid` (див. [auth.md](auth.md)). Позначка 🔒 означає, що без входу
буде `401`, 👑 — потрібні права адміністратора (`403` для решти).

Помилки завжди виглядають так:

```json
{ "error": "Текст українською" }
```

| Код | Коли |
| --- | --- |
| 400 | некоректні дані |
| 401 | не увійшов |
| 402 | не вистачає зерняток |
| 403 | не адміністратор |
| 404 | немає такого запису або він чужий |
| 409 | конфлікт (дубль, повторна дія) |
| 410 | скасування вже неможливе |
| 415 | запит не JSON |
| 429 | перевищено ліміт |
| 501 | функція потребує `GEMINI_API_KEY` |
| 502 | ШІ недоступний |

---

## Акаунт

### `POST /api/auth/register`
`{ username, password, timezone? }` → `{ user }`. Створює акаунт, словник, дає 50 🌾 і сесію.

### `POST /api/auth/login`
`{ username, password }` → `{ user }`.

### `POST /api/auth/logout`
Видаляє сесію.

### `GET /api/me`
`{ user }` або `{ user: null }` — єдиний маршрут, який не сердиться на гостя.

Об'єкт `user`:

```json
{ "id": 1, "username": "valik", "dailyGoal": 20, "xp": 415, "streak": 3, "bestStreak": 7,
  "todayAnswers": 12, "grains": 130, "isAdmin": true, "timezone": "Europe/Kyiv",
  "canChangeTimezone": true, "createdAt": 1789656563471 }
```

### `PATCH /api/me` 🔒
`{ dailyGoal? }` — від 10 до 200. `{ timezone? }` — не частіше разу на тиждень.

### `GET /api/grains` 🔒
Баланс, прогрес за сьогодні, розміри нагород і останні 40 записів журналу.

---

## Словники

### `GET /api/decks` 🔒
```json
{ "decks": [{ "id": 2, "name": "Готель", "langFrom": "en", "langTo": "uk", "packId": "hotel",
              "total": 20, "mastered": 3, "due": 5, "fresh": 12 }] }
```

### `POST /api/decks` 🔒
`{ name, langFrom?, langTo? }` → `{ id }`. Максимум 150 словників.

### `PATCH /api/decks/:id` 🔒 · `DELETE /api/decks/:id` 🔒
Видалення повертає `{ ok, token, undoLabel, undoSeconds }` — 90 секунд дію можна скасувати.

### `POST /api/decks/:id/import` 🔒
`{ text }` → `{ added, skipped }`. Рядок: `слово;переклад;приклад;транскрипція`.
Також розуміє табуляцію, ` - `, ` — `, `=`. Дублікати пропускаються, максимум 5000 рядків.

### `GET /api/decks/:id/export` 🔒
CSV із BOM (Excel відкриє без танців із кодуванням).

---

## Слова

### `GET /api/words` 🔒
`?deckId=` — слова словника. `?q=` — пошук по **всіх** словниках за словом і перекладом,
до 100 результатів, у відповіді є `deckName`.

### `POST /api/words` 🔒
`{ deckId, term, translation, example?, transcription? }` → `{ word }`.
Дубль у межах словника → `409`.

### `PATCH /api/words/:id` 🔒
Будь-яке з полів плюс `starred`, `deckId` (перенести), `reset: true` (скинути прогрес).

### `DELETE /api/words/:id` 🔒
`{ ok, token, ... }` — теж зі скасуванням, прогрес повертається повністю.

### `POST /api/undo/:token` 🔒
Повертає видалене. Чужий або протермінований токен → `410`.

---

## Тренування

### `POST /api/quiz` 🔒
```json
{ "deckId": null, "mode": "choice", "source": "smart", "count": 10, "wordIds": [] }
```
`source`: `smart` (спершу те, що пора повторити, потім нові, потім найслабші) · `all` · `hard` · `new` · `starred`.
`count` обмежується 3–50. Дублі слів прибираються.

Відповідь: `{ sessionId, words, pool }`. `pool` — варіанти для режиму вибору.

### `POST /api/answer` 🔒
`{ sessionId, wordId, correct, hinted? }` → `{ box, xp, grains, events, goalReached, capReached, packCompleted, user }`.

Перевірки: слово має бути з цієї сесії, відповідь на нього — перша, сесія не завершена,
темп не швидший за ~1 відповідь на 0.7 с (інакше нараховується нуль).

### `POST /api/quiz/finish` 🔒
`{ sessionId }` → `{ bonus, total, correct, user }`. Підсумок рахує сервер; повторний виклик → `409`.

---

## Магазин

### `GET /api/shop` 🔒
Баланс, ліміти за сьогодні, `dealId` (пак дня), `firstFree` і список паків із ціною **для цього
користувача** (з урахуванням відомих слів і знижки дня), прев'ю на 5 слів і станом `owned`.

### `POST /api/shop/:id/buy` 🔒
Тіло ігнорується повністю. Сервер сам рахує ціну, списує зернятка й створює словник.
`{ deckId, added, price, restored, user }`.

`402` — не вистачає зерняток, `409` — пак уже є, `404` — немає такого пака.
Якщо словник пака видалили, повторна покупка безкоштовна (відновлення).

---

## ШІ

Ліміти на акаунт і вартість дій — у [ai.md](ai.md).

### `GET /api/ai/status` 🔒
`{ gemini: true, allowance: { hour, day, requests, limits } }`.

### `POST /api/ai/lookup` 🔒
`{ deckId, word, sentence? }` → `{ card, exists }`. Без речення бере найуживаніші значення
й сам вигадує приклад. Коштує 1 слово.

```json
{ "card": { "term": "to leave", "translation": "залишати у спадок, заповідати",
            "transcription": "/liːv/", "partOfSpeech": "verb",
            "otherMeanings": ["покидати", "від'їжджати"],
            "explanation": "Передати майно комусь після смерті.",
            "example": "My uncle is going to leave me £2,000 when he dies.",
            "source": "gemini" } }
```

### `POST /api/ai/batch` 🔒
`{ deckId, words: [...] }` — до 30 слів за раз → `{ items }`. Коштує стільки слів, скільки надіслано.

### `POST /api/ai/extract` 🔒
`{ deckId, text }` → `{ items }` — до 15 слів із тексту з рівнем CEFR. Коштує 10 слів.
Без `GEMINI_API_KEY` → `501`.

---

## Статистика

### `GET /api/stats` 🔒
Усе для сторінки «Прогрес»: підсумки, полички пам'яті, теплова карта, точність,
найскладніші слова, останні тренування, слово дня, пак дня, зернятка за сьогодні.

### `GET /api/admin/stats` 🔒👑
Аналітика: користувачі, навчання, активність за 30 днів, економіка, популярні паки,
навантаження на ШІ, таблиця користувачів, реєстрації за 30 днів.

---

## Приклад: додати слово з чужого клієнта

```bash
# вхід зі збереженням cookie
curl -c jar -H 'content-type: application/json' \
     -d '{"username":"valik","password":"secret123"}' \
     http://localhost:3700/api/auth/login

# переклад підкаже Pippo
curl -b jar -H 'content-type: application/json' \
     -d '{"deckId":1,"word":"resilient"}' \
     http://localhost:3700/api/ai/lookup

# зберегти
curl -b jar -H 'content-type: application/json' \
     -d '{"deckId":1,"term":"resilient","translation":"стійкий"}' \
     http://localhost:3700/api/words
```
