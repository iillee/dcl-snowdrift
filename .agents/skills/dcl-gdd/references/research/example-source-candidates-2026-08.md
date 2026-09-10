# Подбор игры-источника для filled example шаблона (light)

Дата: 2026-08-25. Задача: выбрать реальную, живую, хорошо задокументированную игру, чьё ядро ложится в мини-DCL-v1 по `Game Design Document -template.md` (на момент ресёрча — `gdd-proposal-template-light.md`) (social-first, replayable, mobile-first, 2–20 игроков, 6 недель). Example — вымышленная DCL-адаптация её механик; сама игра идёт в Section 8 Comparables.

Связанные файлы: `pitch-deck-archives-research-2026-08.md`, `funding-pitch-research-2026-08.md`, `metaverse-ugc-funding-research-2026-08.md`.

---

## 1. Локальные материалы: проверено, не подходят

Оба локальных архива питч-деков (GameDiscoverCo + Glitch Founder's Kit, 27 документов в `research/pitch-decks/`) — почти целиком **сингловые инди** (Cosmoteer, Beacon Pines, Bear & Breakfast, Diablo, Bioshock…). Fall Guys и Slime Rancher в архивах **нет**. Ни один локальный дек не проходит критерий social-first: ценность этих игр не зависит от присутствия других людей. Локальный приоритет снят — источник ищем в вебе. (Локальные деки остаются полезны как эталон *формы* подачи — hook, loop-диаграммы, comps — но не как источник механик.)

---

## 2. Таблица кандидатов

| Игра | Тип публичной фактуры | Что берём для DCL-адаптации | Риски / минусы |
|---|---|---|---|
| **Among Us** (Innersloth, 2018) | Интервью основателей (Nintendo с Forest Willard — происхождение из Mafia + "The Thing", решение «idle player problem» через task-минигры), GDC-постмортем Among Us VR (перенос петли в embodied 3D — прямой аналог DCL-переноса), talks Victoria Tran (community/social design), метрики SuperData, подробная dev-история в Wikipedia | Социальная дедукция: tasks → observe → report → discuss → vote; «ship always in crisis»; лобби 4–15; mobile-first от рождения (запуск — mobile, touch); раунд 10–15 мин | Не playable alone (нужен solo-режим на quiet hours); дискуссия требует чата/войса; узнаваемый trade dress (бобы, «sus») — обходить; серверная авторитетность роли impostor |
| **Fall Guys** (Mediatonic, 2020) | **Реальный публичный питч-дек** («Fool's Gauntlet», тред Jeff Tanton, 2020), интервью Joe Walsh (Game Dev Unchained #249, AIAS Game Maker's Notebook, Creative Review), LA Times о пайплайне уровней, GDC 2024 о 650K CCU | Раундовая полоса препятствий, «making failing fun», физическая комедия, короткие забеги, эстетика game show | 60-player scale — ядро не про 2–20; социальность параллельная, не интерактивная (disappearance test почти проходит без людей); физика/рэгдоллы дороги в SDK7 за 6 недель |
| **Gartic Phone** (Onrizon, 2020) | История студии (Medium Onrizon), разбор UGC-виральности (Lurkit), обзорные статьи; постмортемов/GDC нет | «Испорченный телефон» рисунками: write → draw → guess → reveal; «parallel worlds» (все ходят одновременно, никто не ждёт); reveal как встроенный shareable moment | Фактура заметно тоньше; игра целиком UI-канвас — 3D-сцена и аватары почти не нужны, плохо демонстрирует DCL-world-дизайн; нет публичных lobbies by design |
| **Adopt Me!** (Uplift Games / DreamCraft, 2017) | Интервью PC Games Insider и Vice (Josh Ling, Derrick Fields), рекорд 1.92M CCU, рост MAU 30→60M, dev-интервью NewFissy | Pet care loop, aging/hatching как appointment-таймеры, trading как социальный клей, роли baby/parent | Экономика + трейдинг + персистентность — не собрать честный v1 за 6 недель; retention-фактура больше бизнесовая, чем дизайнерская; abuse-риски трейдинга |
| **skribbl.io** (ticedev, 2017) | Практически нет: соло-разработчик, без постмортемов; только обзоры и клоны | Draw & guess по кругу, мгновенный drop-in, очки за скорость угадывания | Example заполнялся бы выдумкой, а не фактами — провал критерия №1; UI-игра, та же проблема, что у Gartic Phone |
| **Tower of Hell / DOORS** (Roblox-хиты) | Тонкая: wiki, ютуб-разборы, редкие интервью; дизайн-документации нет | ToH: секционная башня без чекпоинтов, таймер-ресет как общий appointment; DOORS: co-op хоррор-комнаты | Мало проверяемой фактуры; ToH почти асоциальна (параллельный паркур); DOORS — контент-тяжёлый хоррор, сложный для greybox |
| **Slime Rancher** (Monomi Park, 2017) | Богатая: GDC «preemptive postmortem» Nick Popovich, много интервью | Каденция «ranch chores» как daily loop, collection-хуки | **Сингл** — проваливает social-first полностью; open-world ranch не режется до мини-сцены |
| **Goose Goose Duck** (Gaggle Studios, 2021) | Средняя: пресса о пике 700K CCU (K-pop эффект), немного интервью | Тот же social deduction + встроенный voice, доп. роли как источник freshness на repetition 10 | Сам является клоном Among Us — как comparable слабее оригинала; фактура о *дизайне* тонкая |

---

## 3. Финальная рекомендация: **Among Us**

1. **Лучшая social-first фактура из существующих.** Ядро — образцовый ответ на Section 5: дизайн игры *есть* социальная петля (signal → respond → discuss → vote), а disappearance test даёт честный крайний случай, который шаблон прямо просит обсуждать. Задокументировано первоисточниками: интервью Willard (Nintendo), talks Victoria Tran, dev-история.
2. **Ядро идеально ложится в мини-DCL-v1.** Одна маленькая карта (The Skeld — компактный корабль), лобби 4–15 (внутри программной рамки 2–20), раунд 10–15 минут, touch-управление родное (игра запускалась как mobile-only) — каждая цифра шаблона заполняется наблюдаемым фактом, а не выдумкой.
3. **Уникальный бонус: GDC-постмортем Among Us VR** — команда Schell Games публично разобрала перенос той же петли из top-down 2D в embodied 3D от первого лица. Это ровно та задача, которую решает DCL-адаптация (аватары, обзор от третьего лица, комнаты), — готовый список граблей для секций 5–7.

Живость: игра до сих пор узнаваема и оперируется (Among Us 3D в 2025, публичный 2026 roadmap Innersloth) — годится как наблюдаемый comparable для Section 8.

---

## 4. Инвентарь фактуры по Among Us под секции шаблона

### Core loop (Section 3) — глаголы
- **Crewmate:** move → **do task** (короткая минигра у станции) → **observe** (кто где был) → **report** body / call meeting → **discuss** → **vote** → раунд продолжается или завершается.
- **Impostor:** **blend** (fake tasks) → **sabotage** (кризисы систем) → **eliminate** → **deceive** на голосовании.
- Ключевые дизайн-решения из первоисточника (интервью Willard, Nintendo): tasks введены, чтобы решить главную проблему настольной Mafia — выбывшим и «мирным» игрокам нечего делать («players need constant engagement»); корабль задуман «always in crisis»; impostor может делать вид, что выполняет tasks, — маскировка встроена в ту же петлю.
- Источники: https://www.nintendo.com/en-ca/whatsnew/among-us-dev-recounts-how-the-game-took-flight/ ; https://en.wikipedia.org/wiki/Among_Us (раздел Development: происхождение из детской Mafia-игры + «The Thing», провал «Space Mafia» до этого).

### Сессия и длительность (Sections 2–3)
- Раунд: в среднем **10–15 минут** включая discussion и voting; в пике 2020 сообщество играло и по 5–10 минут. Несколько раундов за визит — естественная структура «several short visits».
- Источники: https://theglobalgaming.com/gaming/average-match-time-length-among-us ; https://www.playbite.com/q/how-long-is-an-average-game-of-among-us

### Return-хуки (Section 4)
- В оригинале D1 держится не механикой, а **социальным appointment**: «мы с этими же людьми соберёмся завтра» — лобби друзей/стримеров; рост целиком через стримеров (Sodapoppin, июль 2020) и pandemic-потребность в связи. Урок для адаптации: return reason живёт «in the player's friends» (формула шаблона), а механические хуки (streak, weekly reset) придётся добавлять в адаптации самим — у оригинала их почти нет, и это честно указать в Comparables как «what does not fit».
- Прогрессия в оригинале слабая (косметика) — тоже аргумент «what we will do differently».
- Источники: https://en.wikipedia.org/wiki/Among_Us (Reception/History) ; https://www.gamesradar.com/among-us-gained-almost-half-a-billion-players-in-2020/

### Социальная петля и почему играют вместе (Section 5)
- Петля: Player A **reports** body → все **обсуждают** (каждое слово — social signal) → **голосуют** → последствие видно всем (выброшен невиновный/пойман impostor) → мгновенный повод на «ещё раунд». Ответ добровольный и меняет исход другого игрока — ровно определение шаблона.
- Disappearance test: игра **ломается полностью** без людей — полезный контраст для честного ответа в example (и причина, почему адаптации нужен solo-слой).
- Recognition & continuity: цвет/ник + репутация («он в прошлом раунде соврал») — межраундовая память между знакомыми игроками.
- Community/social-design фактура: talks и книга Victoria Tran (Innersloth) о модерировании общности в полмиллиарда игроков — https://www.victoriatran.com/talks ; https://www.digitaltrends.com/gaming/victoria-tran-innersloth-kind-game-design/
- Перенос петли в 3D-аватары: GDC «Emergency Meeting! It's the 'Among Us VR' Postmortem» — https://gdcvault.com/play/1029096/ ; https://www.gamedeveloper.com/marketing/bringing-sus-vibes-to-a-new-perspective-with-among-us-vr

### Quiet hours / число игроков (Section 5)
- Официально «party game of teamwork and betrayal for **4-15 players**» (до версии 2021.6.15 — максимум 10; impostors 1–3). Для example: social threshold 4–5, ideal 8–10, tested max 10–15 — все цифры наблюдаемые.
- Quiet hours у оригинала не решены (ждёшь лобби) — в адаптации закрываем solo-слоем (см. §5 ниже).
- Источники: https://among-us.fandom.com/wiki/Lobby ; https://screenrant.com/among-us-update-15-player-lobbies-better-why/

### Метрики и удержание (Sections 8, 10)
- ~**500M MAU в ноябре 2020** (SuperData) — рекорд по месячным игрокам; Innersloth тогда — 4 человека; 64% выручки давала $5 PC-версия при ~3% игроков на PC (остальное — free mobile).
- D1/D7 оригинала не публиковались — в example так и писать: удержание оригинала неизвестно, наша v1 меряется программным dashboard D7.
- Живость: Among Us 3D (2025), https://www.innersloth.com/2026-roadmap-part-2/
- Источники: https://mynintendonews.com/2020/12/22/superdata-among-us-had-roughly-half-a-billion-monthly-active-users-in-november-2020/ ; https://www.gamesradar.com/among-us-gained-almost-half-a-billion-players-in-2020/

### Визуальный стиль (Section 7)
- Высококонтрастные цветокодированные «бобы» на тёмном фоне: игрок = цвет, читается на маленьком экране мгновенно; станции задач с уникальными силуэтами; минимальный HUD (кнопки Use/Report/Kill фиксированы в углах — готовый образец touch-раскладки для Section 6). Ранние концепты персонажей публиковал Marcus Bromander: https://www.gamedeveloper.com/art/early-i-among-us-i-character-concepts-depict-the-birth-of-the-bean
- Для DCL: цветокод переносим на командные маркеры/оверлеи над аватарами (свои аватары у игроков уже есть — trade dress бобов не трогаем).

---

## 5. Заготовка DCL-адаптации (для example)

- **Рабочее название (вымышленное):** «Dock 7» (варианты: «Hull Duty», «Drift Station»). Маленькая орбитальная станция; никаких бобов, слова «sus», «emergency meeting» и прочего trade dress Innersloth. Сама механика social deduction не защищена IP (жанр Mafia/Werewolf, есть клоны вроде Goose Goose Duck) — в example это и есть строка IP self-check: clear.
- **Какое ядро берём:** crew выполняет короткие touch-минигры-задачи по станции; один скрытый **saboteur** портит системы и «замораживает» членов экипажа (без kill-анимаций — мягче по Content Policy и проще в SDK7); найденный замороженный → общий сбор → чат-голосование. Лобби 4–10, раунд ~8–12 минут.
- **Solo-слой на quiet hours (чего нет у оригинала):** одиночные «maintenance shifts» — те же task-минигры на время с досками рекордов; играбельно одному, а раунд с saboteur включается от 4 игроков (social threshold).
- **Что режем для v1 (кандидаты в "Not building"):** (1) вторая карта; (2) косметика/прогрессия-магазин; (3) дополнительные роли (engineer, sheriff…) — источник freshness для v2. Задач в v1 — максимум 3 примера по правилу шаблона.
- **Top risk для Section 9:** честность роли saboteur при клиентском P2P-состоянии сцены + дискуссия без общего языка/войса (fallback: quick-chat пиктограммы + указание на подозреваемого кликом).
