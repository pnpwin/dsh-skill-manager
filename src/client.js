window.__ModuleLoader__.load({
  id: '@pnpwin/dsh-skill-manager',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const {useState, useEffect, useRef, useMemo, useSyncExternalStore} = React;
    const dictionaries = {
      en: {
        title:'Skill Manager', subtitle:'Your skill catalog, usage and observed lifecycle in one place.', catalog:'Catalog', open:'Open Skill Manager', refresh:'Refresh catalog', refreshing:'Refreshing…', updated:'Updated', loading:'Loading skill catalog…', retry:'Retry', failed:'Could not load the catalog. Existing data may be out of date.', historyFailed:'Could not load lifecycle history.', timeout:'The request timed out. Please try again.', invalid:'The backend returned an unsupported response. Check that the Host and Client versions match.', network:'Cannot reach the Skill Manager backend.', http:'Backend request failed',
        totalSkills:'Tracked skills', presentSkills:'Present', uses24h:'Calls · 24 hours', uses7d:'Calls · 7 days', usesAll:'Calls · all observed', observed:'Observed coverage', since:'Since', coverageUnknown:'Coverage start is unknown', coverageNote:'Counts cover observed skill invocation attempts, including errors, not every application of a skill. Loading instructions does not prove a script ran or a task succeeded. Zero means no recorded attempts in this coverage, not proof of no use. Earlier history is not inferred.', attributionNote:'Filesystem timestamps are not authorship. Creators and modifiers remain unknown unless supported by an observed event.', warnings:'Collection warnings', search:'Search skills', searchPlaceholder:'Name, description, source or path…', source:'Source', status:'Status', allSources:'All sources', allStatuses:'All statuses', sort:'Sort', sortName:'Name · A–Z', sort24h:'Most used · 24 hours', sort7d:'Most used · 7 days', sortAll:'Most used · all observed', sortRecent:'Recently used', sortModified:'Recently modified', clear:'Clear filters', results:'Shown / matching / tracked', noSkills:'No skills have been observed yet.', noSkillsNote:'Refresh the catalog after making skills available in a workspace.', noResults:'No skills match these filters.', noSelection:'Select a skill', selectionHint:'Choose a name in the catalog to inspect attribution, availability and event history.', name:'Skill', provider:'Provider', count24h:'24h', count7d:'7d', countAll:'Observed', lastUsed:'Last used', never:'No observed use', unknown:'Unknown', notReported:'Not reported', present:'Present', missing:'Missing', unavailable:'Unavailable', unknownStatus:'Unknown', page:'Page', previous:'Previous', next:'Next', details:'Skill details', description:'Description', noDescription:'No description reported.', identity:'Identity', path:'Path', skillId:'Skill ID', contentHash:'Content hash', lifecycle:'Lifecycle & attribution', created:'Created', modified:'Last modified', firstSeen:'First observed', lastSeen:'Last observed', lastUse:'Last observed use', by:'By', birthtime:'Filesystem birth time; creator unknown unless independently attributed.', creationUnknown:'Creation time and creator are not established.', observedOnly:'Observation time, not creation or modification time.', usage:'Observed usage', availability:'Context availability', effective:'Effective', notEffective:'Not effective', noAvailability:'No context availability was reported.', context:'Context', history:'Event history', noEvents:'No lifecycle events were observed for this skill.', more:'Load more events', historyCoverage:'Only recorded events appear here; gaps and unknown attribution are not filled in.', eventDetails:'Event details', showingEvents:'Events loaded / total', actor:'Actor', session:'Session', evidence:'Evidence', eventUnknown:'Unclassified event', 'event.discovered':'Discovered', 'event.created':'Created', 'event.modified':'Modified', 'event.used':'Skill loaded', 'event.loaded':'Skill loaded', 'event.missing':'Missing', 'event.unavailable':'Unavailable', 'event.available':'Available', 'event.status-changed':'Status changed', 'event.observed':'Observed', 'event.restored':'Restored', 'event.mutation':'Mutation observed', 'event.invocation':'Invocation attempt', agent:'Agent', user:'User', tool:'Tool', snapshotStale:'Showing the last successful snapshot.', readOnly:'Instance management requires explicit owner confirmation · Refresh rescans available sources', selectSkill:'Inspect skill', closeDetails:'Clear selection'
      },
      ru: {
        title:'Менеджер навыков', subtitle:'Каталог навыков, использование и наблюдаемая история в одном месте.', catalog:'Каталог', open:'Открыть менеджер навыков', refresh:'Обновить каталог', refreshing:'Обновление…', updated:'Обновлено', loading:'Загрузка каталога навыков…', retry:'Повторить', failed:'Не удалось загрузить каталог. Сохранённые данные могут быть устаревшими.', historyFailed:'Не удалось загрузить историю навыка.', timeout:'Время ожидания истекло. Попробуйте ещё раз.', invalid:'Неподдерживаемый ответ сервера. Проверьте совместимость версий Host и Client.', network:'Не удалось подключиться к серверу менеджера навыков.', http:'Ошибка запроса к серверу',
        totalSkills:'Навыков в каталоге', presentSkills:'Присутствуют', uses24h:'Вызовы · 24 часа', uses7d:'Вызовы · 7 дней', usesAll:'Вызовы · за период', observed:'Период наблюдения', since:'С', coverageUnknown:'Начало наблюдения неизвестно', coverageNote:'Счётчики отражают наблюдаемые попытки вызова навыков, включая ошибки, а не каждое их применение. Загрузка инструкций не доказывает выполнение скрипта или успех задачи. Ноль означает отсутствие записанных попыток за период, а не доказательство неиспользования. Предыдущая история не восстанавливается предположениями.', attributionNote:'Время в файловой системе не подтверждает авторство. Создатели и авторы изменений остаются неизвестными без подтверждающего события.', warnings:'Предупреждения сбора данных', search:'Поиск навыков', searchPlaceholder:'Название, описание, источник или путь…', source:'Источник', status:'Состояние', allSources:'Все источники', allStatuses:'Все состояния', sort:'Сортировка', sortName:'Название · А–Я', sort24h:'Больше загрузок · 24 часа', sort7d:'Больше загрузок · 7 дней', sortAll:'Больше загрузок · за период', sortRecent:'Недавно использованные', sortModified:'Недавно изменённые', clear:'Сбросить фильтры', results:'Показано / найдено / в каталоге', noSkills:'Навыки пока не обнаружены.', noSkillsNote:'Обновите каталог после добавления навыков в рабочую область.', noResults:'Нет навыков, соответствующих фильтрам.', noSelection:'Выберите навык', selectionHint:'Нажмите на название в каталоге, чтобы изучить авторство, доступность и историю событий.', name:'Навык', provider:'Провайдер', count24h:'24 ч', count7d:'7 д', countAll:'За период', lastUsed:'Использован', never:'Загрузки не наблюдались', unknown:'Неизвестно', notReported:'Не сообщается', present:'Присутствует', missing:'Отсутствует', unavailable:'Недоступен', unknownStatus:'Неизвестно', page:'Страница', previous:'Назад', next:'Далее', details:'Информация о навыке', description:'Описание', noDescription:'Описание не сообщается.', identity:'Идентификация', path:'Путь', skillId:'ID навыка', contentHash:'Хеш содержимого', lifecycle:'Жизненный цикл и авторство', created:'Создан', modified:'Последнее изменение', firstSeen:'Впервые обнаружен', lastSeen:'Последнее наблюдение', lastUse:'Последняя загрузка', by:'Автор', birthtime:'Время создания файла; создатель неизвестен без отдельного подтверждения.', creationUnknown:'Время создания и создатель не установлены.', observedOnly:'Время наблюдения, а не создания или изменения.', usage:'Наблюдаемое использование', availability:'Доступность по контекстам', effective:'Действует', notEffective:'Не действует', noAvailability:'Доступность по контекстам не сообщается.', context:'Контекст', history:'История событий', noEvents:'События жизненного цикла этого навыка не наблюдались.', more:'Загрузить ещё события', historyCoverage:'Показаны только записанные события; пробелы и неизвестное авторство не заполняются предположениями.', eventDetails:'Подробности события', showingEvents:'Загружено событий / всего', actor:'Участник', session:'Сессия', evidence:'Подтверждение', eventUnknown:'Неклассифицированное событие', 'event.discovered':'Обнаружен', 'event.created':'Создан', 'event.modified':'Изменён', 'event.used':'Навык загружен', 'event.loaded':'Навык загружен', 'event.missing':'Отсутствует', 'event.unavailable':'Недоступен', 'event.available':'Доступен', 'event.status-changed':'Состояние изменено', 'event.observed':'Наблюдался', 'event.restored':'Восстановлен', 'event.mutation':'Наблюдаемая правка', 'event.invocation':'Попытка вызова', agent:'Агент', user:'Пользователь', tool:'Инструмент', snapshotStale:'Показан последний успешно полученный снимок.', readOnly:'Управление экземпляром требует явного подтверждения владельца · Обновление повторно сканирует источники', selectSkill:'Посмотреть навык', closeDetails:'Снять выбор'
      }
    };
    Object.assign(dictionaries.en, {
      totalSkills:'Unique skill names', instances:'Instances', totalInstances:'Canonical instances', mixed:'Mixed', groupSources:'Sources / providers', groupResults:'Groups shown / matching / tracked', expandGroup:'Show all instances', collapseGroup:'Hide instances', groupInstances:'All instances in this name group', inspectInstance:'Inspect this instance', selectedInstance:'Selected instance', matchingInstances:'Matching instances / all in group', matchesFilters:'Matches filters', groupFilterNote:'Filters match any single instance. Matching groups show every instance and full-group counts, including members that do not match the filters.', groupingNote:'Grouped by exact name, not by scope or content. Equal names and unknown hashes do not prove equal content. Only matching known hashes are marked identical.', identicalContent:'Known identical content', identicalWith:'Instances with this known hash', metadataDiffers:'Metadata differs', invocation:'Invocation mode', resourceBase:'Resource base', noResourceBase:'Not reported', fullGroupUsage:'Counts include every instance in the group.', selectionHint:'Expand a name group, then inspect an instance for attribution, context availability and event history.', noSelection:'Select an instance', searchPlaceholder:'Name, description, source, path or resource base…', details:'Instance details'
    });
    Object.assign(dictionaries.ru, {
      totalSkills:'Уникальных названий', instances:'Экземпляры', totalInstances:'Канонических экземпляров', mixed:'Смешанное', groupSources:'Источники / провайдеры', groupResults:'Групп показано / найдено / всего', expandGroup:'Показать все экземпляры', collapseGroup:'Скрыть экземпляры', groupInstances:'Все экземпляры группы с этим названием', inspectInstance:'Открыть этот экземпляр', selectedInstance:'Выбранный экземпляр', matchingInstances:'Совпавших экземпляров / всего в группе', matchesFilters:'Соответствует фильтрам', groupFilterNote:'Фильтры ищут совпадение в одном экземпляре. Найденные группы показывают все экземпляры и полные счётчики группы, включая не соответствующие фильтрам записи.', groupingNote:'Группировка по точному названию, а не по контексту или содержимому. Совпадение названий и неизвестные хеши не доказывают равенство содержимого. Одинаковым отмечается только содержимое с совпавшими известными хешами.', identicalContent:'Подтверждено одинаковое содержимое', identicalWith:'Экземпляров с этим известным хешем', metadataDiffers:'Метаданные различаются', invocation:'Способ вызова', resourceBase:'База ресурсов', noResourceBase:'Не сообщается', fullGroupUsage:'Счётчики включают все экземпляры группы.', selectionHint:'Раскройте группу по названию и выберите экземпляр для просмотра авторства, доступности по контекстам и истории событий.', noSelection:'Выберите экземпляр', searchPlaceholder:'Название, описание, источник, путь или база ресурсов…', details:'Информация об экземпляре'
    });
    Object.assign(dictionaries.en, {
      pendingReview:'Some instance actions need outcome review. Select the marked instance and check its state; do not repeat the action.', pendingBadge:'Outcome needs review', executionNotice:'Changing selection or closing this page can cancel the UI request, not an already admitted operation. Check operation status if the result is unknown.', workingStatus:'Working status', fileActions:'File actions', manageUnavailable:'Instance management is unavailable on this Host version. This instance remains read-only.', manageProtected:'This instance cannot be managed. Eligibility is verified by the backend, not inferred from its source label.', manageReason:'Backend restriction', manageEligible:'The plan targets the selected physical files or instance policy. Other catalog views of the same files may also change. Available actions are decided by the backend.', policyOverrideNote:'The manager stores a policy override; package files are not changed.', policyEnableNote:'Enable removes only the manager’s deny override. The supplier’s own model/user invocation restrictions remain in force.', targetPolicy:'Invocation policy', workingEnabled:'Enabled', workingDisabled:'Disabled', workingUnknown:'Unknown working status', fileActive:'Files active', fileArchived:'Archived', fileDeleted:'Deleted', fileMissing:'Files missing', fileUnknown:'Unknown file state', actionEnable:'Enable', actionDisable:'Disable', actionArchive:'Archive', actionRestore:'Restore', actionDelete:'Permanently delete', manageCaveat:'Enable/disable affects future instruction loads. Already loaded instructions are not withdrawn from active sessions. Registry caches may require refresh or a DSH restart.', fileCaveat:'Archive moves the approved target; restore never overwrites a destination. Permanent deletion cannot be undone. History and recorded counts remain.', preparing:'Checking target…', executing:'Applying confirmed action…', confirmAction:'Confirm instance action', plannedAction:'Action', target:'Exact target', targetKind:'Target scope', targetFile:'Instruction file only', targetDirectory:'Skill directory, including resources', fileCount:'Files', totalBytes:'Total bytes', expires:'Confirmation expires', planWarnings:'Backend warnings', confirmName:'Type the exact confirmation text', deleteWarning:'This permanently deletes the shown target and its approved contents. There is no restore after deletion.', confirmExecute:'Confirm and apply', cancel:'Cancel', prepareAgain:'Check a new plan', planExpired:'This confirmation expired. No new action was submitted. Check a new plan before confirming.', planChanged:'The target or its management revision changed. Check a new plan before confirming.', manageFailed:'The operation was rejected or could not be prepared.', manageUnknown:'The action outcome is unknown. A cancelled or timed-out UI request does not mean the file or policy operation rolled back. Do not repeat it automatically; inspect the refreshed state and backend recovery warnings.', checkState:'Check catalog state', manageBlocked:'Further management of this instance is blocked in this page until its outcome has been checked.', manageDone:'The backend completed the action. Updating the catalog…', manageDoneStale:'The action completed, but the catalog could not be refreshed. Check the catalog before taking another action.', manageChecked:'Catalog state checked. Inspect the file state and history before preparing a new action.', manageBusyOther:'Another instance action is being checked or applied.', reasonCode:'Reason code', operationStatus:'Operation status', statusNotStarted:'Not admitted yet; keep checking until the plan expires.', statusRunning:'The backend is still running this operation.', statusSucceeded:'The operation succeeded.', statusFailed:'The operation failed. Review the resulting state.', statusRecovery:'The backend requires recovery; further changes remain blocked.', statusUnknown:'The backend cannot establish this operation’s outcome.', managementFooter:'Instance actions require owner confirmation · Package files stay protected; working policy follows backend permissions', 'event.enabled':'Enabled', 'event.disabled':'Disabled', 'event.archived':'Archived', 'event.deleted':'Deleted', 'event.management':'Management action', 'event.management-intent':'Management intent recorded', 'event.management-failed':'Management action failed', 'event.management-recovery-required':'Management recovery required'
    });
    Object.assign(dictionaries.ru, {
      pendingReview:'Результаты некоторых действий требуют проверки. Выберите отмеченный экземпляр и проверьте его состояние; не повторяйте действие.', pendingBadge:'Результат требует проверки', executionNotice:'Смена выбранного экземпляра или закрытие страницы отменяют запрос интерфейса, но не уже принятую операцию. При неизвестном результате проверьте состояние операции.', workingStatus:'Рабочий статус', fileActions:'Действие с файлами', manageUnavailable:'Управление экземпляром недоступно в этой версии Host. Экземпляр доступен только для чтения.', manageProtected:'Управление этим экземпляром запрещено. Допустимость проверяет сервер, она не выводится из названия источника.', manageReason:'Ограничение сервера', manageEligible:'План относится к выбранным физическим файлам или политике экземпляра. Другие представления тех же файлов тоже могут измениться. Допустимые действия определяет сервер.', policyOverrideNote:'Менеджер хранит переопределение политики; файлы пакета не меняются.', policyEnableNote:'Включение снимает только запрет менеджера. Собственные ограничения поставщика на вызов моделью и пользователем остаются в силе.', targetPolicy:'Политика вызова', workingEnabled:'Включён', workingDisabled:'Выключен', workingUnknown:'Рабочий статус неизвестен', fileActive:'Файлы активны', fileArchived:'В архиве', fileDeleted:'Удалён', fileMissing:'Файлы отсутствуют', fileUnknown:'Состояние файлов неизвестно', actionEnable:'Включить', actionDisable:'Отключить', actionArchive:'Архивировать', actionRestore:'Вернуть из архива', actionDelete:'Удалить навсегда', manageCaveat:'Включение и выключение относятся к будущим загрузкам инструкций. Уже загруженные инструкции не отзываются из активных сессий. Для обновления кэшей registry может потребоваться обновление каталога или перезапуск DSH.', fileCaveat:'Архив перемещает подтверждённый объект; восстановление не перезаписывает существующий путь. Безвозвратное удаление отменить нельзя. История и записанные счётчики сохраняются.', preparing:'Проверка объекта…', executing:'Выполнение подтверждённого действия…', confirmAction:'Подтвердите действие с экземпляром', plannedAction:'Действие', target:'Точный объект', targetKind:'Область действия', targetFile:'Только файл инструкции', targetDirectory:'Каталог навыка вместе с ресурсами', fileCount:'Файлов', totalBytes:'Всего байт', expires:'Подтверждение действительно до', planWarnings:'Предупреждения сервера', confirmName:'Введите точный текст подтверждения', deleteWarning:'Указанный объект и его подтверждённое содержимое будут удалены безвозвратно. Восстановление после удаления невозможно.', confirmExecute:'Подтвердить и выполнить', cancel:'Отмена', prepareAgain:'Проверить новый план', planExpired:'Подтверждение устарело. Новое действие не отправлено. Перед подтверждением проверьте новый план.', planChanged:'Объект или его версия управления изменились. Перед подтверждением проверьте новый план.', manageFailed:'Операция отклонена либо её не удалось подготовить.', manageUnknown:'Результат действия неизвестен. Отмена запроса или тайм-аут интерфейса не означают откат операции с файлами или политикой. Не повторяйте её автоматически: проверьте обновлённое состояние и предупреждения восстановления на сервере.', checkState:'Проверить состояние каталога', manageBlocked:'Дальнейшее управление экземпляром в этой странице заблокировано до проверки результата.', manageDone:'Сервер завершил действие. Обновляем каталог…', manageDoneStale:'Действие завершено, но обновить каталог не удалось. Перед следующим действием проверьте каталог.', manageChecked:'Состояние каталога проверено. Изучите состояние файлов и историю перед подготовкой нового действия.', manageBusyOther:'Сейчас проверяется или выполняется действие с другим экземпляром.', reasonCode:'Код причины', operationStatus:'Состояние операции', statusNotStarted:'Операция пока не принята; проверяйте состояние до истечения плана.', statusRunning:'Сервер ещё выполняет эту операцию.', statusSucceeded:'Операция завершилась успешно.', statusFailed:'Операция завершилась с ошибкой. Проверьте полученное состояние.', statusRecovery:'Серверу требуется восстановление; дальнейшие изменения заблокированы.', statusUnknown:'Сервер не может определить результат операции.', managementFooter:'Действия с экземпляром требуют подтверждения владельца · Файлы пакетов защищены; рабочая политика — по разрешениям сервера', 'event.enabled':'Включён', 'event.disabled':'Выключен', 'event.archived':'Архивирован', 'event.deleted':'Удалён', 'event.management':'Действие управления', 'event.management-intent':'Намерение управления записано', 'event.management-failed':'Ошибка действия управления', 'event.management-recovery-required':'Требуется восстановление после операции'
    });
    // Pure management guards: never infer capability from a provider, source, or name.
    function allowedManagementActions(management) {
      return management?.eligible === true && Array.isArray(management.allowedActions)
        ? management.allowedActions.filter(action => ['enable','disable','archive','restore','delete'].includes(action)) : [];
    }
    function validManagementPlan(plan, skill, action) {
      const common = !!plan && plan.id === skill.id && typeof plan.name === 'string' && plan.name.length > 0 && plan.name === skill.name
        && plan.action === action && ['enable','disable','archive','restore','delete'].includes(action)
        && typeof plan.token === 'string' && plan.token.length > 0 && typeof plan.operationId === 'string' && plan.operationId.length > 0
        && typeof plan.expiresAt === 'string' && Number.isFinite(Date.parse(plan.expiresAt))
        && Array.isArray(plan.warnings) && plan.warnings.every(value => typeof value === 'string')
        && (plan.confirmationText == null || typeof plan.confirmationText === 'string');
      if (!common) return false;
      // Policy plans cannot masquerade as file operations, or vice versa.
      if (plan.mode === 'override' || plan.targetKind === 'policy' || skill.management?.mode === 'override') {
        return plan.mode === 'override' && plan.targetKind === 'policy' && skill.management?.mode === 'override'
          && ['enable','disable'].includes(action) && allowedManagementActions(skill.management).includes(action)
          && plan.path === null && plan.fileCount === 0 && plan.totalBytes === 0 && plan.confirmationText === null;
      }
      return typeof plan.path === 'string' && plan.path.length > 0
        && ['file','directory'].includes(plan.targetKind) && Number.isInteger(plan.fileCount) && plan.fileCount >= 1
        && Number.isFinite(plan.totalBytes) && plan.totalBytes >= 0
        && (action !== 'delete' || typeof plan.confirmationText === 'string' && plan.confirmationText.length > 0 && plan.confirmationText === plan.name);
    }
    function canConfirmManagementPlan(plan, confirmation, now = Date.now()) {
      if (!plan || !Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= now) return false;
      if (plan.action === 'delete' && (typeof plan.confirmationText !== 'string' || !plan.confirmationText)) return false;
      return plan.confirmationText == null || typeof plan.confirmationText === 'string' && confirmation === plan.confirmationText;
    }
    function managementOutcomeUncertain(error) {
      return !Number.isInteger(error?.status) || error.status < 400 || error.status >= 500 || error.code === 'recovery-required';
    }
    function managementStatusResolved(status, expiresAt, now = Date.now()) {
      return status === 'succeeded' || status === 'failed'
        || status === 'not-started' && Number.isFinite(Date.parse(expiresAt)) && Date.parse(expiresAt) <= now;
    }
    // Pure view projection: match individual instances, retain authoritative whole-group counts.
    function selectGroups(groups, skills, filters) {
      const byId = new Map(skills.map(skill => [skill.id, skill]));
      const value = input => typeof input === 'string' ? input : '';
      const needle = filters.query.trim().toLocaleLowerCase(filters.locale);
      const matches = skill => (!filters.source || skill.source === filters.source)
        && (!filters.status || skill.status === filters.status)
        && (!needle || [skill.name, skill.description, skill.source, skill.provider, skill.path, skill.id,
          skill.resourceBase?.kind, skill.resourceBase?.path, skill.resourceBase?.url, skill.resourceBase?.description]
          .some(input => value(input).toLocaleLowerCase(filters.locale).includes(needle)));
      const numeric = input => typeof input === 'number' && Number.isFinite(input) && input >= 0 ? input : -1;
      const time = input => input && Number.isFinite(Date.parse(input)) ? Date.parse(input) : -1;
      const metric = group => filters.sort === 'recent' ? time(group.usage?.lastAt)
        : filters.sort === 'modified' ? time(group.modifiedAt) : numeric(group.usage?.[filters.sort]);
      return groups.map(group => {
        const members = group.instanceIds.map(id => byId.get(id)).filter(Boolean);
        return {group, members, matchingIds:members.filter(skill => [skill, ...(skill.availability ?? []).map(scope => ({...skill, ...scope}))].some(matches)).map(skill => skill.id)};
      }).filter(entry => entry.matchingIds.length > 0).sort((a, b) =>
        (filters.sort === 'name' ? 0 : metric(b.group) - metric(a.group))
        || value(a.group.name).localeCompare(value(b.group.name), filters.locale)
        || value(a.group.id).localeCompare(value(b.group.id)));
    }
    const css = `
      .dsm{height:100%;min-height:0;width:100%;min-width:0;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.55;container-type:inline-size}
      .dsm *{box-sizing:border-box}.dsm button,.dsm input,.dsm select{font:inherit}.dsm button{cursor:pointer}.dsm button:disabled{opacity:.5;cursor:default}.dsm :is(button,input,select,summary):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
      .dsm-body{padding:28px clamp(16px,3vw,40px) 36px}.dsm h1,.dsm h2,.dsm h3,.dsm p{margin:0}.dsm h1{font-size:26px;font-weight:650;line-height:1.25;letter-spacing:-.6px}.dsm h2{font-size:15px;line-height:1.5;font-weight:600}.dsm h3{font-size:12px;font-weight:600}.dsm-header{display:flex;gap:20px;justify-content:space-between;align-items:flex-start;margin-bottom:24px}.dsm-heading{display:flex;gap:13px;align-items:center}.dsm-icon{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-brand-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px;flex:none}.dsm-subtitle{margin-top:7px!important;color:var(--dsw-alias-label-secondary)}.dsm-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.dsm-header-actions{display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex:none}
      .dsm-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:7px 12px;min-height:34px;white-space:nowrap}.dsm-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}.dsm-primary{color:var(--dsw-alias-brand-primary)}.dsm-icon-button{padding:4px 9px;font-size:20px;line-height:24px}.dsm-muted{color:var(--dsw-alias-label-secondary)}.dsm-caption{font-size:12px;color:var(--dsw-alias-label-secondary)}.dsm-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;overflow-wrap:anywhere;word-break:break-word}.dsm-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      .dsm-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin-bottom:18px}.dsm-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:15px 18px;min-width:0}.dsm-stat dt{color:var(--dsw-alias-label-secondary);font-size:12px}.dsm-stat dd{margin:6px 0 0;font-size:27px;font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums;letter-spacing:-.6px}.dsm-stat:first-child{background:var(--dsw-alias-bg-layer-1)}
      .dsm-coverage{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 16px;margin-bottom:20px;background:var(--dsw-alias-bg-layer-1)}.dsm-coverage summary{cursor:pointer;display:list-item;list-style-position:inside;color:var(--dsw-alias-label-secondary)}.dsm-coverage summary strong{color:var(--dsw-alias-label-primary);font-weight:500}.dsm-coverage-content{padding-top:10px;max-width:1100px;color:var(--dsw-alias-label-secondary);font-size:12px}.dsm-coverage-content p+p{margin-top:6px}.dsm-coverage ul{padding-left:20px;margin:8px 0 0}.dsm-warning{margin:0 0 16px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary));border-radius:8px}.dsm-warning ul{margin:6px 0 0;padding-left:18px}.dsm-error{border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-state-error-primary);padding:12px 14px;border-radius:8px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;color:var(--dsw-alias-state-error-primary)}
      .dsm-filters{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:18px}.dsm-field{display:flex;flex-direction:column;gap:5px;font-size:12px;min-width:130px;flex:1}.dsm-search{flex:3;min-width:230px}.dsm-field>span{color:var(--dsw-alias-label-secondary)}.dsm-control{width:100%;min-height:36px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}.dsm-control::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}.dsm-filter-clear{align-self:flex-end}
      .dsm-workspace{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(320px,1fr);gap:20px;align-items:start}.dsm-catalog,.dsm-detail{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;min-width:0;overflow:hidden}.dsm-panel-head{padding:15px 18px;border-bottom:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.dsm-table-scroll{overflow:auto;max-height:680px}.dsm-table{width:100%;border-collapse:collapse;font-size:12px}.dsm-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);text-align:left;font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);z-index:1;white-space:nowrap}.dsm-table th,.dsm-table td{padding:11px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top}.dsm-table tr:last-child td{border-bottom:0}.dsm-table .dsm-number{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.dsm-table .dsm-name-cell{min-width:190px;max-width:320px}.dsm-name{background:none;border:0;padding:0;color:var(--dsw-alias-label-primary);text-align:left;overflow-wrap:anywhere;font-weight:550;font-size:13px;line-height:1.45}.dsm-name:hover{color:var(--dsw-alias-brand-primary);text-decoration:underline}.dsm-description{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:4px!important;font-size:11px;color:var(--dsw-alias-label-secondary)}.dsm-table tbody tr:hover{background:var(--dsw-alias-bg-layer-1)}.dsm-table tr[data-selected=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-base))}.dsm-table tr[data-selected=true] td:first-child{box-shadow:inset 3px 0 var(--dsw-alias-brand-primary)}.dsm-source{max-width:160px;overflow-wrap:anywhere}.dsm-status{display:inline-flex;gap:6px;align-items:center;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}.dsm-status i{display:block;width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}.dsm-status[data-status=present]{color:var(--dsw-alias-state-success-primary,var(--dsw-alias-brand-primary))}.dsm-status[data-status=missing],.dsm-status[data-status=unavailable]{color:var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))}.dsm-pagination{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1)}
      .dsm-empty{padding:42px 24px;text-align:center;color:var(--dsw-alias-label-secondary)}.dsm-empty h2{color:var(--dsw-alias-label-primary);margin-bottom:7px}.dsm-empty p{max-width:380px;margin:0 auto}.dsm-empty .dsm-btn{margin-top:15px}.dsm-detail-header{padding:18px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dsm-detail-title{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.dsm-detail-title h2{font-size:18px;overflow-wrap:anywhere}.dsm-detail-header p{margin-top:10px;overflow-wrap:anywhere}.dsm-section{padding:17px 18px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dsm-section:last-child{border-bottom:0}.dsm-section>h3{margin-bottom:12px}.dsm-properties{margin:0;display:grid;gap:10px}.dsm-property{display:grid;grid-template-columns:105px minmax(0,1fr);gap:10px;font-size:12px}.dsm-property dt{color:var(--dsw-alias-label-secondary)}.dsm-property dd{margin:0;overflow-wrap:anywhere}.dsm-detail-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0}.dsm-detail-stats dt{color:var(--dsw-alias-label-secondary);font-size:11px}.dsm-detail-stats dd{margin:3px 0 0;font-size:21px;font-variant-numeric:tabular-nums}.dsm-lifecycle{list-style:none;padding:0;margin:0}.dsm-lifecycle li{position:relative;margin-left:4px;padding:0 0 17px 20px;border-left:1px solid var(--dsw-alias-border-l1)}.dsm-lifecycle li:last-child{padding-bottom:0;border-color:transparent}.dsm-lifecycle li:before{content:'';position:absolute;left:-4px;top:6px;width:7px;height:7px;border:1px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));border-radius:50%;background:var(--dsw-alias-bg-base)}.dsm-lifecycle-label{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12px}.dsm-lifecycle time{color:var(--dsw-alias-label-secondary);font-size:11px}.dsm-lifecycle .dsm-caption{margin-top:4px}.dsm-actor{overflow-wrap:anywhere}.dsm-contexts{list-style:none;padding:0;margin:0;display:grid;gap:12px}.dsm-context-title{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.dsm-history{list-style:none;padding:0;margin:12px 0 0}.dsm-history>li{padding:12px 0;border-top:1px solid var(--dsw-alias-border-l1)}.dsm-event-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px}.dsm-event-top time{font-size:11px;color:var(--dsw-alias-label-secondary)}.dsm-history details{margin-top:5px}.dsm-history summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:11px}.dsm-history pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1);font-size:11px}.dsm-footer{margin-top:18px;font-size:11px;color:var(--dsw-alias-label-secondary)}
      .dsm-group-name{display:flex;align-items:baseline;gap:7px}.dsm-group-chevron{font-size:11px;color:var(--dsw-alias-label-secondary);flex:none}.dsm-group-note{padding:0 18px 14px;font-size:12px;color:var(--dsw-alias-label-secondary)}.dsm-group-expanded>td{padding:0!important;background:var(--dsw-alias-bg-layer-1)}.dsm-group-content{padding:16px}.dsm-group-content>p{margin:6px 0 12px}.dsm-instance-list{display:grid;gap:12px;list-style:none;padding:0;margin:0}.dsm-instance{padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}.dsm-instance[data-selected=true]{border-color:var(--dsw-alias-brand-primary)}.dsm-instance-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}.dsm-instance-properties{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 18px}.dsm-instance .dsm-property{grid-template-columns:80px minmax(0,1fr)}.dsm-instance-usage{margin:13px 0 0;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}.dsm-instance-usage dd{font-size:18px}.dsm-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.dsm-tag{font-size:10px;line-height:1.6;padding:1px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;color:var(--dsw-alias-label-secondary)}.dsm-tag-match{color:var(--dsw-alias-brand-primary)}.dsm-instance-hash{margin-top:8px}.dsm-group-count{white-space:nowrap;font-variant-numeric:tabular-nums}.dsm-table .dsm-group-expanded:hover{background:var(--dsw-alias-bg-layer-1)}
      .dsm-management{display:grid;gap:16px}.dsm-management h4{margin:0;font-size:12px;font-weight:600}.dsm-management-group{display:grid;gap:9px}.dsm-manage-note{font-size:12px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}.dsm-manage-reason{border-left:2px solid var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));padding-left:10px}.dsm-danger{color:var(--dsw-alias-state-error-primary)}.dsm-confirm{display:grid;gap:12px;padding:14px;border:1px solid var(--dsw-alias-brand-primary);border-radius:9px;background:var(--dsw-alias-bg-layer-1)}.dsm-confirm:focus{outline:none}.dsm-confirm .dsm-properties{grid-template-columns:1fr}.dsm-confirm .dsm-property{grid-template-columns:105px minmax(0,1fr)}.dsm-confirm ul{padding-left:18px;margin:0;font-size:12px}.dsm-confirm label{font-size:12px;display:grid;gap:6px}.dsm-manage-alert{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:11px;font-size:12px;overflow-wrap:anywhere}.dsm-manage-alert p+p{margin-top:6px}.dsm-manage-status{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.dsm-manage-banner{margin-bottom:16px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      @container(max-width:1120px){.dsm-workspace{grid-template-columns:minmax(0,1fr)}.dsm-table-scroll{max-height:540px}.dsm-detail{width:100%}.dsm-detail .dsm-properties{grid-template-columns:repeat(2,minmax(0,1fr))}.dsm-detail .dsm-property{grid-template-columns:100px minmax(0,1fr)}}
      @container(max-width:680px){.dsm-body{padding:20px 14px}.dsm-header{flex-direction:column;gap:14px}.dsm-header-actions{align-items:flex-start;width:100%;flex-direction:row;align-items:center;justify-content:space-between}.dsm h1{font-size:23px}.dsm-heading{gap:10px}.dsm-icon{padding:8px}.dsm-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dsm-stat{padding:12px}.dsm-stat:first-child{grid-column:1/-1}.dsm-stat dd{font-size:24px}.dsm-search{flex-basis:100%;min-width:0}.dsm-field{min-width:120px}.dsm-filter-clear{flex:1}.dsm-detail .dsm-properties{grid-template-columns:1fr}.dsm-coverage{padding:11px 12px}.dsm-panel-head{padding:12px}.dsm-error{align-items:flex-start}.dsm-pagination{flex-wrap:wrap}.dsm-table th,.dsm-table td{padding:10px}.dsm-workspace{gap:14px}.dsm-instance-properties{grid-template-columns:1fr}.dsm-group-content{padding:10px}.dsm-instance{padding:12px}}
    `;
    return {
      inject:['slots', 'locale', 'layout'],
      apply(ctx) {
        for (const [language, dictionary] of Object.entries(dictionaries)) {
          ctx.effect(() => ctx.locale.register('skill-manager', language, dictionary));
        }
        const t = ctx.locale.bind('skill-manager');
        const controllers = new Set();
        const managementListeners = new Set();
        let managementState = {busy:null, uncertain:{}}, managementSequence = 0;
        let alive = true;
        const publishManagement = patch => { if (alive) { managementState = {...managementState, ...patch}; for (const listener of managementListeners) listener(); } };
        const markUncertain = (id, operation) => publishManagement({uncertain:{...managementState.uncertain, [id]:operation}});
        const clearUncertain = id => { const uncertain = {...managementState.uncertain}; delete uncertain[id]; publishManagement({uncertain}); };
        function beginManagement(id, phase) {
          if (managementState.busy || !alive) return null;
          const busy = {id, phase, sequence:++managementSequence}; publishManagement({busy}); return busy;
        }
        const endManagement = operation => { if (managementState.busy?.sequence === operation?.sequence) publishManagement({busy:null}); };
        function useManagementState() { return useSyncExternalStore(listener => { managementListeners.add(listener); return () => managementListeners.delete(listener); }, () => managementState); }
        ctx.effect(() => () => { alive = false; for (const controller of controllers) controller.abort(); controllers.clear(); managementListeners.clear(); managementState = {busy:null, uncertain:{}}; });
        const locale = () => ctx.locale.getLocale().active;
        function useLocale() { useSyncExternalStore(fn => ctx.locale.subscribe(fn), () => ctx.locale.getSnapshot()); }
        function text(value, fallback = '') { return typeof value === 'string' && value ? value : fallback; }
        function count(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
        function number(value) { const n = count(value); return n === null ? t('unknown') : n.toLocaleString(locale()); }
        function timestamp(value) { if (value === null || value === undefined || value === '') return null; const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; }
        function DateValue({value, fallback = 'unknown'}) { const date = timestamp(value); return date ? h('time', {dateTime:date.toISOString(), title:date.toLocaleString(locale())}, date.toLocaleString(locale(), {year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})) : h('span', {className:'dsm-muted'}, t(fallback)); }
        function Icon({size = 20}) { return h('svg', {viewBox:'0 0 24 24', width:size, height:size, fill:'none', stroke:'currentColor', strokeWidth:1.6, strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true}, h('path', {d:'m12 3 9 5-9 5-9-5 9-5Z'}), h('path', {d:'m3 12 9 5 9-5M3 16l9 5 9-5'})); }
        const Button = ({children, ...props}) => h('button', {type:'button', className:'dsm-btn', ...props}, children);
        function Status({status}) { const known = ['present', 'missing', 'unavailable', 'mixed'].includes(status) ? status : 'unknownStatus'; return h('span', {className:'dsm-status', 'data-status':status}, h('i', {'aria-hidden':true}), t(known)); }
        function Actor({actor}) {
          if (!actor || actor.kind === 'unknown') return h('span', {className:'dsm-muted'}, t('unknown'));
          const kind = ['agent', 'user', 'tool'].includes(actor.kind) ? t(actor.kind) : t('unknown');
          return h('span', {className:'dsm-actor', title:actor.sessionId ? `${t('session')}: ${actor.sessionId}` : undefined}, text(actor.label, kind), actor.label && ` · ${kind}`, actor.sessionId && h('span', {className:'dsm-caption dsm-mono'}, ` · ${t('session')}: ${actor.sessionId}`));
        }
        async function request(path, controller, method = 'GET', body, timeoutMs = 30000) {
          controllers.add(controller);
          let timedOut = false;
          const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
          try {
            let response;
            try { response = await fetch(`/api/skill-manager/v1/${path}`, {method, credentials:'same-origin', cache:'no-store', signal:controller.signal, headers:{Accept:'application/json', ...(body === undefined ? {} : {'Content-Type':'application/json'})}, body:body === undefined ? undefined : JSON.stringify(body)}); }
            catch (error) { if (timedOut) throw new Error('timeout'); if (controller.signal.aborted) throw error; throw new Error('network'); }
            let result = null;
            if (response.status !== 204) {
              try { result = await response.json(); }
              catch { if (response.ok) throw new Error(timedOut ? 'timeout' : 'invalid'); }
            }
            if (!response.ok || result?.error) {
              const error = new Error('http'); error.status = response.status;
              error.code = text(result?.error?.code); error.detail = text(result?.error?.message); throw error;
            }
            return result;
          } finally { clearTimeout(timer); controllers.delete(controller); }
        }
        function errorLabel(error) {
          const label = error?.message === 'http' ? `${t('http')} (${error.status})` : t(['timeout', 'network', 'invalid'].includes(error?.message) ? error.message : 'network');
          return `${label}${error?.detail ? ` · ${error.detail}` : ''}${error?.code ? ` [${error.code}]` : ''}`;
        }
        function useCatalog() {
          const [state, setState] = useState({data:null, busy:true, error:null});
          const actions = useRef({load:() => {}});
          useEffect(() => {
            let mounted = true, flight = null, controller = null;
            function load(force = false) {
              if (!mounted || !alive) return Promise.resolve(null);
              if (flight) return force ? flight.then(() => load(true)) : flight;
              if (!force && managementState.busy?.phase === 'execute') return Promise.resolve(null);
              controller = new AbortController();
              const active = controller;
              setState(previous => ({...previous, busy:true}));
              flight = (async () => {
                try {
                  let data = await request(force ? 'refresh' : 'snapshot', active, force ? 'POST' : 'GET');
                  if (force && (!data || !Array.isArray(data.skills))) data = await request('snapshot', active);
                  if (data?.apiVersion !== 1 || !Array.isArray(data.skills) || !Array.isArray(data.groups) || data.groups.some(group => !Array.isArray(group.instanceIds))) throw new Error('invalid');
                  if (mounted && alive) { setState({data, busy:false, error:null}); return data; }
                } catch (error) { if (mounted && alive) setState(previous => ({...previous, busy:false, error})); }
                finally { if (controller === active) { flight = null; controller = null; } }
                return null;
              })();
              return flight;
            }
            actions.current.load = load;
            load();
            const timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
            const visible = () => { if (!document.hidden) load(); };
            document.addEventListener('visibilitychange', visible);
            return () => { mounted = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); controller?.abort(); actions.current.load = () => Promise.resolve(null); };
          }, []);
          return {...state, load:force => actions.current.load(force)};
        }
        function useHistory(id, revision) {
          const [state, setState] = useState({data:null, busy:true, error:null});
          const actions = useRef({more:() => {}, retry:() => {}});
          useEffect(() => {
            let mounted = true, flight = null, current = null;
            const update = patch => { if (mounted && alive) setState(previous => ({...previous, ...patch})); };
            async function load(offset = 0, append = false) {
              if (!mounted || !alive || flight) return;
              const controller = new AbortController(); flight = controller;
              update({busy:true, error:null});
              try {
                const data = await request(`skills?id=${encodeURIComponent(id)}&offset=${offset}&limit=30`, controller);
                if (!data?.skill || !Array.isArray(data.events) || !Number.isFinite(data.total)) throw new Error('invalid');
                if (mounted && alive) {
                  const events = append && current ? [...current.events, ...data.events] : data.events;
                  const seen = new Set();
                  current = {...data, events:events.filter(event => { if (seen.has(event.id)) return false; seen.add(event.id); return true; })};
                  update({data:current, busy:false});
                }
              } catch (error) { update({busy:false, error}); }
              finally { if (flight === controller) flight = null; }
            }
            update({data:null, busy:true, error:null});
            actions.current = {more:() => load(current?.events.length ?? 0, true), retry:() => load(0)};
            load();
            return () => { mounted = false; flight?.abort(); actions.current = {more:() => {}, retry:() => {}}; };
          }, [id, revision]);
          return {...state, more:() => actions.current.more(), retry:() => actions.current.retry()};
        }
        function ErrorNotice({error, onRetry, busy, history = false, stale = false}) {
          if (!error) return null;
          return h('div', {className:'dsm-error', role:'alert'}, h('div', null, h('p', null, t(history ? 'historyFailed' : 'failed')), h('p', {className:'dsm-caption'}, errorLabel(error), stale ? ` ${t('snapshotStale')}` : '')), h(Button, {onClick:onRetry, disabled:busy}, t('retry')));
        }
        const Property = ({label, children, mono = false}) => h('div', {className:'dsm-property'}, h('dt', null, t(label)), h('dd', {className:mono ? 'dsm-mono' : undefined}, children));
        function resource(base) { return base && typeof base === 'object' ? [text(base.kind), text(base.path, text(base.url, text(base.description)))].filter(Boolean).join(' · ') || t('unknown') : t('noResourceBase'); }
        function UsageStats({usage = {}, className = ''}) {
          return h('dl', {className:`dsm-detail-stats ${className}`}, [['count24h','uses24h'], ['count7d','uses7d'], ['total','usesAll']].map(([key, label]) => h('div', {key}, h('dt', null, t(label)), h('dd', null, number(usage[key])))));
        }
        const actionKeys = {enable:'actionEnable', disable:'actionDisable', archive:'actionArchive', restore:'actionRestore', delete:'actionDelete'};
        const workingKeys = {enabled:'workingEnabled', disabled:'workingDisabled', unknown:'workingUnknown'};
        const fileKeys = {active:'fileActive', archived:'fileArchived', deleted:'fileDeleted', missing:'fileMissing', unknown:'fileUnknown'};
        function ManagementBadges({management, id}) {
          const pending = useManagementState().uncertain[id];
          return (management || pending) && h(React.Fragment, null,
            management?.workingStatus === 'disabled' && h('span', {className:'dsm-tag'}, t('workingDisabled')),
            ['archived','deleted'].includes(management?.fileStatus) && h('span', {className:'dsm-tag'}, t(fileKeys[management.fileStatus])),
            pending && h('span', {className:'dsm-tag'}, t('pendingBadge')));
        }
        function ManagementControls({skill, onReload}) {
          const shared = useManagementState();
          const [plan, setPlan] = useState(null), [confirmation, setConfirmation] = useState(''), [error, setError] = useState(null), [hint, setHint] = useState(''), [lastAction, setLastAction] = useState(null);
          const mounted = useRef(true), activeRequest = useRef(null), planRevision = useRef(null), panel = useRef(null), reload = useRef(onReload);
          reload.current = onReload;
          const management = skill.management;
          const allowed = allowedManagementActions(management);
          const uncertain = shared.uncertain[skill.id];
          const busy = !!shared.busy;
          useEffect(() => {
            mounted.current = true;
            return () => {
              mounted.current = false;
              const active = activeRequest.current;
              if (active?.phase === 'execute') markUncertain(skill.id, active.operation);
              active?.controller.abort();
            };
          }, [skill.id]);
          useEffect(() => {
            if (plan && planRevision.current !== management?.revision) {
              setPlan(null); setConfirmation(''); setHint('planChanged');
            }
          }, [management?.revision, plan?.token]);
          useEffect(() => {
            if (!plan) return;
            panel.current?.focus({preventScroll:true});
            const timer = setTimeout(() => { if (activeRequest.current?.phase !== 'execute') { setPlan(null); setConfirmation(''); setHint('planExpired'); } }, Math.max(0, Date.parse(plan.expiresAt) - Date.now()));
            return () => clearTimeout(timer);
          }, [plan?.token]);
          const cancel = () => { if (!busy) { setPlan(null); setConfirmation(''); setError(null); setHint(''); } };
          async function prepare(action) {
            if (!mounted.current || !alive) return;
            if (!allowed.includes(action) || managementState.uncertain[skill.id]) return;
            const operation = beginManagement(skill.id, 'prepare'); if (!operation) return;
            const controller = new AbortController(); activeRequest.current = {controller, phase:'prepare'};
            setPlan(null); setConfirmation(''); setError(null); setHint(''); setLastAction(action);
            try {
              const value = await request('manage/prepare', controller, 'POST', {id:skill.id, action}, 45000);
              if (!validManagementPlan(value, skill, action)) throw new Error('invalid');
              if (Date.parse(value.expiresAt) <= Date.now()) { if (mounted.current && alive) setHint('planExpired'); return; }
              if (mounted.current && alive) { planRevision.current = management?.revision; setPlan(value); }
            } catch (failure) { if (mounted.current && alive) { setError(failure); setHint(failure.status === 410 ? 'planExpired' : failure.status === 409 ? 'planChanged' : 'manageFailed'); } }
            finally { if (activeRequest.current?.controller === controller) activeRequest.current = null; endManagement(operation); }
          }
          async function execute() {
            if (!mounted.current || !alive) return;
            if (!plan || !allowed.includes(plan.action) || managementState.uncertain[skill.id]) return;
            if (!validManagementPlan(plan, skill, plan.action)) { setPlan(null); setConfirmation(''); setHint('planChanged'); return; }
            if (!canConfirmManagementPlan(plan, confirmation)) { if (Date.parse(plan.expiresAt) <= Date.now()) { setPlan(null); setHint('planExpired'); } return; }
            const operation = beginManagement(skill.id, 'execute'); if (!operation) return;
            const confirmedPlan = plan;
            const pending = {operationId:plan.operationId, action:plan.action, expiresAt:plan.expiresAt, status:'unknown'};
            const controller = new AbortController(); activeRequest.current = {controller, phase:'execute', operation:pending};
            // The secret token is discarded from view state before the sole admitted execute request.
            setPlan(null); setConfirmation(''); setError(null); setHint('executing');
            try {
              const body = {token:confirmedPlan.token};
              if (confirmedPlan.confirmationText != null) body.confirmationText = confirmation;
              const value = await request('manage/execute', controller, 'POST', body, 90000);
              if (value?.id !== skill.id || value?.action !== confirmedPlan.action || value?.operationId !== pending.operationId) throw new Error('invalid');
              const completed = {...pending, status:'succeeded'};
              if (activeRequest.current?.controller === controller) activeRequest.current.operation = completed;
              if (!mounted.current || !alive) { markUncertain(skill.id, completed); return; }
              publishManagement({busy:{...operation, phase:'refresh'}});
              setHint('manageDone');
              const data = await reload.current(true);
              if (data) { clearUncertain(skill.id); if (mounted.current && alive) setHint('manageChecked'); }
              else { markUncertain(skill.id, completed); if (mounted.current && alive) setHint('manageDoneStale'); }
            } catch (failure) {
              const unknown = managementOutcomeUncertain(failure);
              if (unknown) markUncertain(skill.id, pending);
              if (mounted.current && alive) { setError(failure); setHint(unknown ? 'manageUnknown' : failure.status === 410 ? 'planExpired' : failure.status === 409 ? 'planChanged' : 'manageFailed'); }
            } finally { if (activeRequest.current?.controller === controller) activeRequest.current = null; endManagement(operation); }
          }
          async function checkState() {
            if (!mounted.current || !alive) return;
            const pending = managementState.uncertain[skill.id]; if (!pending) return;
            const operation = beginManagement(skill.id, 'check'); if (!operation) return;
            const controller = new AbortController(); activeRequest.current = {controller, phase:'check'};
            setError(null);
            try {
              const statusRequestedAt = Date.now();
              const value = await request(`manage/status?id=${encodeURIComponent(skill.id)}&operationId=${encodeURIComponent(pending.operationId)}`, controller);
              if (value?.id !== skill.id || value?.operationId !== pending.operationId || typeof value.status !== 'string') throw new Error('invalid');
              markUncertain(skill.id, {...pending, status:value.status});
              const data = await reload.current(true);
              if (data && managementStatusResolved(value.status, pending.expiresAt, statusRequestedAt)) { clearUncertain(skill.id); if (mounted.current && alive) setHint('manageChecked'); }
              else if (mounted.current && alive) setHint('manageUnknown');
            } catch (failure) { if (mounted.current && alive) { setError(failure); setHint('manageUnknown'); } }
            finally { if (activeRequest.current?.controller === controller) activeRequest.current = null; endManagement(operation); }
          }
          const button = action => h(Button, {key:action, className:`dsm-btn${action === 'delete' ? ' dsm-danger' : ''}`, disabled:busy || !!uncertain || !!plan || !allowed.includes(action), onClick:() => prepare(action)}, t(actionKeys[action]));
          const statusKey = { 'not-started':'statusNotStarted', running:'statusRunning', succeeded:'statusSucceeded', failed:'statusFailed', 'recovery-required':'statusRecovery', unknown:'statusUnknown' };
          return h('section', {className:'dsm-section dsm-management', 'aria-label':t('fileActions'), 'aria-busy':busy},
            h('div', {className:'dsm-management-group'}, h('div', {className:'dsm-manage-status'}, h('h3', null, t('workingStatus')), h('span', {className:'dsm-tag'}, t(workingKeys[management?.workingStatus] ?? 'workingUnknown'))), h('div', {className:'dsm-actions'}, ['enable','disable'].map(button)), h('p', {className:'dsm-manage-note'}, t('manageCaveat'))),
            h('div', {className:'dsm-management-group'}, h('div', {className:'dsm-manage-status'}, h('h3', null, t('fileActions')), h('span', {className:'dsm-tag'}, t(fileKeys[management?.fileStatus] ?? 'fileUnknown'))), h('div', {className:'dsm-actions'}, ['archive','restore','delete'].map(button)), h('p', {className:'dsm-manage-note'}, t('fileCaveat'))),
            h('div', {className:'dsm-manage-note dsm-manage-reason'}, !management ? t('manageUnavailable') : management.eligible === true ? t('manageEligible') : t('manageProtected'), management?.reason && h('p', null, `${t('manageReason')}: ${text(management.reason)}`), management?.reasonCode && h('p', {className:'dsm-mono'}, `${t('reasonCode')}: ${text(management.reasonCode)}`)),
            management?.mode === 'override' && h('div', {className:'dsm-manage-note'}, h('p', null, t('policyOverrideNote')), h('p', null, t('policyEnableNote'))),
            busy && h('p', {className:'dsm-manage-note', role:'status'}, shared.busy.id !== skill.id ? t('manageBusyOther') : t(shared.busy.phase === 'execute' ? 'executing' : shared.busy.phase === 'prepare' ? 'preparing' : 'refreshing')),
            (hint || error || uncertain) && h('div', {className:'dsm-manage-alert', role:error || uncertain ? 'alert' : 'status'},
              h('p', null, t(uncertain ? 'manageUnknown' : hint || 'manageFailed')),
              uncertain && h(React.Fragment, null, h('p', null, t(statusKey[uncertain.status] ?? 'statusUnknown')), h('p', {className:'dsm-caption'}, t('manageBlocked'))),
              error && h('p', {className:'dsm-caption'}, errorLabel(error)),
              uncertain && h(Button, {onClick:checkState, disabled:busy, style:{marginTop:10}}, t('checkState')),
              !uncertain && error && lastAction && !plan && h(Button, {onClick:() => prepare(lastAction), disabled:busy || !allowed.includes(lastAction), style:{marginTop:10}}, t('prepareAgain'))),
            plan && h('div', {className:'dsm-confirm', ref:panel, role:'group', 'aria-label':t('confirmAction'), tabIndex:-1, onKeyDown:event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } }},
              h('h4', null, t('confirmAction')),
              h('dl', {className:'dsm-properties'}, h(Property, {label:'name'}, plan.name), h(Property, {label:'plannedAction'}, t(actionKeys[plan.action])), h(Property, {label:'target', mono:plan.targetKind !== 'policy'}, plan.targetKind === 'policy' ? `${plan.name} · ${text(skill.provider, t('unknown'))}` : plan.path), h(Property, {label:'targetKind'}, t(plan.targetKind === 'policy' ? 'targetPolicy' : plan.targetKind === 'directory' ? 'targetDirectory' : 'targetFile')), h(Property, {label:'fileCount'}, number(plan.fileCount)), h(Property, {label:'totalBytes'}, number(plan.totalBytes)), h(Property, {label:'expires'}, h('time', {dateTime:plan.expiresAt}, new Date(plan.expiresAt).toLocaleString(locale())))),
              plan.warnings.length > 0 && h('div', null, h('h4', null, t('planWarnings')), h('ul', null, plan.warnings.map((warning, index) => h('li', {key:index}, warning)))),
              plan.action === 'delete' && h('p', {className:'dsm-danger'}, t('deleteWarning')),
              plan.confirmationText != null && h('label', null, h('span', null, t('confirmName'), ': ', h('code', {className:'dsm-mono'}, plan.confirmationText)), h('input', {className:'dsm-control', value:confirmation, onChange:event => setConfirmation(event.target.value), autoComplete:'off', spellCheck:false, 'aria-required':true, disabled:busy})),
              h('div', {className:'dsm-actions'}, h(Button, {className:`dsm-btn${plan.action === 'delete' ? ' dsm-danger' : ' dsm-primary'}`, disabled:busy || !canConfirmManagementPlan(plan, confirmation), onClick:execute}, t('confirmExecute')), h(Button, {disabled:busy, onClick:cancel}, t('cancel')))));
        }
        function GroupRows({entry, selected, onSelect, hasFilters}) {
          const [expanded, setExpanded] = useState(false);
          const {group, members, matchingIds} = entry;
          const panelId = `dsm-group-${encodeURIComponent(group.id)}`;
          const selectedHere = members.some(member => member.id === selected);
          const identical = (group.identicalCopies ?? []).filter(copy => typeof copy.contentHash === 'string' && copy.contentHash.length > 0 && copy.instanceIds.length >= 2);
          return h(React.Fragment, null,
            h('tr', {'data-selected':selectedHere},
              h('td', {className:'dsm-name-cell'},
                h('button', {type:'button', className:'dsm-name dsm-group-name', onClick:() => setExpanded(value => !value), 'aria-expanded':expanded, 'aria-controls':panelId, title:t(expanded ? 'collapseGroup' : 'expandGroup')}, h('span', {className:'dsm-group-chevron', 'aria-hidden':true}, expanded ? '▾' : '▸'), text(group.name, group.id)),
                h('p', {className:'dsm-description'}, text(group.description, t('noDescription'))),
                (group.metadataDiffers || identical.length > 0) && h('div', {className:'dsm-tags'}, group.metadataDiffers && h('span', {className:'dsm-tag'}, t('metadataDiffers')), identical.length > 0 && h('span', {className:'dsm-tag'}, t('identicalContent')))),
              h('td', {className:'dsm-number dsm-group-count'}, number(group.instanceCount)),
              h('td', {className:'dsm-source'}, (group.sources ?? []).join(' · ') || t('unknown'), h('div', {className:'dsm-caption'}, (group.providers ?? []).join(' · '))),
              h('td', null, h(Status, {status:group.status})),
              ['count24h','count7d','total'].map(key => h('td', {key, className:'dsm-number'}, number(group.usage?.[key]))),
              h('td', {className:'dsm-caption'}, h(DateValue, {value:group.usage?.lastAt, fallback:'never'}))),
            expanded && h('tr', {className:'dsm-group-expanded', id:panelId}, h('td', {colSpan:8},
              h('section', {className:'dsm-group-content', 'aria-label':`${t('groupInstances')}: ${group.name}`},
                h('h3', null, t('groupInstances')),
                h('p', {className:'dsm-caption'}, t('fullGroupUsage'), hasFilters && ` ${t('matchingInstances')}: ${number(matchingIds.length)} / ${number(members.length)}`),
                h('ul', {className:'dsm-instance-list'}, members.map(member => {
                  const sameHash = identical.find(copy => copy.contentHash === member.contentHash && copy.instanceIds.includes(member.id));
                  return h('li', {className:'dsm-instance', key:member.id, 'data-selected':selected === member.id},
                    h('header', {className:'dsm-instance-head'}, h('div', {className:'dsm-actions'}, h(Status, {status:member.status}), h(ManagementBadges, {management:member.management, id:member.id}), hasFilters && matchingIds.includes(member.id) && h('span', {className:'dsm-tag dsm-tag-match'}, t('matchesFilters'))), h(Button, {onClick:() => onSelect(member.id), 'aria-current':selected === member.id ? 'true' : undefined}, t(selected === member.id ? 'selectedInstance' : 'inspectInstance'))),
                    h('dl', {className:'dsm-properties dsm-instance-properties'},
                      h(Property, {label:'source'}, text(member.source, t('unknown'))),
                      h(Property, {label:'provider'}, text(member.provider, t('unknown'))),
                      h(Property, {label:'path', mono:true}, text(member.path, t('notReported'))),
                      h(Property, {label:'resourceBase', mono:true}, resource(member.resourceBase)),
                      h(Property, {label:'description'}, text(member.description, t('noDescription'))),
                      h(Property, {label:'contentHash', mono:true}, text(member.contentHash, t('unknown')))),
                    sameHash && h('p', {className:'dsm-caption dsm-instance-hash'}, `${t('identicalWith')}: ${number(sameHash.instanceIds.length)}`),
                    h(UsageStats, {usage:member.usage, className:'dsm-instance-usage'}));
                }))))));
        }
        function SkillDetail({skill, revision, contexts, onClose, onReload}) {
          const history = useHistory(skill.id, revision);
          const usage = skill.usage ?? {};
          const lifecycle = [
            {label:'created', at:skill.createdAt, actor:skill.createdBy, note:skill.createdEvidence === 'filesystem-birthtime' ? 'birthtime' : !skill.createdAt ? 'creationUnknown' : null},
            {label:'modified', at:skill.modifiedAt, actor:skill.modifiedBy},
            {label:'firstSeen', at:skill.firstSeenAt, note:'observedOnly'},
            {label:'lastSeen', at:skill.lastSeenAt, note:'observedOnly'},
            {label:'lastUse', at:usage.lastAt, actor:usage.lastActor, fallback:'never'}
          ];
          return h('aside', {className:'dsm-detail', 'aria-label':t('details')},
            h('header', {className:'dsm-detail-header'}, h('div', {className:'dsm-detail-title'}, h('div', null, h('div', {className:'dsm-caption'}, t('details')), h('h2', null, text(skill.name, skill.id))), h(Button, {className:'dsm-btn dsm-icon-button', onClick:onClose, title:t('closeDetails'), 'aria-label':t('closeDetails')}, '×')), h('div', {className:'dsm-manage-status'}, h(Status, {status:skill.status}), h(ManagementBadges, {management:skill.management, id:skill.id})), h('p', {className:'dsm-muted'}, text(skill.description, t('noDescription')))),
            h(ManagementControls, {skill, onReload}),
            h('section', {className:'dsm-section'}, h('h3', null, t('usage')), h('dl', {className:'dsm-detail-stats'}, [['count24h','uses24h'], ['count7d','uses7d'], ['total','usesAll']].map(([key, label]) => h('div', {key}, h('dt', null, t(label)), h('dd', null, number(usage[key])))))),
            h('section', {className:'dsm-section'}, h('h3', null, t('identity')), h('dl', {className:'dsm-properties'}, h(Property, {label:'skillId', mono:true}, skill.id), h(Property, {label:'source'}, text(skill.source, t('unknown'))), h(Property, {label:'provider'}, text(skill.provider, t('unknown'))), h(Property, {label:'path', mono:true}, text(skill.path, t('unknown'))), h(Property, {label:'resourceBase', mono:true}, resource(skill.resourceBase)), h(Property, {label:'contentHash', mono:true}, text(skill.contentHash, t('notReported'))))),
            h('section', {className:'dsm-section'}, h('h3', null, t('lifecycle')), h('ol', {className:'dsm-lifecycle'}, lifecycle.map(item => h('li', {key:item.label}, h('div', {className:'dsm-lifecycle-label'}, h('span', null, t(item.label)), h(DateValue, {value:item.at, fallback:item.fallback})), Object.hasOwn(item, 'actor') && h('div', {className:'dsm-caption'}, `${t('by')}: `, h(Actor, {actor:item.actor})), item.note && h('p', {className:'dsm-caption'}, t(item.note))))),
            h('section', {className:'dsm-section'}, h('h3', null, t('availability')),
              (skill.availability ?? []).length ? h('ul', {className:'dsm-contexts'}, skill.availability.map((entry, index) => {
                const context = contexts.find(item => item.id === entry.contextId);
                return h('li', {key:`${entry.contextId}-${index}`},
                  h('div', {className:'dsm-context-title'}, h('span', null, text(context?.label, text(entry.contextId, t('context')))), h('span', {className:'dsm-caption'}, t(entry.effective === true ? 'effective' : entry.effective === false ? 'notEffective' : 'unknown'))),
                  h('div', {className:'dsm-mono dsm-muted'}, text(entry.cwd, text(context?.cwd, t('unknown')))),
                  h('dl', {className:'dsm-properties', style:{marginTop:8}},
                    Object.hasOwn(entry, 'source') && h(Property, {label:'source'}, text(entry.source, t('unknown'))),
                    Object.hasOwn(entry, 'description') && h(Property, {label:'description'}, text(entry.description, t('noDescription'))),
                    Object.hasOwn(entry, 'invocation') && h(Property, {label:'invocation', mono:true}, entry.invocation == null ? t('unknown') : typeof entry.invocation === 'string' ? entry.invocation : JSON.stringify(entry.invocation)),
                    Object.hasOwn(entry, 'resourceBase') && h(Property, {label:'resourceBase', mono:true}, resource(entry.resourceBase))));
              })) : h('p', {className:'dsm-caption'}, t('noAvailability'))),
            h('section', {className:'dsm-section'}, h('h3', null, t('history')), h('p', {className:'dsm-caption'}, t('historyCoverage')), h(ErrorNotice, {error:history.error, onRetry:history.retry, busy:history.busy, history:true}), history.busy && !history.data && h('p', {className:'dsm-caption', role:'status'}, t('loading')), history.data && h(React.Fragment, null,
              h('ol', {className:'dsm-history'}, history.data.events.map(event => h('li', {key:event.id}, h('div', {className:'dsm-event-top'}, h('span', null, Object.hasOwn(dictionaries.en, `event.${event.kind}`) ? t(`event.${event.kind}`) : text(event.kind, t('eventUnknown'))), h(DateValue, {value:event.at})), h('div', {className:'dsm-caption'}, `${t('actor')}: `, h(Actor, {actor:event.actor})), event.details && Object.keys(event.details).length > 0 && h('details', null, h('summary', null, t('eventDetails')), h('pre', null, JSON.stringify(event.details, null, 2)))))),
              history.data.events.length === 0 && h('p', {className:'dsm-caption', style:{marginTop:12}}, t('noEvents')), h('div', {className:'dsm-actions', style:{marginTop:12}}, h('span', {className:'dsm-caption'}, `${t('showingEvents')}: ${number(history.data.events.length)} / ${number(history.data.total)}`), history.data.events.length < history.data.total && h(Button, {disabled:history.busy, onClick:history.more}, t(history.busy ? 'refreshing' : 'more')))))));
        }
        function Page() {
          useLocale();
          const catalog = useCatalog();
          const management = useManagementState();
          const [query, setQuery] = useState(''), [source, setSource] = useState(''), [status, setStatus] = useState(''), [sort, setSort] = useState('name'), [selected, setSelected] = useState(null), [page, setPage] = useState(0);
          const skills = catalog.data?.skills ?? [];
          const groups = catalog.data?.groups ?? [];
          const activeLocale = locale();
          const filtered = useMemo(() => selectGroups(groups, skills, {query, source, status, sort, locale:activeLocale}), [groups, skills, query, source, status, sort, activeLocale]);
          const pageCount = Math.max(1, Math.ceil(filtered.length / 50)), currentPage = Math.min(page, pageCount - 1), shown = filtered.slice(currentPage * 50, currentPage * 50 + 50);
          const selectedSkill = skills.find(skill => skill.id === selected);
          const sources = [...new Set(groups.flatMap(group => group.sources ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b, activeLocale));
          if (source && !sources.includes(source)) sources.push(source);
          const total = key => groups.reduce((sum, group) => sum === null || count(group.usage?.[key]) === null ? null : sum + group.usage[key], 0);
          const stats = [['totalSkills', groups.length], ['totalInstances', skills.length], ['uses24h', total('count24h')], ['uses7d', total('count7d')], ['usesAll', total('total')]];
          const change = setter => event => { setter(event.target.value); setPage(0); };
          const clear = () => { setQuery(''); setSource(''); setStatus(''); setPage(0); };
          const hasFilters = !!(query || source || status);
          const field = (label, value, setter, options) => h('label', {className:'dsm-field'}, h('span', null, t(label)), h('select', {className:'dsm-control', value, onChange:change(setter)}, options.map(([value, label, literal]) => h('option', {key:value, value}, literal ? label : t(label)))));
          return h('div', {className:'dsm'}, h('style', null, css), h('main', {className:'dsm-body', 'aria-label':t('title')},
            h('header', {className:'dsm-header'}, h('div', null, h('div', {className:'dsm-heading'}, h('span', {className:'dsm-icon'}, h(Icon, {size:27})), h('h1', null, t('title'))), h('p', {className:'dsm-subtitle'}, t('subtitle'))), h('div', {className:'dsm-header-actions'}, h(Button, {className:'dsm-btn dsm-primary', disabled:catalog.busy, onClick:() => catalog.load(true)}, h('span', {'aria-hidden':true}, '↻'), t(catalog.busy ? 'refreshing' : 'refresh')), catalog.data?.updatedAt && h('span', {className:'dsm-caption'}, `${t('updated')}: `, h(DateValue, {value:catalog.data.updatedAt})))),
            management.busy?.phase === 'execute' && h('div', {className:'dsm-manage-banner', role:'status'}, t('executing'), ' ', t('executionNotice')),
            Object.keys(management.uncertain).length > 0 && h('div', {className:'dsm-manage-banner', role:'status'}, t('pendingReview')),
            h(ErrorNotice, {error:catalog.error, onRetry:() => catalog.load(), busy:catalog.busy, stale:!!catalog.data}),
            !catalog.data && h('div', {className:'dsm-empty', role:'status'}, catalog.busy ? t('loading') : t('network')),
            catalog.data && h(React.Fragment, null,
              h('dl', {className:'dsm-stats'}, stats.map(([label, value]) => h('div', {className:'dsm-stat', key:label}, h('dt', null, t(label)), h('dd', null, number(value))))),
              h('details', {className:'dsm-coverage'}, h('summary', null, h('strong', null, t('observed')), ' · ', catalog.data.coverage?.since ? h(React.Fragment, null, `${t('since')} `, h(DateValue, {value:catalog.data.coverage.since})) : t('coverageUnknown')), h('div', {className:'dsm-coverage-content'}, h('p', null, t('coverageNote')), h('p', null, t('attributionNote')), (catalog.data.coverage?.notes ?? []).length > 0 && h('ul', null, catalog.data.coverage.notes.map((note, index) => h('li', {key:index}, text(note)))))),
              (catalog.data.warnings ?? []).length > 0 && h('section', {className:'dsm-warning', 'aria-label':t('warnings')}, h('h3', null, t('warnings')), h('ul', null, catalog.data.warnings.map((warning, index) => h('li', {key:`${warning.code}-${index}`}, text(warning.message, warning.code))))),
              h('p', {className:'dsm-group-note'}, t('groupingNote')),
              h('form', {className:'dsm-filters', role:'search', onSubmit:event => event.preventDefault()}, h('label', {className:'dsm-field dsm-search'}, h('span', null, t('search')), h('input', {type:'search', className:'dsm-control', value:query, placeholder:t('searchPlaceholder'), onChange:change(setQuery)})), field('source', source, setSource, [['','allSources'], ...sources.map(value => [value, value, true])]), field('status', status, setStatus, [['','allStatuses'], ['present','present'], ['missing','missing'], ['unavailable','unavailable'], ['unknown','unknownStatus']]), field('sort', sort, setSort, [['name','sortName'], ['count24h','sort24h'], ['count7d','sort7d'], ['total','sortAll'], ['recent','sortRecent'], ['modified','sortModified']]), hasFilters && h(Button, {className:'dsm-btn dsm-filter-clear', onClick:clear}, t('clear'))),
              h('div', {className:'dsm-workspace'},
                h('section', {className:'dsm-catalog', 'aria-label':t('catalog'), 'aria-busy':catalog.busy}, h('header', {className:'dsm-panel-head'}, h('h2', null, t('catalog')), h('span', {className:'dsm-caption', role:'status', 'aria-live':'polite'}, `${t('groupResults')}: ${number(shown.length)} / ${number(filtered.length)} / ${number(groups.length)}`)),
                  h('p', {className:'dsm-group-note', style:{paddingTop:12}}, t('groupFilterNote')),
                  shown.length > 0 ? h('div', {className:'dsm-table-scroll'},
                    h('table', {className:'dsm-table'},
                      h('caption', {className:'dsm-sr'}, t('catalog')),
                      h('thead', null, h('tr', null, ['name','instances','groupSources','status','count24h','count7d','countAll','lastUsed'].map((key, index) => h('th', {key, scope:'col', className:index === 1 || index >= 4 && index <= 6 ? 'dsm-number' : undefined}, t(key))))),
                      h('tbody', null, shown.map(entry => h(GroupRows, {key:entry.group.id, entry, selected, onSelect:setSelected, hasFilters})))))
                    : h('div', {className:'dsm-empty'}, h('h2', null, t(groups.length ? 'noResults' : 'noSkills')), h('p', null, t(groups.length ? 'selectionHint' : 'noSkillsNote')), hasFilters && h(Button, {onClick:clear}, t('clear'))),
                  filtered.length > 50 && h('nav', {className:'dsm-pagination', 'aria-label':t('page')}, h('span', {className:'dsm-caption'}, `${t('page')} ${number(currentPage + 1)} / ${number(pageCount)}`), h('div', {className:'dsm-actions'}, h(Button, {disabled:currentPage === 0, onClick:() => setPage(currentPage - 1)}, t('previous')), h(Button, {disabled:currentPage + 1 >= pageCount, onClick:() => setPage(currentPage + 1)}, t('next'))))),
                selectedSkill ? h(SkillDetail, {key:selectedSkill.id, skill:selectedSkill, revision:catalog.data.updatedAt, contexts:catalog.data.contexts ?? [], onClose:() => setSelected(null), onReload:catalog.load}) : h('aside', {className:'dsm-detail dsm-empty', 'aria-label':t('details')}, h('h2', null, t('noSelection')), h('p', null, t('selectionHint')))),
              h('footer', {className:'dsm-footer'}, t('managementFooter')))));
        }
        const register = (name, options, component) => ctx.slots.inject(name, () => ctx.slots.register({name, ...options}, component));
        register('main', {key:'skill-manager'}, Page);
        // The panellist owns its button and calls layout.selectPanel(id); register only its icon.
        register('sidebar.panellist', {id:'skill-manager', order:16, label:() => t('title')}, Icon);
      }
    };
  }
});
