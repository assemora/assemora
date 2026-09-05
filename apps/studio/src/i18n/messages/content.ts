/**
 * Entries and the resources that hold them — the listing, the form, the fields and the language bar.
 */
import type { Catalogue } from '../catalogue.ts'

export const CONTENT = {
  // --- a collection with nothing in it ------------------------------------------
  //
  // `{name}` is the application's own word for one of these — `testimonial` — written
  // in whatever language its developer wrote it in. English can put a foreign noun into
  // a sentence uninflected; Ukrainian and Russian would have to decline it, and cannot.
  // So they say the sentence without it — the resource's own name is in the heading
  // directly above — which is what a hole a translation does not use is for.
  'entries.blank.title': {
    en: 'No {name} yet',
    uk: 'Тут ще немає жодного запису',
    ru: 'Здесь ещё нет ни одной записи',
  },
  'entries.blank.create': { en: 'Create {name}', uk: 'Створити запис', ru: 'Создать запись' },
  'entries.blank.what': {
    en: 'An entry is one {name}, filled in against the fields declared for it.',
    uk: 'Запис — це один рядок цієї колекції, заповнений за оголошеними для нього полями.',
    ru: 'Запись — это одна строка этой коллекции, заполненная по объявленным для неё полям.',
  },
  'entries.blank.cheapest': {
    en: 'Nothing is stored against them yet, which makes this the cheapest moment to change what they are: what a value is becomes fixed as soon as one exists.',
    uk: 'За ними ще нічого не збережено, і це найдешевший момент змінити те, чим вони є: щойно з’явиться перше значення, його тип стає незмінним.',
    ru: 'По ним ещё ничего не сохранено, и это самый дешёвый момент изменить то, чем они являются: как только появится первое значение, его тип становится неизменным.',
  },
  // --- what a cell says where a value is not its own words -----------------------
  'cell.yes': { en: 'Yes', uk: 'Так', ru: 'Да' },
  'cell.no': { en: 'No', uk: 'Ні', ru: 'Нет' },
  'cell.anEntry': { en: 'an entry', uk: 'запис', ru: 'запись' },

  // --- a row and its menu ---------------------------------------------------------
  'row.actions': { en: 'Actions', uk: 'Дії', ru: 'Действия' },
  'row.entryActions': { en: 'Entry actions', uk: 'Дії із записом', ru: 'Действия с записью' },
  'row.edit': { en: 'Edit', uk: 'Редагувати', ru: 'Редактировать' },
  'row.duplicate': { en: 'Duplicate', uk: 'Дублювати', ru: 'Дублировать' },

  // --- the listing ----------------------------------------------------------------
  'collection.reading': {
    en: 'Reading entries from the {resource} adapter',
    uk: 'Читаємо записи через адаптер «{resource}»',
    ru: 'Читаем записи через адаптер «{resource}»',
  },
  'collection.unknown': {
    en: 'No collection called “{name}”',
    uk: 'Немає колекції з назвою «{name}»',
    ru: 'Нет коллекции с названием «{name}»',
  },
  'collection.unknownBody': {
    en: 'The application does not describe a resource by that name.',
    uk: 'Застосунок не описує ресурс із такою назвою.',
    ru: 'Приложение не описывает ресурс с таким названием.',
  },
  'collection.searchPlaceholder': { en: 'Search…', uk: 'Пошук…', ru: 'Поиск…' },
  'collection.searchLabel': {
    en: 'Search {name}',
    uk: 'Пошук у «{name}»',
    ru: 'Поиск в «{name}»',
  },
  'collection.sortOrder': { en: 'Sort order', uk: 'Порядок сортування', ru: 'Порядок сортировки' },
  'collection.defaultOrder': {
    en: 'Default order',
    uk: 'Типовий порядок',
    ru: 'Порядок по умолчанию',
  },
  'collection.selected': { en: '{count} selected', uk: 'Вибрано {count}', ru: 'Выбрано {count}' },
  'collection.clearSelection': {
    en: 'Clear the selection',
    uk: 'Зняти вибір',
    ru: 'Снять выделение',
  },
  'collection.selectAll': {
    en: 'Select every entry on this page',
    uk: 'Вибрати всі записи на цій сторінці',
    ru: 'Выбрать все записи на этой странице',
  },
  'collection.selectOne': {
    en: 'Select entry {id}',
    uk: 'Вибрати запис {id}',
    ru: 'Выбрать запись {id}',
  },
  'collection.noMatch': {
    en: 'Nothing matches “{search}”',
    uk: 'Нічого не знайдено за запитом «{search}»',
    ru: 'Ничего не найдено по запросу «{search}»',
  },
  'collection.clearSearch': { en: 'Clear search', uk: 'Очистити пошук', ru: 'Очистить поиск' },
  'collection.searchableOnly': {
    en: 'Only the fields the resource declares searchable are looked at.',
    uk: 'Шукаємо лише в тих полях, які ресурс оголосив придатними для пошуку.',
    ru: 'Ищем только в тех полях, которые ресурс объявил пригодными для поиска.',
  },
  // The row's own language, where the listing answered with a fallback (SPEC.md §131).
  'collection.notTranslated': {
    en: 'Not translated — this is the {locale} original',
    uk: 'Не перекладено — це оригінал мовою {locale}',
    ru: 'Не переведено — это оригинал на языке {locale}',
  },
  'collection.loadFailed': {
    en: 'Entries could not be loaded',
    uk: 'Не вдалося завантажити записи',
    ru: 'Не удалось загрузить записи',
  },
  'collection.loadFailedBody': {
    en: 'Nothing was written, and no entry was changed.',
    uk: 'Нічого не записано, жоден запис не змінено.',
    ru: 'Ничего не записано, ни одна запись не изменена.',
  },
  'collection.noEntries': { en: 'No entries', uk: 'Записів немає', ru: 'Записей нет' },
  'collection.entryCount': {
    en: ['{count} entry', '{count} entries', '{count} entries'],
    uk: ['{count} запис', '{count} записи', '{count} записів'],
    ru: ['{count} запись', '{count} записи', '{count} записей'],
  },

  // --- deleting entries, which is always asked about ------------------------------
  'entries.delete.one': {
    en: 'Delete “{name}”?',
    uk: 'Видалити «{name}»?',
    ru: 'Удалить «{name}»?',
  },
  'entries.delete.many': {
    en: ['Delete {count} entry?', 'Delete {count} entries?', 'Delete {count} entries?'],
    uk: ['Видалити {count} запис?', 'Видалити {count} записи?', 'Видалити {count} записів?'],
    ru: ['Удалить {count} запись?', 'Удалить {count} записи?', 'Удалить {count} записей?'],
  },
  'entries.delete.count': {
    en: 'Delete {count}',
    uk: 'Видалити {count}',
    ru: 'Удалить {count}',
  },
  'entries.delete.bodyOne': {
    en: 'It leaves {name} immediately. The revision history keeps what it held, so a restore is still possible.',
    uk: 'Запис одразу зникне з «{name}». Історія ревізій зберігає те, що в ньому було, тож відновити його ще можна.',
    ru: 'Запись сразу исчезнет из «{name}». История ревизий хранит то, что в ней было, так что восстановить её ещё можно.',
  },
  'entries.delete.bodyMany': {
    en: 'They leave {name} immediately. The revision history keeps what they held, so a restore is still possible.',
    uk: 'Записи одразу зникнуть з «{name}». Історія ревізій зберігає те, що в них було, тож відновити їх ще можна.',
    ru: 'Записи сразу исчезнут из «{name}». История ревизий хранит то, что в них было, так что восстановить их ещё можно.',
  },
  // --- one entry, in a form -------------------------------------------------------
  'entry.notFound': { en: 'Not found', uk: 'Не знайдено', ru: 'Не найдено' },
  'entry.noResource': {
    en: 'No resource called “{name}”.',
    uk: 'Немає ресурсу з назвою «{name}».',
    ru: 'Нет ресурса с названием «{name}».',
  },
  'entry.noSuchId': {
    en: 'Nothing in {name} has that id.',
    uk: 'У «{name}» немає запису з таким id.',
    ru: 'В «{name}» нет записи с таким id.',
  },
  'entry.new': { en: 'New {name}', uk: 'Новий запис', ru: 'Новая запись' },
  'entry.edit': { en: 'Edit {name}', uk: 'Редагування запису', ru: 'Редактирование записи' },
  'entry.moreActions': { en: 'More actions', uk: 'Більше дій', ru: 'Ещё действия' },
  'entry.deleteThis': { en: 'Delete {name}', uk: 'Видалити запис', ru: 'Удалить запись' },
  'entry.deleteTitle': {
    en: 'Delete this {name}?',
    uk: 'Видалити цей запис?',
    ru: 'Удалить эту запись?',
  },
  'entry.mainContent': { en: 'Main content', uk: 'Основний вміст', ru: 'Основное содержимое' },
  'entry.allMetadata': {
    en: 'Every field this resource declares is metadata, so they are all in the panel.',
    uk: 'Усі поля, які оголошує цей ресурс, — це метадані, тож вони всі в боковій панелі.',
    ru: 'Все поля, которые объявляет этот ресурс, — это метаданные, поэтому они все в боковой панели.',
  },
  'entry.savedAt': { en: 'Saved {when}', uk: 'Збережено {when}', ru: 'Сохранено {when}' },
  'entry.unsaved': {
    en: 'Unsaved changes',
    uk: 'Незбережені зміни',
    ru: 'Несохранённые изменения',
  },
  'entry.nothingYet': {
    en: 'Nothing filled in yet',
    uk: 'Ще нічого не заповнено',
    ru: 'Ещё ничего не заполнено',
  },
  'entry.noChanges': {
    en: 'No unsaved changes',
    uk: 'Немає незбережених змін',
    ru: 'Нет несохранённых изменений',
  },
  'entry.discard': { en: 'Discard', uk: 'Відхилити', ru: 'Отменить правки' },
  'entry.saveChanges': { en: 'Save changes', uk: 'Зберегти зміни', ru: 'Сохранить изменения' },

  // --- which fields differ, said as a sentence -------------------------------------
  //
  // The list joiner, and the two agreements around it. `differs` and `differ` are two
  // sentences in English and two in both Slavic languages, and neither is a count: the
  // subject is the list of names, so one name takes one verb and any number of names
  // takes the other.
  'entry.and': { en: 'and', uk: 'і', ru: 'и' },
  'entry.differ.oneSaved': {
    en: '{name} differs from the saved entry.',
    uk: '{name} відрізняється від збереженого запису.',
    ru: '{name} отличается от сохранённой записи.',
  },
  'entry.differ.manySaved': {
    en: '{names} differ from the saved entry.',
    uk: '{names} відрізняються від збереженого запису.',
    ru: '{names} отличаются от сохранённой записи.',
  },
  'entry.differ.countSaved': {
    en: [
      '{count} field differs from the saved entry.',
      '{count} fields differ from the saved entry.',
      '{count} fields differ from the saved entry.',
    ],
    uk: [
      '{count} поле відрізняється від збереженого запису.',
      '{count} поля відрізняються від збереженого запису.',
      '{count} полів відрізняються від збереженого запису.',
    ],
    ru: [
      '{count} поле отличается от сохранённой записи.',
      '{count} поля отличаются от сохранённой записи.',
      '{count} полей отличаются от сохранённой записи.',
    ],
  },
  'entry.differ.oneEmpty': {
    en: '{name} differs from the empty entry.',
    uk: 'Заповнено: {name}.',
    ru: 'Заполнено: {name}.',
  },
  'entry.differ.manyEmpty': {
    en: '{names} differ from the empty entry.',
    uk: 'Заповнено: {names}.',
    ru: 'Заполнено: {names}.',
  },
  'entry.differ.countEmpty': {
    en: [
      '{count} field differs from the empty entry.',
      '{count} fields differ from the empty entry.',
      '{count} fields differ from the empty entry.',
    ],
    uk: ['Заповнено {count} поле.', 'Заповнено {count} поля.', 'Заповнено {count} полів.'],
    ru: ['Заполнено {count} поле.', 'Заполнено {count} поля.', 'Заполнено {count} полей.'],
  },
  // --- which languages an entry is written in (SPEC.md §131) ----------------------
  //
  // `{locale}` here is a language *code* rather than a name — `uk`, `de` — because the
  // set is the deployment's and Studio has no list of what a language is called. It is
  // therefore always shown as a code, in every one of these.
  'translations.languages': { en: 'Languages', uk: 'Мови', ru: 'Языки' },
  'translations.translateInto': {
    en: 'Translate into {locale}',
    uk: 'Перекласти на {locale}',
    ru: 'Перевести на {locale}',
  },
  'translations.translating': {
    en: 'Translating into {locale}…',
    uk: 'Перекладаємо на {locale}…',
    ru: 'Переводим на {locale}…',
  },
  'translations.stale': { en: 'out of date', uk: 'застаріло', ru: 'устарело' },
  'translations.isOriginal': {
    en: 'This is the {origin} original, not a {locale} translation.',
    uk: 'Це оригінал мовою {origin}, а не переклад на {locale}.',
    ru: 'Это оригинал на языке {origin}, а не перевод на {locale}.',
  },
  'translations.fallbackWarning': {
    en: 'Editing here changes what every language falls back to. To write it in {locale}, translate it — the translation starts as a copy of this.',
    uk: 'Редагування тут змінює те, на що спирається кожна мова. Щоб написати це мовою {locale}, зробіть переклад — він починається як копія цього.',
    ru: 'Редактирование здесь меняет то, на что опирается каждый язык. Чтобы написать это на языке {locale}, сделайте перевод — он начинается как копия этого.',
  },
  'translations.written': {
    en: [
      '{written} of {count} language written',
      '{written} of {count} languages written',
      '{written} of {count} languages written',
    ],
    uk: [
      'Написано {written} з {count} мови',
      'Написано {written} з {count} мов',
      'Написано {written} з {count} мов',
    ],
    ru: [
      'Написано {written} из {count} языка',
      'Написано {written} из {count} языков',
      'Написано {written} из {count} языков',
    ],
  },
  // --- the controls one field kind at a time ---------------------------------------
  'fields.nothingChosen': {
    en: 'Nothing chosen',
    uk: 'Нічого не вибрано',
    ru: 'Ничего не выбрано',
  },
  'fields.choose': { en: 'Choose…', uk: 'Обрати…', ru: 'Выбрать…' },
  'fields.replace': { en: 'Replace', uk: 'Замінити', ru: 'Заменить' },
  'fields.brokenJson': {
    en: 'Not valid JSON yet',
    uk: 'Поки що не коректний JSON',
    ru: 'Пока не корректный JSON',
  },
  'fields.noOptions': {
    en: 'This field declares no options.',
    uk: 'Це поле не оголошує жодного варіанта.',
    ru: 'Это поле не объявляет ни одного варианта.',
  },
  'fields.pickColour': { en: 'Pick a colour', uk: 'Обрати колір', ru: 'Выбрать цвет' },
  'fields.language': { en: 'Language', uk: 'Мова', ru: 'Язык' },
  'fields.chooseLanguage': {
    en: 'Choose a language…',
    uk: 'Оберіть мову…',
    ru: 'Выберите язык…',
  },
  'fields.neverRun': {
    en: 'Stored as written; never run',
    uk: 'Зберігається як написано; ніколи не виконується',
    ru: 'Хранится как написано; никогда не выполняется',
  },
  'fields.theId': {
    en: 'The id it points at',
    uk: 'Ідентифікатор, на який вказує',
    ru: 'Идентификатор, на который указывает',
  },
  'fields.cannotList': {
    en: '{name} cannot be listed for you, so the id has to be written out.',
    uk: '«{name}» не можна показати вам списком, тож ідентифікатор доведеться вписати вручну.',
    ru: '«{name}» нельзя показать вам списком, поэтому идентификатор придётся вписать вручную.',
  },
  'fields.cannotListHere': {
    en: '{name} cannot be listed here, so the id has to be written out.',
    uk: '«{name}» не можна показати тут списком, тож ідентифікатор доведеться вписати вручну.',
    ru: '«{name}» нельзя показать здесь списком, поэтому идентификатор придётся вписать вручную.',
  },
  'fields.noTarget': {
    en: 'This field names no target resource, so there is nothing to list.',
    uk: 'Це поле не називає цільового ресурсу, тож немає чого показувати.',
    ru: 'Это поле не называет целевой ресурс, поэтому нечего показывать.',
  },
  'fields.searchIn': { en: 'Search {name}…', uk: 'Пошук у «{name}»…', ru: 'Поиск в «{name}»…' },
  'fields.whichEntry': { en: 'Which entry', uk: 'Який запис', ru: 'Какая запись' },
  'fields.chooseEntry': { en: 'Choose an entry…', uk: 'Оберіть запис…', ru: 'Выберите запись…' },
  'fields.loading': { en: 'Loading…', uk: 'Завантаження…', ru: 'Загрузка…' },
  'fields.whichResource': { en: 'Which resource', uk: 'Який ресурс', ru: 'Какой ресурс' },
  'fields.chooseResource': {
    en: 'Choose a resource…',
    uk: 'Оберіть ресурс…',
    ru: 'Выберите ресурс…',
  },

  // --- a link, which is a web address or something in this application --------------
  'fields.linkPointsAt': {
    en: 'What this link points at',
    uk: 'На що вказує це посилання',
    ru: 'На что указывает эта ссылка',
  },
  'fields.aWebAddress': { en: 'A web address', uk: 'Веб-адреса', ru: 'Веб-адрес' },
  'fields.somethingHere': {
    en: 'Something in this application',
    uk: 'Щось у цьому застосунку',
    ru: 'Что-то в этом приложении',
  },
  'fields.newTab': {
    en: 'Open in a new tab',
    uk: 'Відкривати в новій вкладці',
    ru: 'Открывать в новой вкладке',
  },
  'fields.linkLabel': {
    en: 'What the link says, if not the page’s own title',
    uk: 'Що написано на посиланні, якщо не власний заголовок сторінки',
    ru: 'Что написано на ссылке, если не собственный заголовок страницы',
  },

  // --- a table, whose headings are part of its value ---------------------------------
  'fields.heading': { en: 'Heading', uk: 'Заголовок', ru: 'Заголовок' },
  'fields.columnHeading': {
    en: 'Heading of column {number}',
    uk: 'Заголовок стовпця {number}',
    ru: 'Заголовок столбца {number}',
  },
  'fields.removeColumn': {
    en: 'Remove column {number}',
    uk: 'Вилучити стовпець {number}',
    ru: 'Удалить столбец {number}',
  },
  'fields.removeThisColumn': {
    en: 'Remove this column',
    uk: 'Вилучити цей стовпець',
    ru: 'Удалить этот столбец',
  },
  'fields.addColumn': { en: 'Add a column', uk: 'Додати стовпець', ru: 'Добавить столбец' },
  'fields.plusColumn': { en: '+ column', uk: '+ стовпець', ru: '+ столбец' },
  'fields.cell': {
    en: 'Row {row}, column {column}',
    uk: 'Рядок {row}, стовпець {column}',
    ru: 'Строка {row}, столбец {column}',
  },
  'fields.removeRow': {
    en: 'Remove row {number}',
    uk: 'Вилучити рядок {number}',
    ru: 'Удалить строку {number}',
  },
  'fields.removeThisRow': {
    en: 'Remove this row',
    uk: 'Вилучити цей рядок',
    ru: 'Удалить эту строку',
  },
  'fields.addRow': { en: 'Add a row', uk: 'Додати рядок', ru: 'Добавить строку' },
  'fields.columnFirst': {
    en: 'Add a column first',
    uk: 'Спершу додайте стовпець',
    ru: 'Сначала добавьте столбец',
  },
  'fields.startsWithColumn': {
    en: 'A table starts with a column.',
    uk: 'Таблиця починається зі стовпця.',
    ru: 'Таблица начинается со столбца.',
  },

  // --- a repeater ---------------------------------------------------------------------
  'fields.item': { en: 'Item {number}', uk: 'Елемент {number}', ru: 'Элемент {number}' },
  'fields.up': { en: 'Move up', uk: 'Вгору', ru: 'Вверх' },
  'fields.down': { en: 'Move down', uk: 'Вниз', ru: 'Вниз' },
  'fields.moveUp': {
    en: 'Move item {number} up',
    uk: 'Перемістити елемент {number} вгору',
    ru: 'Переместить элемент {number} вверх',
  },
  'fields.moveDown': {
    en: 'Move item {number} down',
    uk: 'Перемістити елемент {number} вниз',
    ru: 'Переместить элемент {number} вниз',
  },
  'fields.removeItem': {
    en: 'Remove item {number}',
    uk: 'Вилучити елемент {number}',
    ru: 'Удалить элемент {number}',
  },
  'fields.removeThisItem': {
    en: 'Remove this item',
    uk: 'Вилучити цей елемент',
    ru: 'Удалить этот элемент',
  },
  'fields.nothingHereYet': {
    en: 'Nothing here yet.',
    uk: 'Тут поки нічого немає.',
    ru: 'Здесь пока ничего нет.',
  },
  'fields.addItem': { en: 'Add an item', uk: 'Додати елемент', ru: 'Добавить элемент' },
  'fields.readOnly': {
    en: 'Set by the application, not by hand',
    uk: 'Встановлюється застосунком, не вручну',
    ru: 'Устанавливается приложением, не вручную',
  },
  'fields.madeFrom': {
    en: 'Left empty, this is made from {source}',
    uk: 'Якщо лишити порожнім, буде зроблено з «{source}»',
    ru: 'Если оставить пустым, будет сделано из «{source}»',
  },
} as const satisfies Catalogue
