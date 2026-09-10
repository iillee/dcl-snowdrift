# Decentraland: платформенные аффордансы для секции «Platform fit» (август 2026)

**Дата:** 2026-08-23
**Задача:** собрать материал для новой секции «Platform fit» шаблона shortGDD — что игровой опыт использует из существующего ТОЛЬКО в Decentraland (уровень платформы, не SDK внутри сцены), и как дизайн живёт с предобусловленностями метавселенной.
**Метод:** публичные источники — docs.decentraland.org (новая структура на GitBook, старые URL частично 404), decentraland.org/blog, GitHub-релизы unity-explorer, пресс-релизы марта 2026, Places/Events сервисы.

---

## Сводка: топ-5 аффордансов, которые точно должны попасть в секцию

1. **Аватар как переносимая идентичность.** Игрок приходит «собой»: имя (NAME), внешний вид, надетые wearables, набор эмоций — всё это сцена может ЧИТАТЬ (`getPlayer()`: имя, userId/кошелёк, список надетых wearables, bodyShape, цвета, снапшоты лица/тела), но НЕ может менять. Это одновременно материал (реагировать на то, кто пришёл) и ограничение (визуальный тон сцены не контролируем).
2. **Wearables/emotes как «прогресс, который носится с собой».** Официальный Rewards-сервис раздаёт wearables/emotes прямо из сцены по HTTP; награда видна во ВСЕХ других сценах и на маркетплейсе — единственная в своём роде форма межсценового статуса/прогресса. Эталонный пример — WonderMine (крафт носимых NFT с 2020, живо в SDK7-версии).
3. **События как бесплатный канал дистрибуции.** events.decentraland.org: любой может публиковать (модерация Foundation, часы), RSVP → in-world алерт при старте, красные маркеры live-событий на карте Explorer'а (вкладка Events на карте — релизы 2025–2026), event board в Genesis Plaza, еженедельный ньюслеттер. Это де-факто ЕДИНСТВЕННАЯ push-механика, доступная креатору.
4. **Genesis City соседство vs Worlds — фундаментальная развилка дистрибуции.** LAND: спонтанный пеший трафик, соседи, POI, полная discoverability. Worlds: свой «остров» по NAME (100 MANA), до 100 одновременных игроков, 100+ MB, вход по ссылке/`/world name.dcl.eth`, но урезанная discoverability (в Places виден только если владелец NAME держит LAND или активную аренду). Выбор должен быть осознанным дизайн-решением.
5. **Социальный граф и Communities.** Друзья, онлайн-статус, jump-in к другу, DM; с сентября 2025 — Communities: чаты по интересам, привязанные к комьюнити события и community voice chat (роли owner/moderator/member, request-to-speak). Игра может строить удержание на комьюнити-петле, не строя свой Discord с нуля.

Побочная важная находка-минус: **smart wearables / portable experiences в 2026 мертвы** («Portable experiences are not currently supported in the latest versions of Decentraland») — в шаблоне стоит явно отговаривать от дизайна вокруг них. Также **старый Quests-сервис (quests-client) заархивирован 01.08.2025** — квесты теперь либо свои, либо через платформенные программы (Marketplace Credits, Exploration Games API).

---

## Разбор по аффордансам

### 1. Аватар и идентичность игрока

**(а) Что это, статус 2026.** Игрок входит в сцену уже существующим персонажем: аватар, имя, инвентарь wearables/emotes. Сцена через `getPlayer()` (SDK7, `@dcl/sdk/src/players`) читает: `name`, `userId`, `isGuest`, `wearables[]` (URN-ы надетого, включая NFT), `emotes`, `bodyShape`, `skinColor/hairColor/eyeColor`, `snapshots` (base64 jpg лица 256×256 и тела 512×1024). Полный инвентарь (не только надетое) — через lambdas-REST (`wearables-by-owner`). Реакция на переодевание — `AvatarEquippedData` onChange, работает и для других игроков в сцене. Менять надетое сцена НЕ может; может: скрыть аватары (`AvatarModifierArea` AMT_HIDE_AVATARS), скрыть нэймтеги, отключить паспорта, подменить аватара на управляемого NPC-двойника, ограничить локомоцию.
Источники: https://docs.decentraland.org/creator/development-guide/sdk7/user-data/ ; https://docs.decentraland.org/creator/scenes-sdk7/interactivity/player-avatar.md
Отличие от «обычного гейминга»: идентичность и коллекция существуют ДО и ПОСЛЕ визита, общие для всех сцен платформы.

**(б) Как использовать.**
- Приветствие по имени / реакция NPC на конкретные wearables («вижу, ты в Meteor Chaser — ветеран WonderMine?»).
- Гейтинг/бонусы по надетому: скидка тем, кто пришёл в wearable коллекции сцены; «dress code» вечеринки; фракции по цвету одежды.
- Снапшот лица — на wanted-постер, в таблицу лидеров, на «фото на пропуск».
- `isGuest` — ветвление онбординга: гостю нельзя выдать NFT-награду, значит гостевой путь должен иметь свою мотивацию.
- Подмена на NPC-аватар — временная трансформация (зомби, ролевой костюм) без прав на инвентарь игрока.

**(в) Кандидаты-вопросы (EN):**
- "Players arrive as themselves — with a name, a look, and an inventory they own. What does your experience notice about who walked in?"
- "Which moment in your experience would feel different if the player were an anonymous default character instead of their own avatar?"

### 2. Wearables и emotes как награды и межсценовый статус

**(а) Статус 2026.** Rewards-сервис Foundation жив и является рекомендованным способом раздачи: wearables и emotes выдаются «directly from a scene, a server, or in a quests» по HTTP-запросу; сервис сам батчит транзакции, платит газ, ретраит, шлёт игроку нотификацию о полученном айтеме. Анти-абьюз: captcha, лимиты на адрес, проверка присутствия игрока через Catalyst, мониторинг; рекомендация — не раздавать так предметы реже EPIC (тираж ≤100). Публикация коллекции wearable/emote — стандартный creator-флоу (curation committee, Polygon). Игрок носит награду в любой сцене и может продать на маркетплейсе.
Источники: https://docs.decentraland.org/creator/rewards/overview.md ; https://docs.decentraland.org/apis/apis/rewards/overview.md ; https://docs.decentraland.org/creator/wearables-and-emotes/wearables.md
Emotes дополнительно — «social verbs»: видимые всем жесты, синхронно проигрываемые аватаром; кастомный emote сцены = мем/ритуал, который игроки уносят и показывают в чужих сценах.

**(б) Как использовать. Реальный пример: WonderMine / WonderZone** — игрок майнит метеориты, собирает ресурсы, крафтит НОСИМЫЕ NFT (кирки, wearables, emotes); в пике — самая посещаемая локация DCL (10k+ дневных игроков), работает в SDK7-версии. Их wearables стали узнаваемым статусом «я это выиграл, а не купил». Другие паттерны: финишный emote как трофей турнира; сезонный wearable как «сезонный пропуск», который читается через `getPlayer()` при следующем визите (см. аффорданс 1 — связка «награда → распознавание награды» замыкает петлю).
Источники: https://decentraland.fandom.com/wiki/WonderMine ; https://places.decentraland.org/places/place/?position=-29.55

**(в) Кандидаты-вопросы:**
- "What can a player win here that they will still be wearing in someone else's scene next week?"
- "If you give out a wearable or emote as a reward, how does your scene recognize and honor players who come back wearing it?"

### 3. Genesis City (соседство) vs Worlds (изоляция)

**(а) Статус 2026.** Две среды публикации.
- **Genesis City:** единая карта LAND-парселей (−150..150), общие дороги и плазы, спавн новичков в Genesis Plaza (там же — event board). Сосед может «занести» трафик; сцена видна на карте, в Places, может стать POI через DAO-проголосованный статус.
- **Worlds:** изолированная сцена, привязанная к NAME (100 MANA) или ENS-домену. Лимиты: до **100 одновременных игроков**, хранилище **100 MB за каждый NAME + 100 MB за каждый LAND + 100 MB за каждые 2000 MANA** (ENS-миры — фикс. ~36 MB), размер сцены до 300×300 парселей бесплатно, мультисценные миры с раздачей прав на парсели. Вход: `/world name.dcl.eth` или ссылка. **Ключевой минус discoverability:** в Places миры с Foundation World Server видны только если владелец NAME держит LAND или активную аренду LAND.
Источники: https://docs.decentraland.org/apis/apis/worlds/overview.md ; https://docs.decentraland.org/faqs/places.md ; https://decentraland.fandom.com/wiki/Worlds ; https://decentraland.org/marketplace/names/claim
- Для мобильного Explorer'а (2026) обе среды доступны; «same spaces, avatar, and social activity carry across devices» (пресс-релиз 31.03.2026).

**(б) Как использовать.**
- LAND-сцена: дизайн «витрины» на границе парселя — прохожий с дороги должен за 5 секунд понять, что тут игра; учитывать соседей (звук, вид, тематический диссонанс или наоборот синергия районов — WonderZone как «парк развлечений»-район).
- World: полный контроль атмосферы (свой скайбокс, ни одного случайного прохожего) — хорош для сюжетных/хоррор/сессионных опытов, но ВЕСЬ трафик надо приводить самому: события, Communities, ссылки, стримеры. Пример: TOPHUB.dcl.eth — мир-витрина маркетплейса, живёт на прямых ссылках.
- Гибрид: тизер/лобби на LAND в проходном месте + основной опыт в World.

**(в) Кандидаты-вопросы:**
- "Genesis City parcel or a World? Explain the choice: where does your first-week traffic come from — neighbors walking by, or links you distribute yourself?"
- "If you build in Genesis City: what does a stranger see from the road in the first 5 seconds? If in a World: name the three channels that will actually bring people to the link."

### 4. События: календарь платформы как канал уведомлений

**(а) Статус 2026.** events.decentraland.org (decentraland.org/events): листинг может создать ЛЮБОЙ (LAND не нужен), для сцен в Genesis City и в Worlds; модерация Foundation — часы. Игрок жмёт «Interested/RSVP» → получает in-world алерт при старте события и может прыгнуть прямо туда. В Explorer'е: вкладка Events на карте и красно-белые маркеры live-событий (релизы unity-explorer 2025–2026 добавили Events tab + live event markers), event board в Genesis Plaza. Плюс еженедельный ньюслеттер и соцсети Foundation. Повторяющиеся события поддерживаются. Email-нотификации платформы (напоминания о событиях, продажи маркетплейса) — игрок подписывается сам в настройках аккаунта.
Источники: https://docs.decentraland.org/faqs/posting-events.md ; https://docs.decentraland.org/in-world/finding-events.md ; https://docs.decentraland.org/apis/apis/events/overview.md ; https://github.com/decentraland/unity-explorer/releases ; https://docs.decentraland.org/faqs/my-account

**(б) Как использовать.**
- Регулярный слот («каждый четверг 19:00 UTC — турнир») превращает календарь в retention-механику: RSVP-алерт заменяет отсутствующие push-уведомления.
- Запуск/апдейт контента оформлять КАК событие — это бесплатное попадание в карту Explorer'а с live-маркером.
- Пик онлайна по расписанию решает проблему «пустой сцены»: multiplayer-механики включать к событию, в остальное время — асинхронные (лидерборды, призраки).
- Музыкальный фестиваль DCL (дек. 2025), Art Week, Fashion Week — платформенные мега-события, к которым можно «пристыковаться» сайд-ивентом.

**(в) Кандидаты-вопросы:**
- "The events calendar is the platform's only notification channel. What is your recurring event, and what happens in your scene at that hour that doesn't happen otherwise?"
- "How does your experience feel for a player who arrives when nobody else is online — and how does it change when an event fills the scene?"

### 5. Places: лайки, фавориты, категории — механика discovery

**(а) Статус 2026.** decentraland.org/places — каталог сцен Genesis City и (ограниченно) Worlds. Лайки: голосовать может любой, но в процент «likes» идут голоса юзеров с ≥100 voting power (анти-накрутка). Фавориты, категории, «highest rated», «most active». Title/description/thumbnail берутся из метаданных сцены. UUID плейса стабилен при редеплое (если сохраняется base parcel / все парсели) — лайки и фавориты НЕ сгорают при апдейте, но «significant changes» могут создать новый ID и обнулить соцкапитал. POI — через DAO-проposal. Places API отдаёт и user activity.
Источники: https://docs.decentraland.org/faqs/places.md ; https://docs.decentraland.org/apis/apis/places/overview.md

**(б) Как использовать.**
- Просить лайк в правильный момент (после победы, а не на входе) — рейтинг напрямую влияет на позицию в каталоге.
- Заполненные title/description/thumbnail — гигиенический минимум («Increase your chances of getting a good rating by making sure your Place has a title, description and thumbnail»).
- Планировать редеплои так, чтобы не потерять UUID (не менять base parcel).
- Долгосрочная цель — статус POI через DAO как «памятник» успешной сцены.

**(в) Кандидат-вопрос:**
- "Where in the player journey do you earn the 'like' — and what will your Place card (title, thumbnail, description) promise to someone scrolling the catalog?"

### 6. Социальный граф: друзья, jump-in, Communities

**(а) Статус 2026.** Друзья с онлайн-статусом и **jump-in к другу** (телепорт к его позиции), заявки в друзья с сообщением, DM (настройка Friends Only / Everyone), блокировки. **Communities (запущены 02.09.2025):** «home base for connecting, chatting, and organizing events with people who share your interests» — групповые чаты, привязанные события, **community voice chat** с ролями (owner/moderator/member), speaker/listener + request-to-speak, модерация (promote/demote/kick), платформенные баны действуют поверх ролей. Социальный сервис — платформенный бэкенд (social-service, comms-gatekeeper).
Источники: https://docs.decentraland.org/in-world/friends-and-chatting.md ; https://decentraland.org/blog/announcements/introducing-communities-in-decentraland ; https://docs.decentraland.org/apis/apis/comms-gatekeeper/community-voice-chat.md
Вокруг платформы: Discord DCL, DAO-форум/governance (decentraland.org/governance), стримеры — музфестиваль 2025 позиционировался как «proving ground for livestream-born talent».

**(б) Как использовать.**
- Завести Community своей игры ДО запуска: анонсы, события комьюнити, voice-стримы разборов — вместо собственного Discord-сервера (или мостом к нему).
- Дизайн «зрелищных моментов» под jump-in: друг видит «X online в Y» и прыгает — момент прибытия друга посреди раунда должен быть обработан (spectate, очередь, второй слот).
- Реферальные петли: «приведи друга» работает буквально в один клик.

**(в) Кандидаты-вопросы:**
- "A friend can jump to a player mid-session with one click. What do they land into — a spectator spot, a queue, or a broken moment?"
- "Will your experience have its own Decentraland Community, and what happens there between play sessions?"

### 7. Voice chat и текстовый чат как дизайн-материал

**(а) Статус 2026.** Три режима голоса в Explorer'е: **nearby (proximity)** — автоподключается при входе в мир, группировка по «islands» через archipelago-сервис (кластеры по близости, автобалансировка); **private calls**; **community voice chat**. Активная доработка в релизах 2025–2026 (ECS-рефактор nearby voice, нэймтеги говорящих, фиксы громкости/Bluetooth). Текст: Nearby-чат (публичный, по близости), DM, чат-баблы над головой (настраиваемые). Comms-gatekeeper также управляет **scene live streaming** (RTMP-ключи для сцен) — сцена может принимать живой видеопоток.
Источники: https://docs.decentraland.org/player/general/in-world-features/voice-chat/ ; https://docs.decentraland.org/contributor/introduction/architecture/ ; https://docs.decentraland.org/contributor/architecture/services ; https://github.com/decentraland/unity-explorer/releases

**(б) Как использовать.**
- Социальная дедукция / переговоры / аукционы «голосом» бесплатно: proximity-голос уже есть, дизайн может опираться на физическое приближение как механику приватности (отойти в угол = приватный разговор).
- Караоке/опен-майк/ток-шоу сцены живут целиком на этом аффордансе.
- Учитывать: не все включают микрофон; критическая информация не должна передаваться ТОЛЬКО голосом (дублировать текстом/визуалом); на мобиле голос менее удобен.

**(в) Кандидат-вопрос:**
- "Proximity voice chat is always on. Does your design use physical distance as a mechanic (negotiation, secrets, stage moments) — and does it still work for players with muted mics?"

### 8. NAMEs и marketplace-экономика

**(а) Статус 2026.** NAME — ERC-721 (100 MANA или карта, decentraland.org/marketplace/names/claim), даёт: уникальное подтверждённое имя игрока, World, суб-домен-кошелёк name.dcl.eth. Маркетплейс: первичные/вторичные продажи wearables/emotes (Polygon), LAND/Estates, NAMEs. **Marketplace Credits** (с мая 2025, сезоны): игроки еженедельно зарабатывают до 8 кредитов (1 кредит = 1 MANA на покупку Polygon-wearables/emotes) за weekly goals — «jumping into Decentraland regularly and attending events»; часть $2M-программы Foundation по поддержке creator-экономики. Т.е. платформа ПЛАТИТ игрокам за посещение событий → события креатора могут быть чьим-то weekly goal, а кредиты игроков — спросом на wearables креатора.
Источники: https://decentraland.org/blog/announcements/marketplace-credits-earn-weekly-rewards-to-power-up-your-look ; https://docs.decentraland.org/in-world/earning-rewards.md ; https://decentraland.org/rewards-terms/

**(б) Как использовать.**
- Экономическая петля: опыт продвигает свою коллекцию wearables → игроки тратят заработанные кредиты на неё → креатор получает выручку с первички. (Кредиты — только primary sales, только Polygon.)
- NAME как ник-гейтинг («залогинься не гостем») мягко повышает конверсию в возвращаемость.

**(в) Кандидат-вопрос:**
- "Players earn weekly Marketplace Credits partly by attending events. How does your experience plug into that loop — as an event they attend, or a collection they spend credits on?"

### 9. Платформенные системы прогрессии: Badges, Credits-goals, Exploration Games, судьба Quests

**(а) Статус 2026.**
- **Badges** (с релиза DCL 2.0, окт. 2024): платформенные ачивки в профиле игрока.
- **Gaming Quest / сезонные кампании Foundation:** напр., 25-дневная кампания с ежедневными челленджами в сценах-партнёрах (фиолетовые сундуки на карте, телепорт к сцене дня, приз — wearable/emote в Backpack). Попадание сцены в такую кампанию = мощный платформенный трафик.
- **Exploration Games API:** бэкенд Foundation для «mini-games, missions, challenges and player progress» — лидерборды, метрики (score, level, время, custom JSON), интеграция наград, специализированные missions (напр., Fashion Week 2025 с visit tracking). Инфраструктура платформенного уровня, в которую интегрируются сцены.
- **Старый Quests-сервис:** quests-client (SDK7-библиотека) заархивирован 01.08.2025 → на общий quests-фреймворк «из коробки» полагаться нельзя; прогрессию трекать самим или через Exploration Games/Rewards.
Источники: https://docs.decentraland.org/apis/apis/exploration-games/overview.md ; https://docs.decentraland.org/in-world/earning-rewards.md ; https://github.com/decentraland/quests-client ; https://playtoearn.com/news/decentraland-2-0-beta-is-live-with-badges-daily-quests

**(б) Как использовать.** Проектировать опыт так, чтобы он легко «вставлялся» в кампании Foundation (изолируемый daily-challenge, трекаемое условие завершения, приз-wearable) — это главный источник разового платформенного трафика для новых сцен.

**(в) Кандидат-вопрос:**
- "If the Foundation offered to feature your scene in a platform-wide quest campaign next month, which single 5-minute challenge inside your experience would you nominate?"

### 10. Smart wearables / portable experiences — статус «мертво» (важно!)

**(а) Статус 2026.** Док-страница portable experiences: **«Portable experiences are not currently supported in the latest versions of Decentraland»**. Smart wearables: только SDK7 через CLI, **Creator Hub их не поддерживает**. Концепт (глобальные сцены, путешествующие с игроком — джетпак, снежки между сценами) в клиенте DCL 2.0 не возрождён на авг. 2026.
Источники: https://docs.decentraland.org/creator/scenes-sdk7/kinds-of-projects/portable-experiences.md ; https://docs.decentraland.org/creator/scenes-sdk7/kinds-of-projects/smart-wearables.md

**(б) Вывод для шаблона:** proposal, чей кор-луп зависит от smart wearables / portable experiences, — красный флаг. Межсценовый прогресс сегодня делается через обычные wearables + чтение `getPlayer()` + свой бэкенд.

---

## Предобусловленности-минусы: чего опыт НЕ контролирует

1. **Внешний вид игрока.** Сцена не может переодеть аватара. Игрок придёт в костюме банана на похоронную мистерию. Инструменты смягчения: hide avatars + NPC-подмена, дизайн, толерантный к визуальному хаосу, или использование хаоса как материала.
2. **Нет собственных push-уведомлений.** Достучаться до ушедшего игрока можно только через: события-RSVP (алерт при старте), платформенные email-нотификации (опциональная подписка игрока), Community-чат, внешние каналы. Retention-дизайн обязан опираться на календарь событий и комьюнити, а не на «мы пришлём нотификацию».
3. **Общий UI и локомоция Explorer'а.** Карта, чат, бэкпак, паспорта, а также прыжки/бег/**double jump и gliding** (появились в клиенте 2025–2026) — везде одинаковы. Сцена может точечно ограничивать (InputModifier, AvatarModifierArea), но игрок ожидает стандартное управление; ломать его — дорого. Платформер, не учитывающий glide, сломан по умолчанию.
4. **Непредсказуемый онлайн и потолки конкурентности.** Worlds — жёсткий кап 100; в Genesis City comms делит игроков на proximity-«islands», т.е. «все 500 на фестивале» не значит «все видят всех». Базовое состояние большинства сцен — 0–3 игрока: кор-луп обязан работать соло, multiplayer — как усилитель к событиям.
5. **Мобильный Explorer (Android — с 31.03.2026, iOS «coming soon»).** Официальная позиция: mobile «optimized for shorter, more frequent visits»; тот же аватар и соц. активность кросс-девайс. Следствия: тач-управление (сложные комбо/точный аим — риск), бюджет производительности ниже десктопного, сессии короче → нужны 3–5-минутные петли и мгновенный вход в геймплей.
6. **Модерация и Content Policy.** Рейтинги сцен T/A/R (scene.json / Scene Editor), 18+ контент (насилие, гэмблинг, sexually explicit) — только с ограничением и маркировкой, нарушение → терминация аккаунта. События проходят ручную модерацию Foundation (часы задержки — планировать заранее).
7. **Гости без кошелька.** `isGuest`-игрок не получит wearable-награду и не сохранит покупки; онбординг должен давать гостю ценность и мягко подталкивать к логину, а не стеной «connect wallet».
8. **Discoverability Worlds урезана.** В Places мир виден, только если владелец NAME держит LAND/аренду; иначе мир живёт исключительно на внешних ссылках.
9. **Соцкапитал Places хрупок при редеплое.** Смена base parcel / «significant changes» → новый UUID → обнуление лайков и фаворитов.
10. **Соседей не выбирают (LAND).** Звуковой/визуальный фон соседних парселей, их контент-рейтинг и трафик — вне контроля; аренда LAND — ещё и срок аренды как ограничение жизни сцены.

---

## Черновой скелет секции «Platform fit» (для шаблона, EN, B2)

> **Platform fit.** Decentraland is not a game engine with players shipped in — it is a place players already live in, with an identity, a wardrobe, a calendar, and friends. Show us your design knows that.

1. **Arriving as themselves.** Players walk in with their own avatar, name, and inventory — and you cannot change what they wear. What does your experience *read* from who walked in (name, wearables, guest status), and where does your design bend around the fact that you don't control how players look?
2. **Progress that travels.** What can a player earn in your experience that stays visible outside it — a wearable, an emote, a badge-worthy moment? How does your scene recognize a player who returns wearing what they earned?
3. **Land or World — and the traffic that follows.** Where do you publish, and why? If Genesis City: what does a stranger passing your parcel see in the first 5 seconds? If a World: name the concrete channels (events, Community, streamers, links) that bring people to a place nobody stumbles into.
4. **The calendar is your push notification.** What is your recurring event on events.decentraland.org, and how does the experience differ between a quiet Tuesday (1–3 players) and event peak? Your core loop must survive both.
5. **Living with the platform's defaults.** Proximity voice is always on, friends can jump in mid-session, mobile players come for short visits, and the Explorer UI/movement (including double jump and glide) is the same everywhere. Pick the two of these that affect your design most and say what you do about them.

(Вариант сокращения до 3 вопросов: слить 1+2 в «identity & portable progress», 3 оставить, 4+5 слить в «rhythms & defaults».)

---

## Источники

**Документация (актуальная структура, GitBook):**
- Sitemap: https://docs.decentraland.org/sitemap.md
- Player data / getPlayer: https://docs.decentraland.org/creator/development-guide/sdk7/user-data/
- Avatar modifiers в сцене: https://docs.decentraland.org/creator/scenes-sdk7/interactivity/player-avatar.md
- Worlds (API overview): https://docs.decentraland.org/apis/apis/worlds/overview.md
- Rewards service: https://docs.decentraland.org/creator/rewards/overview.md ; https://docs.decentraland.org/apis/apis/rewards/overview.md
- События: https://docs.decentraland.org/faqs/posting-events.md ; https://docs.decentraland.org/in-world/finding-events.md ; https://docs.decentraland.org/apis/apis/events/overview.md
- Places: https://docs.decentraland.org/faqs/places.md ; https://docs.decentraland.org/apis/apis/places/overview.md
- Друзья и чат: https://docs.decentraland.org/in-world/friends-and-chatting.md
- Community voice chat (API): https://docs.decentraland.org/apis/apis/comms-gatekeeper/community-voice-chat.md
- Voice chat (player docs): https://docs.decentraland.org/player/general/in-world-features/voice-chat/
- Comms-архитектура (islands/archipelago): https://docs.decentraland.org/contributor/introduction/architecture/ ; https://docs.decentraland.org/contributor/architecture/services
- Earning rewards in-world (Credits, Gaming Quest): https://docs.decentraland.org/in-world/earning-rewards.md
- Exploration Games API: https://docs.decentraland.org/apis/apis/exploration-games/overview.md
- Portable experiences (не поддерживаются): https://docs.decentraland.org/creator/scenes-sdk7/kinds-of-projects/portable-experiences.md
- Smart wearables: https://docs.decentraland.org/creator/scenes-sdk7/kinds-of-projects/smart-wearables.md
- Аккаунт/email-нотификации: https://docs.decentraland.org/faqs/my-account

**Блог / анонсы:**
- Communities (02.09.2025): https://decentraland.org/blog/announcements/introducing-communities-in-decentraland
- Marketplace Credits: https://decentraland.org/blog/announcements/marketplace-credits-earn-weekly-rewards-to-power-up-your-look
- Rewards terms (сезоны Credits): https://decentraland.org/rewards-terms/
- Content Policy: https://decentraland.org/content/
- 2025 Manifesto: https://decentraland.org/blog/announcements/decentraland-2025-manifesto-igniting-the-community-driven-flywheel

**Релизы / пресса:**
- Unity Explorer releases (Events tab на карте, live markers, nearby voice, double jump/glide, credits UI): https://github.com/decentraland/unity-explorer/releases
- Epic Games Store + Android launch, iOS coming soon (31.03.2026): https://www.globenewswire.com/news-release/2026/03/31/3266176/0/en/Decentraland-Launches-on-Epic-Games-Store-Android-Mobile-App-Now-Live-iOS-Coming-Soon.html ; https://thenextweb.com/news/decentraland-epic-games-store-mobile-launch
- DCL 2.0 beta (Badges, Daily Quests, окт. 2024): https://playtoearn.com/news/decentraland-2-0-beta-is-live-with-badges-daily-quests ; https://decrypt.co/287706/decentraland-launches-revamped-virtual-world-with-enhanced-performance-engaging-features-and-future-ready-architecture
- Quests-client заархивирован (01.08.2025): https://github.com/decentraland/quests-client

**Примеры сцен:**
- WonderMine (крафт wearables, SDK7): https://decentraland.fandom.com/wiki/WonderMine ; https://places.decentraland.org/places/place/?position=-29.55
- TOPHUB.dcl.eth (World-витрина): https://decentraland.org/places/world/?name=TOPHUB.dcl.eth
- NAME claim: https://decentraland.org/marketplace/names/claim

**Заметки о достоверности:**
- Часть старых doc-URL (creator/worlds/about, creator/rewards/api) отдают 404 — документация переехала; лимиты Worlds (100 users, 100MB-формула) подтверждены вторичными источниками + Fandom-вики и могут уточняться.
- Числа в цитатах по Credits (8/неделю, сезон 1: 19.05–14.07.2025) — из анонса первого сезона; текущий сезон авг. 2026 стоит перепроверить перед публикацией шаблона.
