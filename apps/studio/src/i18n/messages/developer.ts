/**
 * The developer section, the API explorer, proposals, and the screens a collection is made on.
 */
import type { Catalogue } from '../catalogue.ts'

export const DEVELOPER = {
  // --- collections, before there are any ---------------------------------------
  'collections.new': { en: 'New collection', uk: 'Нова колекція', ru: 'Новая коллекция' },
  'collections.blank.first': {
    en: 'Make your first collection',
    uk: 'Створіть першу колекцію',
    ru: 'Создайте первую коллекцию',
  },
  'collections.blank.none': {
    en: 'No collections yet',
    uk: 'Колекцій ще немає',
    ru: 'Коллекций пока нет',
  },
  'collections.blank.what': {
    en: 'A collection is a kind of content this application holds — Testimonials, Recipes, Team members. You give it a name and say what fields one entry has.',
    uk: 'Колекція — це різновид вмісту, який тримає цей застосунок: відгуки, рецепти, команда. Ви даєте їй назву й описуєте, які поля має один запис.',
    ru: 'Коллекция — это вид содержимого, которое хранит это приложение: отзывы, рецепты, команда. Вы даёте ей название и описываете, какие поля есть у одной записи.',
  },
  'collections.blank.then': {
    en: 'It is then a resource like every other: its own screen in the sidebar, the same policies, revisions and audit as everything else, and a tool an agent can call by name over MCP.',
    uk: 'Далі це ресурс, як і будь-який інший: власний екран у бічній панелі, ті самі політики, ревізії та журнал — і інструмент, який агент може викликати на ім’я через MCP.',
    ru: 'Дальше это ресурс, как и любой другой: свой экран в боковой панели, те же политики, ревизии и журнал — и инструмент, который агент может вызвать по имени через MCP.',
  },
  'collections.blank.forbidden': {
    en: 'Making one needs a permission this account does not have.',
    uk: 'Щоб створити колекцію, потрібен дозвіл, якого в цього облікового запису немає.',
    ru: 'Чтобы создать коллекцию, нужно право, которого у этой учётной записи нет.',
  },

  // --- how the field kinds are grouped in the picker -------------------------------
  'collections.kinds.text': { en: 'Text', uk: 'Текст', ru: 'Текст' },
  'collections.kinds.numbers': {
    en: 'Numbers and switches',
    uk: 'Числа й перемикачі',
    ru: 'Числа и переключатели',
  },
  'collections.kinds.choices': { en: 'Choices', uk: 'Вибір', ru: 'Выбор' },
  'collections.kinds.dates': {
    en: 'Dates and times',
    uk: 'Дати й час',
    ru: 'Даты и время',
  },
  'collections.kinds.links': {
    en: 'Links and files',
    uk: 'Посилання й файли',
    ru: 'Ссылки и файлы',
  },
  'collections.kinds.several': {
    en: 'Several values',
    uk: 'Кілька значень',
    ru: 'Несколько значений',
  },
  'collections.kinds.other': { en: 'Other', uk: 'Інше', ru: 'Другое' },

  // --- what the form refuses before the command would ------------------------------
  //
  // `{kind}` is a machine word — `select`, `relation` — and stays one in every language:
  // it is what the definition holds and what the command's own refusal would name.
  'collections.issue.needsName': {
    en: 'A collection needs a name.',
    uk: 'Колекції потрібна назва.',
    ru: 'Коллекции нужно название.',
  },
  'collections.issue.badName': {
    en: '“{name}” is not a name a collection can have. Start with a lower-case letter, then letters, numbers and underscores.',
    uk: '«{name}» не може бути назвою колекції. Починайте з малої латинської літери, далі літери, цифри й підкреслення.',
    ru: '«{name}» не может быть названием коллекции. Начинайте со строчной латинской буквы, дальше буквы, цифры и подчёркивания.',
  },
  'collections.issue.nameTaken': {
    en: '“{name}” is already a resource in this application. Choose another name.',
    uk: '«{name}» — це вже ресурс у цьому застосунку. Оберіть іншу назву.',
    ru: '«{name}» — это уже ресурс в этом приложении. Выберите другое название.',
  },
  'collections.issue.needsAField': {
    en: 'A collection needs at least one field.',
    uk: 'Колекції потрібне хоча б одне поле.',
    ru: 'Коллекции нужно хотя бы одно поле.',
  },
  'collections.issue.fieldNeedsName': {
    en: 'Every field needs a name.',
    uk: 'Кожному полю потрібна назва.',
    ru: 'Каждому полю нужно имя.',
  },
  'collections.issue.badFieldName': {
    en: '“{name}” is not a name a field can have. Start with a letter, then letters, numbers and underscores.',
    uk: '«{name}» не може бути назвою поля. Починайте з латинської літери, далі літери, цифри й підкреслення.',
    ru: '«{name}» не может быть именем поля. Начинайте с латинской буквы, дальше буквы, цифры и подчёркивания.',
  },
  'collections.issue.duplicateField': {
    en: 'Another field is already called “{name}”.',
    uk: 'Інше поле вже називається «{name}».',
    ru: 'Другое поле уже называется «{name}».',
  },
  'collections.issue.needsOptions': {
    en: 'A {kind} field needs at least one option.',
    uk: 'Полю типу {kind} потрібен хоча б один варіант.',
    ru: 'Полю типа {kind} нужен хотя бы один вариант.',
  },
  'collections.issue.needsSource': {
    en: 'A slug field needs a source field.',
    uk: 'Полю slug потрібне поле-джерело.',
    ru: 'Полю slug нужно поле-источник.',
  },
  'collections.issue.needsTarget': {
    en: 'A relation field needs a target resource.',
    uk: 'Полю relation потрібен цільовий ресурс.',
    ru: 'Полю relation нужен целевой ресурс.',
  },
  'collections.issue.needsFields': {
    en: 'A group needs at least one field.',
    uk: 'Групі потрібне хоча б одне поле.',
    ru: 'Группе нужно хотя бы одно поле.',
  },
  'collections.issue.needsElement': {
    en: 'A repeater needs to say what one item is.',
    uk: 'Повторювач має сказати, чим є один елемент.',
    ru: 'Повторитель должен сказать, чем является один элемент.',
  },
  'collections.issue.droppedName': {
    en: 'A field called “{name}” was removed while this collection held entries, and their values are still stored under that name. Choose another name, or empty the collection first.',
    uk: 'Поле «{name}» вилучили, коли в колекції вже були записи, і їхні значення досі зберігаються під цією назвою. Оберіть іншу назву або спершу спорожніть колекцію.',
    ru: 'Поле «{name}» удалили, когда в коллекции уже были записи, и их значения до сих пор хранятся под этим именем. Выберите другое имя или сначала опустошите коллекцию.',
  },
  // --- the collections screen --------------------------------------------------------
  'collections.lede': {
    en: 'A collection is a resource made here rather than written in TypeScript. Both kinds are equal once they exist',
    uk: 'Колекція — це ресурс, зроблений тут, а не написаний у TypeScript. Щойно вони існують, обидва види рівні',
    ru: 'Коллекция — это ресурс, сделанный здесь, а не написанный в TypeScript. Как только они существуют, оба вида равны',
  },
  'collections.madeHere': { en: 'Made here', uk: 'Зроблено тут', ru: 'Сделано здесь' },
  'collections.noneMadeHere': {
    en: 'Nothing has been made here yet',
    uk: 'Тут ще нічого не зроблено',
    ru: 'Здесь ещё ничего не сделано',
  },
  'collections.noneMadeHereBody': {
    en: 'A collection made here is stored as a row rather than a source file, so Studio can change its fields. Everything else about it is the same as the ones below.',
    uk: 'Колекція, зроблена тут, зберігається рядком у базі, а не файлом коду, тож Studio може змінювати її поля. Усе інше в ній таке саме, як у тих, що нижче.',
    ru: 'Коллекция, сделанная здесь, хранится строкой в базе, а не файлом кода, поэтому Studio может менять её поля. Всё остальное в ней такое же, как у тех, что ниже.',
  },
  'collections.column.collection': { en: 'Collection', uk: 'Колекція', ru: 'Коллекция' },
  'collections.column.name': { en: 'Name', uk: 'Назва', ru: 'Название' },
  'collections.column.fields': { en: 'Fields', uk: 'Поля', ru: 'Поля' },
  'collections.column.entriesCan': {
    en: 'Entries can be',
    uk: 'Із записами можна',
    ru: 'С записями можно',
  },
  'collections.entries': { en: 'Entries', uk: 'Записи', ru: 'Записи' },
  'collections.can.created': { en: 'created', uk: 'створювати', ru: 'создавать' },
  'collections.can.read': { en: 'read', uk: 'читати', ru: 'читать' },
  'collections.can.updated': { en: 'updated', uk: 'змінювати', ru: 'изменять' },
  'collections.can.deleted': { en: 'deleted', uk: 'видаляти', ru: 'удалять' },
  'collections.declared': {
    en: 'Declared in this application’s source',
    uk: 'Оголошено в коді цього застосунку',
    ru: 'Объявлено в коде этого приложения',
  },
  'collections.declaredNote': {
    en: 'Their fields are a TypeScript declaration, which is what produces the record type, the API types and the SDK — so Studio can read them but never rewrite them, and they are changed by editing the application and restarting it. Everything else is the same: the same screens, the same policies, revisions and audit, and the same tools over MCP. A new collection may not take one of these names.',
    uk: 'Їхні поля — це оголошення TypeScript, з якого постають тип запису, типи API і SDK. Тож Studio може їх читати, але ніколи не переписувати: їх змінюють правкою застосунку й перезапуском. Усе інше однакове — ті самі екрани, ті самі політики, ревізії та журнал, ті самі інструменти через MCP. Нова колекція не може взяти жодну з цих назв.',
    ru: 'Их поля — это объявление TypeScript, из которого возникают тип записи, типы API и SDK. Поэтому Studio может их читать, но никогда не переписывать: их меняют правкой приложения и перезапуском. Всё остальное одинаково — те же экраны, те же политики, ревизии и журнал, те же инструменты через MCP. Новая коллекция не может взять ни одно из этих названий.',
  },
  // --- the collection editor -----------------------------------------------------------
  'editor.lede': {
    en: 'A resource stored in the database rather than written in TypeScript',
    uk: 'Ресурс, що зберігається в базі даних, а не написаний у TypeScript',
    ru: 'Ресурс, который хранится в базе данных, а не написан в TypeScript',
  },
  'editor.label': { en: 'Label', uk: 'Підпис', ru: 'Подпись' },
  'editor.labelHelp': {
    en: 'What this collection is called in the navigation and on its screens',
    uk: 'Як ця колекція називається в навігації та на своїх екранах',
    ru: 'Как эта коллекция называется в навигации и на своих экранах',
  },
  'editor.nameHelp': {
    en: 'Lower case, letters, numbers and underscores. This is what the API and an agent call it',
    uk: 'Малі латинські літери, цифри й підкреслення. Саме так її називають API та агент',
    ru: 'Строчные латинские буквы, цифры и подчёркивания. Именно так её называют API и агент',
  },
  'editor.nameFrozen': {
    en: 'A collection’s name is what its entries, its API and an agent address it by, so it never changes',
    uk: 'За назвою колекції до неї звертаються її записи, її API та агент, тож вона не змінюється',
    ru: 'По названию коллекции к ней обращаются её записи, её API и агент, поэтому оно не меняется',
  },
  'editor.fieldsInOrder': {
    en: [
      '{count} field, in the order they are shown',
      '{count} fields, in the order they are shown',
      '{count} fields, in the order they are shown',
    ],
    uk: [
      '{count} поле, у порядку показу',
      '{count} поля, у порядку показу',
      '{count} полів, у порядку показу',
    ],
    ru: [
      '{count} поле, в порядке показа',
      '{count} поля, в порядке показа',
      '{count} полей, в порядке показа',
    ],
  },
  'editor.addField': { en: 'Add a field', uk: 'Додати поле', ru: 'Добавить поле' },
  'editor.whatThisSends': {
    en: 'What this sends',
    uk: 'Що це надсилає',
    ru: 'Что это отправляет',
  },
  'editor.createCollection': {
    en: 'Create collection',
    uk: 'Створити колекцію',
    ru: 'Создать коллекцию',
  },
  'editor.somethingMissing': {
    en: 'Something is missing',
    uk: 'Чогось бракує',
    ru: 'Чего-то не хватает',
  },
  // Not "in table {name}", which the handoff's own prototype says: a collection's entries
  // share `assemora_resource_entries` with every other collection's — there is no table
  // per collection to name, and a footer that names one is teaching the wrong shape.
  'editor.ready': {
    en: [
      'Ready — {count} field in {name}',
      'Ready — {count} fields in {name}',
      'Ready — {count} fields in {name}',
    ],
    uk: [
      'Готово — {count} поле в «{name}»',
      'Готово — {count} поля в «{name}»',
      'Готово — {count} полів у «{name}»',
    ],
    ru: [
      'Готово — {count} поле в «{name}»',
      'Готово — {count} поля в «{name}»',
      'Готово — {count} полей в «{name}»',
    ],
  },
  'editor.nothingToRefuse': {
    en: 'No unsaved changes to refuse',
    uk: 'Немає незбережених змін, які можна відхилити',
    ru: 'Нет несохранённых изменений, которые можно отклонить',
  },
  'editor.saved': { en: 'Saved.', uk: 'Збережено.', ru: 'Сохранено.' },
  'editor.backToCollections': {
    en: 'Back to collections',
    uk: 'Назад до колекцій',
    ru: 'Назад к коллекциям',
  },
  'editor.created': {
    en: 'Collection “{name}” was created',
    uk: 'Колекцію «{name}» створено',
    ru: 'Коллекция «{name}» создана',
  },
  'editor.addFirstEntry': {
    en: 'Add the first entry',
    uk: 'Додати перший запис',
    ru: 'Добавить первую запись',
  },
  'editor.keepEditing': {
    en: 'Keep editing the fields',
    uk: 'Далі редагувати поля',
    ru: 'Продолжить править поля',
  },
  'editor.gone': { en: '“{name}” is gone', uk: '«{name}» більше немає', ru: '«{name}» больше нет' },

  // --- deleting one, which entries can forbid ---------------------------------------------
  'editor.deleteCollection': {
    en: 'Delete collection',
    uk: 'Видалити колекцію',
    ru: 'Удалить коллекцию',
  },
  'editor.deleteNamed': {
    en: 'Delete “{name}”?',
    uk: 'Видалити «{name}»?',
    ru: 'Удалить «{name}»?',
  },
  'editor.holdsEntries': {
    en: [
      '“{name}” holds {count} entry, and its definition is what makes them readable.',
      '“{name}” holds {count} entries, and its definition is what makes them readable.',
      '“{name}” holds {count} entries, and its definition is what makes them readable.',
    ],
    uk: [
      'У «{name}» {count} запис, і саме її означення робить його читабельним.',
      'У «{name}» {count} записи, і саме її означення робить їх читабельними.',
      'У «{name}» {count} записів, і саме її означення робить їх читабельними.',
    ],
    ru: [
      'В «{name}» {count} запись, и именно её определение делает её читаемой.',
      'В «{name}» {count} записи, и именно её определение делает их читаемыми.',
      'В «{name}» {count} записей, и именно её определение делает их читаемыми.',
    ],
  },
  'editor.deleteThemFirst': {
    en: 'Delete them first — a definition removed while entries exist would leave every one of them unreadable, so this is refused.',
    uk: 'Спершу видаліть їх: означення, вилучене за наявних записів, зробило б кожен із них нечитабельним, тож це заборонено.',
    ru: 'Сначала удалите их: определение, удалённое при существующих записях, сделало бы каждую из них нечитаемой, поэтому это запрещено.',
  },
  'editor.deleteConsequence': {
    en: 'Its definition is removed, Studio stops offering it, and an agent can no longer address it. Any entry already in the bin can no longer be restored.',
    uk: 'Її означення буде вилучено, Studio перестане її показувати, а агент більше не зможе до неї звертатися. Записи, які вже в кошику, відновити буде неможливо.',
    ru: 'Её определение будет удалено, Studio перестанет её показывать, а агент больше не сможет к ней обращаться. Записи, которые уже в корзине, восстановить будет нельзя.',
  },
  'editor.openEntries': { en: 'Open the entries', uk: 'Відкрити записи', ru: 'Открыть записи' },
  'editor.deleteIt': { en: 'Delete it', uk: 'Видалити', ru: 'Удалить' },
  'editor.deleting': { en: 'Deleting…', uk: 'Видаляємо…', ru: 'Удаляем…' },

  // --- what a save will do that cannot be undone -------------------------------------------
  'editor.savingWill': { en: 'Saving this will', uk: 'Це збереження', ru: 'Это сохранение' },
  'editor.dropOneHeld': {
    en: 'Remove {names}. Its values stay in every entry under that name, unreadable, and a later field of that name is refused while this collection holds entries.',
    uk: 'Вилучить {names}. Значення лишаться в кожному записі під цією назвою, нечитані, а нове поле з такою назвою буде відхилено, доки в колекції є записи.',
    ru: 'Удалит {names}. Значения останутся в каждой записи под этим именем, нечитаемыми, а новое поле с таким именем будет отклонено, пока в коллекции есть записи.',
  },
  'editor.dropManyHeld': {
    en: 'Remove {names}. Their values stay in every entry under those names, unreadable, and a later field of any of those names is refused while this collection holds entries.',
    uk: 'Вилучить {names}. Значення лишаться в кожному записі під цими назвами, нечитані, а нове поле з будь-якою з них буде відхилено, доки в колекції є записи.',
    ru: 'Удалит {names}. Значения останутся в каждой записи под этими именами, нечитаемыми, а новое поле с любым из них будет отклонено, пока в коллекции есть записи.',
  },
  'editor.dropOneEmpty': {
    en: 'Remove {names}. Nothing is stored under that name yet.',
    uk: 'Вилучить {names}. Під цією назвою ще нічого не збережено.',
    ru: 'Удалит {names}. Под этим именем ещё ничего не сохранено.',
  },
  'editor.dropManyEmpty': {
    en: 'Remove {names}. Nothing is stored under those names yet.',
    uk: 'Вилучить {names}. Під цими назвами ще нічого не збережено.',
    ru: 'Удалит {names}. Под этими именами ещё ничего не сохранено.',
  },
  'editor.leaveEntries': {
    en: [
      'Leave the {count} entry as it is. What a stored value is — a field’s kind, its options, its slug source, its relation target — is fixed while entries exist; what it is called, shown and searched as is not.',
      'Leave the {count} entries as they are. What a stored value is — a field’s kind, its options, its slug source, its relation target — is fixed while entries exist; what it is called, shown and searched as is not.',
      'Leave the {count} entries as they are. What a stored value is — a field’s kind, its options, its slug source, its relation target — is fixed while entries exist; what it is called, shown and searched as is not.',
    ],
    uk: [
      'Залишить {count} запис як є. Те, чим збережене значення є — вид поля, його варіанти, джерело slug, ціль зв’язку — зафіксовано, доки існують записи; те, як воно зветься, показується й шукається, — ні.',
      'Залишить {count} записи як є. Те, чим збережене значення є — вид поля, його варіанти, джерело slug, ціль зв’язку — зафіксовано, доки існують записи; те, як воно зветься, показується й шукається, — ні.',
      'Залишить {count} записів як є. Те, чим збережене значення є — вид поля, його варіанти, джерело slug, ціль зв’язку — зафіксовано, доки існують записи; те, як воно зветься, показується й шукається, — ні.',
    ],
    ru: [
      'Оставит {count} запись как есть. То, чем сохранённое значение является — вид поля, его варианты, источник slug, цель связи — зафиксировано, пока существуют записи; то, как оно называется, показывается и ищется, — нет.',
      'Оставит {count} записи как есть. То, чем сохранённое значение является — вид поля, его варианты, источник slug, цель связи — зафиксировано, пока существуют записи; то, как оно называется, показывается и ищется, — нет.',
      'Оставит {count} записей как есть. То, чем сохранённое значение является — вид поля, его варианты, источник slug, цель связи — зафиксировано, пока существуют записи; то, как оно называется, показывается и ищется, — нет.',
    ],
  },
  'editor.addFields': {
    en: [
      'Add {names}, which the {count} entry holds no value for yet.',
      'Add {names}, which the {count} entries hold no value for yet.',
      'Add {names}, which the {count} entries hold no value for yet.',
    ],
    uk: [
      'Додасть {names}, для яких {count} запис ще не має значення.',
      'Додасть {names}, для яких {count} записи ще не мають значення.',
      'Додасть {names}, для яких {count} записів ще не мають значення.',
    ],
    ru: [
      'Добавит {names}, для которых {count} запись ещё не имеет значения.',
      'Добавит {names}, для которых {count} записи ещё не имеют значения.',
      'Добавит {names}, для которых {count} записей ещё не имеют значения.',
    ],
  },
  // --- one row of a definition ------------------------------------------------------
  'row.nothingYet': { en: 'Nothing yet', uk: 'Поки нічого', ru: 'Пока ничего' },
  'row.kept': { en: 'kept', uk: 'лишається', ru: 'остаётся' },
  'row.keptWhy': {
    en: 'An entry may hold this, so it cannot be taken away',
    uk: 'Запис може містити це значення, тож забрати його не можна',
    ru: 'Запись может содержать это значение, поэтому убрать его нельзя',
  },
  'row.removeWord': { en: 'Remove {word}', uk: 'Прибрати «{word}»', ru: 'Убрать «{word}»' },
  'row.add': { en: 'Add', uk: 'Додати', ru: 'Добавить' },
  'row.options': { en: 'Options', uk: 'Варіанти', ru: 'Варианты' },
  'row.optionsOne': {
    en: 'A stored entry holds one of these',
    uk: 'Збережений запис містить один із них',
    ru: 'Сохранённая запись содержит один из них',
  },
  'row.optionsMany': {
    en: 'A stored entry holds any number of these',
    uk: 'Збережений запис містить будь-яку кількість із них',
    ru: 'Сохранённая запись содержит любое количество из них',
  },
  'row.addOption': { en: 'Add an option…', uk: 'Додати варіант…', ru: 'Добавить вариант…' },
  'row.languages': { en: 'Languages', uk: 'Мови', ru: 'Языки' },
  'row.languagesHelp': {
    en: 'Leave this empty to let an entry name any language',
    uk: 'Лишіть порожнім, щоб запис міг назвати будь-яку мову',
    ru: 'Оставьте пустым, чтобы запись могла назвать любой язык',
  },
  'row.accepts': { en: 'Accepts', uk: 'Приймає', ru: 'Принимает' },
  'row.acceptsHelp': {
    en: 'What the picker offers, as image/* or application/pdf. Empty means any file',
    uk: 'Що пропонує вибірник — image/* або application/pdf. Порожнє означає будь-який файл',
    ru: 'Что предлагает выбор файла — image/* или application/pdf. Пустое означает любой файл',
  },
  'row.madeFrom': { en: 'Made from', uk: 'Робиться з', ru: 'Делается из' },
  'row.madeFromHelp': {
    en: 'Left empty on an entry, the slug comes from this',
    uk: 'Якщо в записі лишити порожнім, slug береться звідси',
    ru: 'Если в записи оставить пустым, slug берётся отсюда',
  },
  'row.chooseField': { en: 'Choose a field…', uk: 'Оберіть поле…', ru: 'Выберите поле…' },
  'row.pointsAt': { en: 'Points at', uk: 'Вказує на', ru: 'Указывает на' },
  'row.pointsAtHelp': {
    en: 'An entry holds the id of one of these',
    uk: 'Запис містить ідентифікатор одного з них',
    ru: 'Запись содержит идентификатор одного из них',
  },
  'row.groupFields': {
    en: 'The fields in this group',
    uk: 'Поля цієї групи',
    ru: 'Поля этой группы',
  },
  'row.groupFieldsNamed': {
    en: 'The fields in this group ({name})',
    uk: 'Поля цієї групи ({name})',
    ru: 'Поля этой группы ({name})',
  },
  'row.addToGroup': {
    en: 'Add a field to this group',
    uk: 'Додати поле до цієї групи',
    ru: 'Добавить поле в эту группу',
  },
  'row.eachItemIs': { en: 'Each item is', uk: 'Кожен елемент — це', ru: 'Каждый элемент — это' },
  'row.unnamed': { en: 'unnamed', uk: 'без назви', ru: 'без имени' },
  'row.thisField': { en: 'this field', uk: 'це поле', ru: 'это поле' },
  'row.needsName': { en: 'needs a name', uk: 'потрібна назва', ru: 'нужно имя' },
  'row.needsOptions': { en: 'needs options', uk: 'потрібні варіанти', ru: 'нужны варианты' },
  'row.required': { en: 'required', uk: 'обов’язкове', ru: 'обязательное' },
  'row.searchable': { en: 'searchable', uk: 'шукається', ru: 'ищется' },
  'row.filterable': { en: 'filterable', uk: 'фільтрується', ru: 'фильтруется' },
  'row.moveUp': {
    en: 'Move {name} up',
    uk: 'Перемістити {name} вгору',
    ru: 'Переместить {name} вверх',
  },
  'row.moveDown': {
    en: 'Move {name} down',
    uk: 'Перемістити {name} вниз',
    ru: 'Переместить {name} вниз',
  },
  'row.nameFrozen': {
    en: 'A field’s name is where its values are stored, so it never changes',
    uk: 'Назва поля — це те, під чим зберігаються його значення, тож вона не змінюється',
    ru: 'Имя поля — это то, под чем хранятся его значения, поэтому оно не меняется',
  },
  'row.kind': { en: 'Kind', uk: 'Вид', ru: 'Вид' },
  'row.kindFrozen': {
    en: 'Fixed: entries already hold values of this kind',
    uk: 'Зафіксовано: записи вже містять значення цього виду',
    ru: 'Зафиксировано: записи уже содержат значения этого вида',
  },
  'row.labelHelp': {
    en: 'What an editor sees. Left empty, the name is used',
    uk: 'Що бачить редактор. Якщо порожнє, береться назва',
    ru: 'Что видит редактор. Если пусто, берётся имя',
  },
  'row.removeNamed': { en: 'Remove {name}', uk: 'Вилучити {name}', ru: 'Удалить {name}' },
  'row.removeField': { en: 'Remove this field', uk: 'Вилучити це поле', ru: 'Удалить это поле' },
  'row.cannotRemove': {
    en: 'A field inside a group cannot be removed while the collection holds entries: the next save of an entry would delete the value rather than leave it behind',
    uk: 'Поле всередині групи не можна вилучити, доки в колекції є записи: наступне збереження запису видалило б значення, а не лишило його',
    ru: 'Поле внутри группы нельзя удалить, пока в коллекции есть записи: следующее сохранение записи удалило бы значение, а не оставило его',
  },
  'row.tableColumns': {
    en: 'An entry chooses this table’s columns, so there is nothing to declare here',
    uk: 'Стовпці цієї таблиці обирає запис, тож тут нема чого оголошувати',
    ru: 'Столбцы этой таблицы выбирает запись, поэтому здесь нечего объявлять',
  },
  'row.deepest': {
    en: [
      '{count} level is as deep as a definition goes, so a field here holds one value',
      '{count} levels is as deep as a definition goes, so a field here holds one value',
      '{count} levels is as deep as a definition goes, so a field here holds one value',
    ],
    uk: [
      '{count} рівень — це найглибше, куди сягає означення, тож поле тут містить одне значення',
      '{count} рівні — це найглибше, куди сягає означення, тож поле тут містить одне значення',
      '{count} рівнів — це найглибше, куди сягає означення, тож поле тут містить одне значення',
    ],
    ru: [
      '{count} уровень — это самое глубокое, куда доходит определение, поэтому поле здесь содержит одно значение',
      '{count} уровня — это самое глубокое, куда доходит определение, поэтому поле здесь содержит одно значение',
      '{count} уровней — это самое глубокое, куда доходит определение, поэтому поле здесь содержит одно значение',
    ],
  },
  // --- the developer section ------------------------------------------------------------
  'developer.lede': {
    en: 'What this application declares, straight from the registry',
    uk: 'Що оголошує цей застосунок — прямо з реєстру',
    ru: 'Что объявляет это приложение — прямо из реестра',
  },
  'developer.views': {
    en: 'Developer views',
    uk: 'Розділи для розробника',
    ru: 'Разделы для разработчика',
  },
  'developer.filter': { en: 'Filter by name…', uk: 'Фільтр за назвою…', ru: 'Фильтр по названию…' },
  'developer.tab.api': { en: 'API', uk: 'API', ru: 'API' },
  'developer.tab.logs': { en: 'Logs', uk: 'Журнал', ru: 'Журнал' },
  'developer.tab.resources': { en: 'Resources', uk: 'Ресурси', ru: 'Ресурсы' },
  'developer.tab.blocks': { en: 'Blocks', uk: 'Блоки', ru: 'Блоки' },
  'developer.tab.commands': { en: 'Commands', uk: 'Команди', ru: 'Команды' },
  'developer.tab.queries': { en: 'Queries', uk: 'Запити', ru: 'Запросы' },
  'developer.tab.models': { en: 'Models', uk: 'Моделі', ru: 'Модели' },
  'developer.sortable': { en: 'sortable', uk: 'сортується', ru: 'сортируется' },
  'developer.model': { en: 'model: {name}', uk: 'модель: {name}', ru: 'модель: {name}' },
  'developer.noResources': {
    en: 'No resources declared',
    uk: 'Ресурсів не оголошено',
    ru: 'Ресурсы не объявлены',
  },
  'developer.noBlocks': {
    en: 'No blocks declared',
    uk: 'Блоків не оголошено',
    ru: 'Блоки не объявлены',
  },
  'developer.acceptsChildren': {
    en: 'accepts children',
    uk: 'приймає вкладені',
    ru: 'принимает вложенные',
  },
  'developer.atMost': {
    en: 'at most {count}',
    uk: 'щонайбільше {count}',
    ru: 'не более {count}',
  },

  // --- the audit log (SPEC.md §67) --------------------------------------------------------
  'developer.nothingRecorded': {
    en: 'Nothing recorded yet',
    uk: 'Ще нічого не записано',
    ru: 'Ещё ничего не записано',
  },
  'developer.when': { en: 'When', uk: 'Коли', ru: 'Когда' },
  'developer.action': { en: 'Action', uk: 'Дія', ru: 'Действие' },
  'developer.who': { en: 'Who', uk: 'Хто', ru: 'Кто' },
  'developer.from': { en: 'From', uk: 'Звідки', ru: 'Откуда' },
  'developer.outcome': { en: 'Outcome', uk: 'Наслідок', ru: 'Итог' },
  'developer.read': { en: 'read', uk: 'читання', ru: 'чтение' },
  'developer.system': { en: 'system', uk: 'система', ru: 'система' },
  'developer.outcome.everything': { en: 'everything', uk: 'усе', ru: 'всё' },
  'developer.outcome.succeeded': { en: 'succeeded', uk: 'вдалося', ru: 'удалось' },
  'developer.outcome.failed': { en: 'failed', uk: 'не вдалося', ru: 'не удалось' },
  'developer.outcome.previewed': { en: 'previewed', uk: 'попередній перегляд', ru: 'предпросмотр' },
  // --- the API explorer -------------------------------------------------------------------
  'explorer.filter': {
    en: 'Filter by path or tag…',
    uk: 'Фільтр за шляхом або міткою…',
    ru: 'Фильтр по пути или метке…',
  },
  'explorer.endpoints': {
    en: [
      '{count} endpoint, described by the application itself',
      '{count} endpoints, all of them described by the application itself',
      '{count} endpoints, all of them described by the application itself',
    ],
    uk: [
      '{count} точка доступу, описана самим застосунком',
      '{count} точки доступу, і всі описані самим застосунком',
      '{count} точок доступу, і всі описані самим застосунком',
    ],
    ru: [
      '{count} точка доступа, описанная самим приложением',
      '{count} точки доступа, и все описаны самим приложением',
      '{count} точек доступа, и все описаны самим приложением',
    ],
  },
  'explorer.auth': { en: 'auth', uk: 'потрібен вхід', ru: 'нужен вход' },
  'explorer.params': { en: 'Params', uk: 'Параметри шляху', ru: 'Параметры пути' },
  'explorer.query': { en: 'Query', uk: 'Параметри запиту', ru: 'Параметры запроса' },
  'explorer.body': { en: 'Body', uk: 'Тіло', ru: 'Тело' },
  'explorer.response': { en: 'Response', uk: 'Відповідь', ru: 'Ответ' },
  'explorer.queryString': { en: 'Query string', uk: 'Рядок запиту', ru: 'Строка запроса' },
  'explorer.send': { en: 'Send', uk: 'Надіслати', ru: 'Отправить' },
  'explorer.sending': { en: 'Sending…', uk: 'Надсилаємо…', ru: 'Отправляем…' },
  // A duration in milliseconds. The unit is a symbol and stays one in every language.
  'explorer.duration': { en: '{ms} ms', uk: '{ms} мс', ru: '{ms} мс' },
  // --- what an agent proposed (SPEC.md §75) ------------------------------------------------
  'proposals.lede': {
    en: 'What agents have asked for. Nothing changes until you apply it',
    uk: 'Про що просили агенти. Нічого не змінюється, доки ви не застосуєте',
    ru: 'О чём просили агенты. Ничего не меняется, пока вы не примените',
  },
  'proposals.statuses': {
    en: 'Proposal statuses',
    uk: 'Стани пропозицій',
    ru: 'Состояния предложений',
  },
  'proposals.status.pending': { en: 'Pending', uk: 'Очікує', ru: 'Ожидает' },
  'proposals.status.applied': { en: 'Applied', uk: 'Застосовано', ru: 'Применено' },
  'proposals.status.rejected': { en: 'Rejected', uk: 'Відхилено', ru: 'Отклонено' },
  'proposals.status.expired': { en: 'Expired', uk: 'Протерміновано', ru: 'Просрочено' },
  'proposals.status.conflicted': { en: 'Conflicted', uk: 'Конфлікт', ru: 'Конфликт' },
  'proposals.status.all': { en: 'All', uk: 'Усі', ru: 'Все' },
  'proposals.somebody': { en: 'somebody', uk: 'хтось', ru: 'кто-то' },
  'proposals.proposedBy': {
    en: 'proposed by {who}',
    uk: 'запропонував {who}',
    ru: 'предложил {who}',
  },
  'proposals.changeCount': {
    en: ['{count} change', '{count} changes', '{count} changes'],
    uk: ['{count} зміна', '{count} зміни', '{count} змін'],
    ru: ['{count} изменение', '{count} изменения', '{count} изменений'],
  },
  'proposals.apply': { en: 'Apply', uk: 'Застосувати', ru: 'Применить' },
  'proposals.applying': { en: 'Applying…', uk: 'Застосовуємо…', ru: 'Применяем…' },
  'proposals.reject': { en: 'Reject', uk: 'Відхилити', ru: 'Отклонить' },
  'proposals.conflicted': {
    en: 'Somebody changed one of these since it was proposed, so nothing was applied. Ask for it again against what the page says now.',
    uk: 'Хтось змінив одну з цих речей, відколи це запропонували, тож нічого не застосовано. Попросіть ще раз — уже щодо того, що на сторінці зараз.',
    ru: 'Кто-то изменил одну из этих вещей с тех пор, как это предложили, поэтому ничего не применено. Попросите ещё раз — уже относительно того, что на странице сейчас.',
  },
  'proposals.expired': {
    en: 'This proposal expired before anybody decided.',
    uk: 'Ця пропозиція протермінувалася, перш ніж хтось вирішив.',
    ru: 'Это предложение просрочилось, прежде чем кто-либо решил.',
  },
  'proposals.none': { en: 'Nothing proposed', uk: 'Пропозицій немає', ru: 'Предложений нет' },
  'proposals.noneBody': {
    en: 'An agent connected over MCP proposes changes here, and they wait for you.',
    uk: 'Агент, під’єднаний через MCP, пропонує зміни тут — і вони чекають на вас.',
    ru: 'Агент, подключённый через MCP, предлагает изменения здесь — и они ждут вас.',
  },
  // An example of the kind of word somebody types here, so it is a word rather than a
  // format: `testimonials` beside it is a machine name and stays Latin in every language.
  'editor.labelExample': { en: 'Testimonials', uk: 'Відгуки', ru: 'Отзывы' },
  'row.labelExample': { en: 'Author', uk: 'Автор', ru: 'Автор' },
  // --- what one field kind is, in one line ------------------------------------------------
  //
  // A kind's own name — `richText`, `slug` — is a machine word and is never translated:
  // it is what the definition holds, what the API answers with and what an agent names.
  // These sentences are what make the two dozen of them tellable apart.
  'kind.help.text': {
    en: 'One line, stored as text. Good for names and titles.',
    uk: 'Один рядок, зберігається як текст. Годиться для назв і заголовків.',
    ru: 'Одна строка, хранится как текст. Годится для названий и заголовков.',
  },
  'kind.help.textarea': {
    en: 'Many lines of plain text, no formatting.',
    uk: 'Багато рядків звичайного тексту, без оформлення.',
    ru: 'Много строк обычного текста, без оформления.',
  },
  'kind.help.richText': {
    en: 'Formatted body copy with headings, links and images.',
    uk: 'Оформлений текст із заголовками, посиланнями й зображеннями.',
    ru: 'Оформленный текст с заголовками, ссылками и изображениями.',
  },
  'kind.help.markdown': {
    en: 'Plain text with markdown marks, stored exactly as written.',
    uk: 'Звичайний текст із розміткою markdown, зберігається так, як написано.',
    ru: 'Обычный текст с разметкой markdown, хранится так, как написан.',
  },
  'kind.help.code': {
    en: 'Source in a language you name. Stored as written; never run.',
    uk: 'Код мовою, яку ви назвете. Зберігається як написано; ніколи не виконується.',
    ru: 'Код на языке, который вы назовёте. Хранится как написан; никогда не выполняется.',
  },
  'kind.help.number': {
    en: 'Stored as a number, so it sorts and filters numerically.',
    uk: 'Зберігається як число, тож сортується і фільтрується як число.',
    ru: 'Хранится как число, поэтому сортируется и фильтруется как число.',
  },
  'kind.help.integer': {
    en: 'A whole number — a decimal part is refused.',
    uk: 'Ціле число — дробову частину буде відхилено.',
    ru: 'Целое число — дробную часть отклонит.',
  },
  'kind.help.boolean': {
    en: 'A single switch — on or off.',
    uk: 'Один перемикач — увімкнено чи вимкнено.',
    ru: 'Один переключатель — включено или выключено.',
  },
  'kind.help.date': {
    en: 'A day, with no time and no timezone.',
    uk: 'День, без часу й без часового поясу.',
    ru: 'День, без времени и без часового пояса.',
  },
  'kind.help.datetime': {
    en: 'A moment in time, stored in UTC.',
    uk: 'Момент часу, зберігається в UTC.',
    ru: 'Момент времени, хранится в UTC.',
  },
  'kind.help.time': {
    en: 'A time of day, with no date and no timezone.',
    uk: 'Час доби, без дати й без часового поясу.',
    ru: 'Время суток, без даты и без часового пояса.',
  },
  'kind.help.select': {
    en: 'One value from a list you define.',
    uk: 'Одне значення зі списку, який ви задаєте.',
    ru: 'Одно значение из списка, который вы задаёте.',
  },
  'kind.help.checkboxes': {
    en: 'Any number of values from a list you define.',
    uk: 'Будь-яка кількість значень зі списку, який ви задаєте.',
    ru: 'Любое количество значений из списка, который вы задаёте.',
  },
  'kind.help.color': {
    en: 'A hex colour, typed or picked from a swatch.',
    uk: 'Колір у hex — вписаний або обраний зі зразка.',
    ru: 'Цвет в hex — вписанный или выбранный из образца.',
  },
  'kind.help.json': {
    en: 'Any shape at all, edited as JSON. Nothing checks what is in it.',
    uk: 'Будь-яка форма, редагується як JSON. Ніщо не перевіряє, що всередині.',
    ru: 'Любая форма, редактируется как JSON. Ничто не проверяет, что внутри.',
  },
  'kind.help.slug': {
    en: 'A name for an address, made from another field when left empty.',
    uk: 'Назва для адреси; якщо лишити порожньою, робиться з іншого поля.',
    ru: 'Название для адреса; если оставить пустым, делается из другого поля.',
  },
  'kind.help.url': {
    en: 'A web address, checked as one.',
    uk: 'Веб-адреса, і перевіряється саме як адреса.',
    ru: 'Веб-адрес, и проверяется именно как адрес.',
  },
  'kind.help.link': {
    en: 'A web address, or an entry in this application.',
    uk: 'Веб-адреса або запис у цьому застосунку.',
    ru: 'Веб-адрес или запись в этом приложении.',
  },
  'kind.help.email': {
    en: 'An email address, checked as one.',
    uk: 'Адреса пошти, і перевіряється саме як пошта.',
    ru: 'Адрес почты, и проверяется именно как почта.',
  },
  'kind.help.media': {
    en: 'One item from the media library.',
    uk: 'Один файл із медіабібліотеки.',
    ru: 'Один файл из медиабиблиотеки.',
  },
  'kind.help.relation': {
    en: 'Points at an entry in another collection.',
    uk: 'Вказує на запис в іншій колекції.',
    ru: 'Указывает на запись в другой коллекции.',
  },
  'kind.help.table': {
    en: 'A grid whose columns an editor adds, not you.',
    uk: 'Таблиця, стовпці якої додає редактор, а не ви.',
    ru: 'Таблица, столбцы которой добавляет редактор, а не вы.',
  },
  'kind.help.object': {
    en: 'A group of fields, filled in together.',
    uk: 'Група полів, які заповнюються разом.',
    ru: 'Группа полей, которые заполняются вместе.',
  },
  'kind.help.array': {
    en: 'Any number of one field, added and reordered by an editor.',
    uk: 'Будь-яка кількість одного поля — редактор додає їх і міняє місцями.',
    ru: 'Любое количество одного поля — редактор добавляет их и меняет местами.',
  },

  // --- a shape people ask for often --------------------------------------------------------
  'preset.testimonial': { en: 'Testimonial', uk: 'Відгук', ru: 'Отзыв' },
  'preset.post': { en: 'Blog post', uk: 'Допис у блог', ru: 'Запись в блог' },
  'preset.member': { en: 'Team member', uk: 'Учасник команди', ru: 'Участник команды' },
  // --- the form this definition will be ------------------------------------------------
  //
  // A drawing of the entry form, beside the definition being written. The hints inside
  // its ghost controls are what an editor would see as placeholder text, so they are
  // words rather than formats.
  'sees.title': { en: 'What an editor sees', uk: 'Що бачить редактор', ru: 'Что видит редактор' },
  'sees.entry': { en: '{name} entry', uk: 'Запис «{name}»', ru: 'Запись «{name}»' },
  'sees.untitled': { en: 'Untitled', uk: 'Без назви', ru: 'Без названия' },
  'sees.untitledField': { en: 'Untitled field', uk: 'Поле без назви', ru: 'Поле без имени' },
  'sees.nothingYet': {
    en: 'Fields you add appear here as the editor will meet them.',
    uk: 'Поля, які ви додасте, з’являться тут такими, якими їх зустріне редактор.',
    ru: 'Поля, которые вы добавите, появятся здесь такими, какими их встретит редактор.',
  },
  'sees.offByDefault': {
    en: 'Off by default',
    uk: 'Типово вимкнено',
    ru: 'По умолчанию выключено',
  },
  'sees.dropAnImage': {
    en: 'Drop an image',
    uk: 'Перетягніть зображення',
    ru: 'Перетащите изображение',
  },
  'sees.needsAnOption': {
    en: 'Needs at least one option',
    uk: 'Потрібен хоча б один варіант',
    ru: 'Нужен хотя бы один вариант',
  },
  'sees.aTable': {
    en: 'A grid the editor gives its own columns',
    uk: 'Таблиця, стовпці якій дає сам редактор',
    ru: 'Таблица, столбцы которой задаёт сам редактор',
  },
  'sees.aGroup': {
    en: [
      '{count} field, filled in together',
      '{count} fields, filled in together',
      '{count} fields, filled in together',
    ],
    uk: [
      '{count} поле, заповнюється разом',
      '{count} поля, заповнюються разом',
      '{count} полів, заповнюються разом',
    ],
    ru: [
      '{count} поле, заполняется вместе',
      '{count} поля, заполняются вместе',
      '{count} полей, заполняются вместе',
    ],
  },
  'sees.aRepeater': {
    en: 'Any number of these, added by the editor',
    uk: 'Будь-яка кількість таких — редактор додає їх сам',
    ru: 'Любое количество таких — редактор добавляет их сам',
  },
  'sees.hint.line': { en: 'One line', uk: 'Один рядок', ru: 'Одна строка' },
  'sees.hint.slug': {
    en: 'made-from-the-title',
    uk: 'made-from-the-title',
    ru: 'made-from-the-title',
  },
  'sees.hint.number': { en: '0', uk: '0', ru: '0' },
  'sees.hint.date': { en: 'Pick a date', uk: 'Оберіть дату', ru: 'Выберите дату' },
  'sees.hint.time': { en: 'Pick a time', uk: 'Оберіть час', ru: 'Выберите время' },
  'sees.hint.entry': { en: 'Find an entry', uk: 'Знайдіть запис', ru: 'Найдите запись' },
  'sees.hint.text': { en: 'Plain text', uk: 'Звичайний текст', ru: 'Обычный текст' },
  'sees.hint.body': { en: 'Formatted body copy', uk: 'Оформлений текст', ru: 'Оформленный текст' },
  'sees.hint.json': { en: '{ }', uk: '{ }', ru: '{ }' },
  'sees.hint.code': {
    en: 'Source, stored as written',
    uk: 'Код, як написано',
    ru: 'Код, как написан',
  },
  // --- the three shapes a collection's name takes ------------------------------------------
  //
  // `api` and `studio` are names rather than words and stay as they are in every
  // language; `agent` is a word. The values beside them are addresses, and are mono.
  'editor.becomes.api': { en: 'api', uk: 'api', ru: 'api' },
  'editor.becomes.studio': { en: 'studio', uk: 'studio', ru: 'studio' },
  'editor.becomes.agent': { en: 'agent', uk: 'агент', ru: 'агент' },

  // --- a definition with no fields in it yet -------------------------------------------------
  'editor.noFieldsYet': { en: 'none yet', uk: 'поки жодного', ru: 'пока ни одного' },
  'editor.noFields': { en: 'No fields yet', uk: 'Полів ще немає', ru: 'Полей пока нет' },
  'editor.noFieldsBody': {
    en: 'Start from a shape we see often, then rename anything.',
    uk: 'Почніть із форми, яка трапляється часто, а тоді перейменуйте будь-що.',
    ru: 'Начните с формы, которая встречается часто, а потом переименуйте что угодно.',
  },
  'editor.presetFields': {
    en: ['{count} field', '{count} fields', '{count} fields'],
    uk: ['{count} поле', '{count} поля', '{count} полів'],
    ru: ['{count} поле', '{count} поля', '{count} полей'],
  },
} as const satisfies Catalogue
