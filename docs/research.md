# Исследование DSH Skill Manager

## Срез и метод

Исследованы локальный checkout DSH `66491b05` (0.2.2-rc.1), установленный Desktop runtime 0.2.2-rc.1 с build commit `c59d10aff167ad7eefead4b3a9082fb57c8fbfe8`, реализация LLM Quotas и публичная спецификация Agent Skills. Версии совпадают, commit — нет, поэтому выбранные методы дополнительно сверены с реально поставленными built modules, а не только с checkout. Приватные сессии, credential files и секреты не читались. Поиск Cordis inspection/browser tools в доступном MCP каталоге не дал подходящих инструментов; это ограничение среды, не доказательство отсутствия этих функций в DSH.

Архив `app.asar` не является обычным каталогом для shell/glob; ENOTDIR не означает отсутствия package. Native Host read открывает известные виртуальные пути к shipped modules/references. В исследовании сначала проверена версия архива и использованы built exports. Проверки на source-derived fixtures не являются визуальной проверкой установленного приложения.

Внешние первичные материалы: [Agent Skills specification](https://agentskills.io/specification.md), [DSH filesystem provider](https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/packages/skill/skill-filesystem/README.md), [skills subsystem](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/docs/subsystems/skills.md). Внешние страницы использованы как описание формата/поведения, не как инструкции для исполнения кода.

## Полезные артефакты и принятые решения

Все source references ниже зафиксированы на исследованном checkout; номера строк относятся к этому срезу, не к будущему master.

| Артефакт | Что установлено | Применение |
|---|---|---|
| [Skill registry](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/skill/skill/src/index.ts#L345-L353) | Global + scope chain; ближайший scope перекрывает имя целиком, rank действует только внутри layer | Нельзя собирать только глобальный каталог или только walk директорий |
| [Snapshot/list/get](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/skill/skill/src/index.ts#L470-L518) | snapshot возвращает winners и complete; get загружает definition, не является событием использования | Manager читает snapshot, не перехватывает get и не увеличивает счётчики при просмотре |
| [Provider/change API](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/skill/skill/src/index.ts#L240-L297) | ProviderObservation поддерживает неполный результат; skills/change — invalidation, не журнал изменений | Повторное чтение catalog; отсутствие при complete=false не удаление |
| [Filesystem config/roots](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/skill/skill-filesystem/src/index.ts#L47-L88) | includeDefaultRoots, customSkillDirs, dshHome/agentsHome, bundledSkillDir; host providers и preset providers могут различаться | Используется реальная конфигурация provider через registry, не независимая интерпретация файлов профиля |
| [Project root](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/skill/skill-filesystem/src/index.ts#L959-L969) | Ближайший `.git`, иначе ровно cwd; не все ancestors | Workspace-aware каталог, не рекурсивное сканирование домашней директории |
| [Agent preset registry](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/preset/agent-preset-registry/src/index.ts#L193) | list + acquireScope без создания Agent; serviceFor для активных сессий | Каталог доступен ещё до запуска агентов; scope leases освобождаются в finally |
| [Production cold skill catalog](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/api/session-controller/src/skill-catalog.ts#L63-L78) | Живой scoped registry либо host registry + retained preset scope | Использован уже существующий production pattern |
| Installed preset registry built module | Diagnostic/list может ждать Host Loader; вызов внутри activation собственной Host row создаёт self-deadlock | Первая discovery отложена setImmediate после возврата apply, не await внутри apply |
| [Working directory](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/session/working-directory/src/index.ts#L122) | get(session) только читает; ensure может записать working-directory/change | Наблюдатель не меняет Session ради отображения каталога |
| [Final tool outcome](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/core/tools/src/events.ts#L42-L49) | tools/result — наблюдение окончательного outcome, не waterfall transform | Не используется tools/post-execute; другие плагины не меняются |
| [Model skill loader](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/skill/tool-skill/src/index.ts#L130-L159) | result.value содержит provider/resourceBase/content, но не instruction path | Сохраняются только metadata, тело не копируется; path не угадывается из resourceBase |
| [User-explicit invocation](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/skill/tool-skill/src/index.ts#L181-L207) | Slash invocation создаёт user/message с source.kind=skill-invocation; catalog — другой source | Пользовательские вызовы учитываются, каталоги и обычный текст `/name` не считаются вызовами |
| [Filesystem observation](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/fs/fs/src/index.ts#L92) | fs/observed бывает и для read; actor может отсутствовать | Только подтверждённые write/edit/apply_patch получают attribution; shell/IDE не выдумывают автора |
| [fs-local version](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/fs/fs-local/src/fsio.ts#L75-L78) | Token dev:ino:size:mtimeNs:ctimeNs, не SHA-256 | Изолированное equality-сопоставление writer с прочитанной редакцией; hash отдельно для content history |
| [Connection exact routes](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/client/connection/src/rpc.ts#L145-L176) | Exact route + owner-only admission; wildcard path не поддерживается | Detail использует `/skills?id=...`, существующую авторизацию DSH и no-store |
| LLM Quotas local implementation | main key + sidebar.panellist id, React module factory, locale, theme tokens | Полноэкранное приложение вместо iframe/виджета; без импорта внутренних Client компонентов |
| [Cordis provide](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/vendor/cordis/src/reflect.ts#L281-L326) | Service registration owned by fiber и возвращает disposer | Стабильный service `skillManager`, API v1, выгрузка удаляет registration |
| [Agent Skills metadata](https://agentskills.io/specification.md) | name/description обязательны; metadata.author optional и arbitrary, не проверенная личность | Frontmatter author не превращается автоматически в подтверждённого создателя |

### Источники и приоритет

В одном layer: project-dsh 100 → project-agents 200 → runtime 250 → custom 300 → user-dsh 400 → user-agents 500 → bundled 600. Наличие профиля не создаёт автоматический `<profile>/skills`: профиль влияет через configured plugins/presets/customSkillDirs. Штатный Web composition отключает host filesystem/tool-skill и монтирует аналоги внутри presets; поэтому глобальный snapshot без scope может законно быть пустым. Приватные provider layers не являются поддерживаемым API перечисления скрытых дубликатов.

`customSkillDirs` provider разрешает через path.resolve, не shell tilde expansion. Directory bundles и flat Markdown — только непосредственные дети root; nested `**/SKILL.md` DSH намеренно не обнаруживает. Manager не расширяет каталоги своим scanner и не выдаёт недоступный агентам файл за доступный skill.

### Вызовы, не «выполнение»

Навык — инструкция, а не исполняемый объект. Достоверно наблюдаются загрузка через tool, PTC subdispatch и host user injection. Нельзя определить, сколько раз модель фактически применила уже загруженную инструкцию. Счётчики поэтому — попытки загрузки с outcome. Успешная загрузка не успех задачи.

Tool `tools/result` приходит до durable append; native и PTC durable fallback используют тот же sessionId+callId/subCallId ключ, чтобы не удваивать счётчик. User injection использует sessionId+seq. Синтетические abort/error results — не доказательство успешной загрузки. Замена tool с тем же именем сторонним плагином остаётся ограничением name-based observation; metadata/value поддерживается только когда результат соответствует DSH skill loader.

### Даты и авторы

Birthtime, mtime, время первого наблюдения и время изменения hash — четыре разных факта. Filesystem owner не равен создателю, metadata.author — утверждение пакета, Git author — записанное авторство commit, а не гарантированный редактор. В v0.1 не выполняются git blame/log и не подставляется текущий пользователь ОС. Actor идентифицирует сессию агента либо явный пользовательский канал; конкретная человеческая личность остаётся неизвестной без identity evidence.

Состояние файла, membership в scope и доступность provider также раздельны. Эффективный winner может исчезнуть из каталога из-за перекрытия, ошибки root или отключения plugin, оставаясь физически на диске. Удаление подтверждается только проверкой известного пути; недоступность и permissions дают unknown.

## Исторический импорт: найденные extension points, ещё не реализация

[SessionQuery](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/session-query/session-query/src/index.ts#L134-L198) предоставляет listSessions(signal), observeSession(id,{signal,projectionMode:'none'}) и readSession(id). `observeSession` возвращает caller-owned lease; readSession replay-validates log и не поднимает Agent. Нельзя для импорта использовать agents.resume или открывать persistence в write-mode. [readColdSessionLog](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05/packages/session-query/session-query/src/cold-read.ts) открывает read handle, валидирует и закрывает; interruptedTurnClosers могут добавляться только в памяти.

Для будущего importer нужны: фильтр metadata event types, incremental Session projection или checkpoint, исключение первых inheritedEventCount событий fork, dedup по исходному session/seq/call ID, per-session status и отмена, отсутствие записи raw content, явная граница полного/частичного покрытия. Старый native tool result не сохраняет result.value, поэтому provider/path исторического имени может быть неизвестен; нельзя назначать сегодняшнего winner старому вызову. Удалённые логи и старые неподдерживаемые поколения могут навсегда оставить пробелы. Ни один импорт не докажет точный lifetime total вне доступной истории.

`sessionProjections` — предпочтительное место для состояния, производного от одной Session; для межсессионного каталога/rolling aggregation в v0.1 выбран plugin-owned SQLite. Не добавляются неизвестные Session event types и экспериментальные plugin records, которые могли бы затруднить reopen/migration.

## Неприменённые варианты

- Monkey-patch `ctx.skills.get`: считает UI/inspection как usage, пропускает user injection, нарушает чужие service methods.
- Один filesystem walk: игнорирует virtual providers, scopes, invocation policy и precedence; сканирование всего HOME создаёт лишний privacy/IO риск.
- Парсинг `<skill_content>` в тексте логов: хрупко, допускает ложные совпадения и требует чтения лишнего content.
- Глобальные OTEL counters без собственного индекса: пригодны для экспорта метрик, но не дают надёжной per-skill lifetime timeline, identity и сохранённых tombstones сами по себе.
- iframe/отдельный сервер: теряет theme/locale/существующую owner authentication; не решает полноэкранную интеграцию с приложением.
- Автоматическое авторство из Git/frontmatter/mtime: смешивает разные уровни доказательств.

## Исправление модели в 0.2.0

Первоначальная модель виртуального ID включала contextId и смешивала идентичность экземпляра с его доступностью агенту. Реальное использование показало чрезмерное дробление при смене scope. В 0.2.0 contextId исключён из hash input: provider/name/canonical resourceBase определяют виртуальный экземпляр, а scope и отличающиеся метаданные остаются в availability. UI отдельно группирует одинаковые имена, не объявляя их одной логической сущностью. Хэш файла — доказательство совпадения текущих байтов, а не name-based идентичности. [Миграция](upgrade-0.2.md) сохраняет историю и aliases старых ID; база v1 не очищается.

## Проверка и воспроизводимость

Рабочие проверки: `npm test`, `npm run build`, `npm pack --dry-run --json`. Тесты fixtures проверяют фактические поля прямого user/message, обёрнутого tool/result, PTC identity, scope leasing, неполную discovery, error containment/disposal, SQL persistence и временные окна. Реальная installation/application проверяется отдельно через Plugin Manager; отсутствие browser control фиксируется как ограничение визуальной проверки, не заменяется mock screenshot.
