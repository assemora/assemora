/**
 * Pages, the block builder and a page's history.
 */
import type { Catalogue } from '../catalogue.ts'

export const PAGES = {
  // --- pages, before there are any ---------------------------------------------
  'pages.new': { en: 'New page', uk: 'Нова сторінка', ru: 'Новая страница' },
  'pages.blank.noMatch': {
    en: 'No page matches that',
    uk: 'Жодна сторінка не підходить',
    ru: 'Ни одна страница не подходит',
  },
  'pages.blank.tryAnother': {
    en: 'Try another word, or set the status back to any.',
    uk: 'Спробуйте інше слово або поверніть стан на «будь-який».',
    ru: 'Попробуйте другое слово или верните статус на «любой».',
  },
  'pages.blank.first': {
    en: 'Make your first page',
    uk: 'Створіть першу сторінку',
    ru: 'Создайте первую страницу',
  },
  'pages.blank.what': {
    en: 'A page is a tree of blocks at an address — {about}, {pricing} — never a document of HTML.',
    uk: 'Сторінка — це дерево блоків за адресою: {about}, {pricing}. І ніколи не документ HTML.',
    ru: 'Страница — это дерево блоков по адресу: {about}, {pricing}. И никогда не документ HTML.',
  },
  'pages.blank.then': {
    en: 'You put blocks on it in the builder, and publishing decides what a visitor sees. Until then it is a draft only you can open.',
    uk: 'Блоки на неї ви складаєте в конструкторі, а публікація вирішує, що побачить відвідувач. До того це чернетка, яку відкриваєте тільки ви.',
    ru: 'Блоки на неё вы складываете в конструкторе, а публикация решает, что увидит посетитель. До этого это черновик, который открываете только вы.',
  },

  // --- the block palette, which Studio may not fill ------------------------------
  'blocks.blank.title': { en: 'No blocks yet', uk: 'Блоків ще немає', ru: 'Блоков пока нет' },
  'blocks.blank.declared': {
    en: 'A block is a TypeScript declaration, so it is written in your project, not here.',
    uk: 'Блок — це оголошення TypeScript, тож він пишеться у вашому проєкті, а не тут.',
    ru: 'Блок — это объявление TypeScript, поэтому он пишется в вашем проекте, а не здесь.',
  },
  'blocks.blank.register': {
    en: 'That writes {file}. Register it with {call}, give it a view in your frontend, and it appears in this list.',
    uk: 'Ця команда пише {file}. Зареєструйте блок через {call}, дайте йому вигляд у своєму фронтенді — і він з’явиться в цьому списку.',
    ru: 'Эта команда пишет {file}. Зарегистрируйте блок через {call}, дайте ему вид в своём фронтенде — и он появится в этом списке.',
  },
  // --- the page list ---------------------------------------------------------------
  'pages.create': { en: 'Create page', uk: 'Створити сторінку', ru: 'Создать страницу' },
  'pages.createFailed': {
    en: 'Could not create it',
    uk: 'Не вдалося створити',
    ru: 'Не удалось создать',
  },
  'pages.title': { en: 'Title', uk: 'Заголовок', ru: 'Заголовок' },
  'pages.slug': { en: 'Slug', uk: 'Адреса', ru: 'Адрес' },
  'pages.slugHelp': {
    en: 'Where the page lives on the site',
    uk: 'За якою адресою сторінка живе на сайті',
    ru: 'По какому адресу страница живёт на сайте',
  },
  'pages.search': { en: 'Search pages', uk: 'Пошук сторінок', ru: 'Поиск страниц' },
  'pages.statusLabel': { en: 'Status', uk: 'Стан', ru: 'Состояние' },
  'pages.anyStatus': { en: 'Any status', uk: 'Будь-який стан', ru: 'Любое состояние' },
  'pages.status.draft': { en: 'Draft', uk: 'Чернетка', ru: 'Черновик' },
  'pages.status.published': { en: 'Published', uk: 'Опубліковано', ru: 'Опубликовано' },
  'pages.status.archived': { en: 'Archived', uk: 'В архіві', ru: 'В архиве' },
  'pages.version': { en: 'Version', uk: 'Версія', ru: 'Версия' },
  'pages.updated': { en: 'Updated', uk: 'Оновлено', ru: 'Обновлено' },
  'pages.openBuilder': {
    en: 'Open builder',
    uk: 'Відкрити конструктор',
    ru: 'Открыть конструктор',
  },
  'pages.pageCount': {
    en: ['{count} page', '{count} pages', '{count} pages'],
    uk: ['{count} сторінка', '{count} сторінки', '{count} сторінок'],
    ru: ['{count} страница', '{count} страницы', '{count} страниц'],
  },
  // --- revision history --------------------------------------------------------------
  //
  // A block's `{type}` is the name its TypeScript declaration was given — `hero`, and
  // never a word Studio knows. It is quoted rather than declined, for the reason the
  // entry blanks are.
  'history.actor.person': { en: 'Person', uk: 'Людина', ru: 'Человек' },
  'history.actor.agent': { en: 'Agent', uk: 'Агент', ru: 'Агент' },
  'history.actor.token': { en: 'API token', uk: 'Токен API', ru: 'Токен API' },
  'history.actor.unknown': { en: 'Unknown', uk: 'Невідомо', ru: 'Неизвестно' },
  'history.kind.undo': { en: 'undo', uk: 'скасування', ru: 'отмена' },
  'history.kind.redo': { en: 'redo', uk: 'повторення', ru: 'повтор' },
  'history.kind.restore': { en: 'restore', uk: 'відновлення', ru: 'восстановление' },
  'history.tree.added': {
    en: 'Added a {type}',
    uk: 'Додано блок «{type}»',
    ru: 'Добавлен блок «{type}»',
  },
  'history.tree.removed': {
    en: 'Removed a {type}',
    uk: 'Вилучено блок «{type}»',
    ru: 'Удалён блок «{type}»',
  },
  'history.tree.moved': {
    en: 'Moved the {type}',
    uk: 'Переміщено блок «{type}»',
    ru: 'Перемещён блок «{type}»',
  },
  'history.tree.changed': {
    en: 'Changed the {type}: {fields}',
    uk: 'Змінено блок «{type}»: {fields}',
    ru: 'Изменён блок «{type}»: {fields}',
  },
  'history.tree.hidden': {
    en: 'Hid or showed the {type}',
    uk: 'Приховано або показано блок «{type}»',
    ru: 'Скрыт или показан блок «{type}»',
  },
  'history.tree.restyled': {
    en: 'Restyled the {type}',
    uk: 'Змінено оформлення блоку «{type}»',
    ru: 'Изменено оформление блока «{type}»',
  },
  'history.backToBuilder': {
    en: 'Back to builder',
    uk: 'Назад до конструктора',
    ru: 'Назад в конструктор',
  },
  'history.comparing': {
    en: 'Comparing two revisions',
    uk: 'Порівняння двох ревізій',
    ru: 'Сравнение двух ревизий',
  },
  'history.noDifference': {
    en: 'Nothing differs between them.',
    uk: 'Між ними немає відмінностей.',
    ru: 'Между ними нет отличий.',
  },
  'history.nothingYet': {
    en: 'Nothing has happened yet',
    uk: 'Ще нічого не сталося',
    ru: 'Ещё ничего не произошло',
  },
  'history.nothingChanged': {
    en: 'Nothing changed.',
    uk: 'Нічого не змінилося.',
    ru: 'Ничего не изменилось.',
  },
  'history.compare': { en: 'Compare', uk: 'Порівняти', ru: 'Сравнить' },
  'history.restore': { en: 'Restore', uk: 'Відновити', ru: 'Восстановить' },
  'history.confirmRestore': {
    en: 'Put the page back the way it was at this revision?',
    uk: 'Повернути сторінку до стану цієї ревізії?',
    ru: 'Вернуть страницу к состоянию этой ревизии?',
  },
  'history.revisionCount': {
    en: ['{count} revision', '{count} revisions', '{count} revisions'],
    uk: ['{count} ревізія', '{count} ревізії', '{count} ревізій'],
    ru: ['{count} ревизия', '{count} ревизии', '{count} ревизий'],
  },
  'history.newer': { en: 'Newer', uk: 'Новіші', ru: 'Новее' },
  'history.older': { en: 'Older', uk: 'Давніші', ru: 'Старее' },
  // --- the rich text strip, which is structure and nothing else ---------------------
  'richText.heading': { en: 'Heading', uk: 'Заголовок', ru: 'Заголовок' },
  'richText.subheading': { en: 'Subheading', uk: 'Підзаголовок', ru: 'Подзаголовок' },
  'richText.bold': { en: 'Bold', uk: 'Жирний', ru: 'Жирный' },
  'richText.italic': { en: 'Italic', uk: 'Курсив', ru: 'Курсив' },
  'richText.bullets': { en: 'Bulleted list', uk: 'Маркований список', ru: 'Маркированный список' },
  'richText.numbers': { en: 'Numbered list', uk: 'Нумерований список', ru: 'Нумерованный список' },
  'richText.quote': { en: 'Quote', uk: 'Цитата', ru: 'Цитата' },
  'richText.link': { en: 'Link', uk: 'Посилання', ru: 'Ссылка' },
  'richText.unlink': { en: 'Remove link', uk: 'Прибрати посилання', ru: 'Убрать ссылку' },
  'richText.image': { en: 'Image', uk: 'Зображення', ru: 'Изображение' },
  // --- the canvas ---------------------------------------------------------------------
  'canvas.preview': { en: 'Page preview', uk: 'Перегляд сторінки', ru: 'Просмотр страницы' },
  'canvas.addHere': { en: 'Add a block here', uk: 'Додати блок сюди', ru: 'Добавить блок сюда' },
  'canvas.noBlocks': {
    en: 'This application declares no blocks',
    uk: 'Цей застосунок не оголошує жодного блоку',
    ru: 'Это приложение не объявляет ни одного блока',
  },
  'canvas.containerFull': {
    en: 'The {type} block will not take anything more',
    uk: 'Блок «{type}» більше нічого не прийме',
    ru: 'Блок «{type}» больше ничего не примет',
  },
  'canvas.nothingFits': {
    en: 'Nothing can go on this page yet',
    uk: 'На цю сторінку поки нічого не можна покласти',
    ru: 'На эту страницу пока нечего положить',
  },
  'canvas.nothingFitsBody': {
    en: 'This application declares no block types. A block is a TypeScript declaration, so Studio cannot make one — the Blocks panel on the left has the command that can.',
    uk: 'Цей застосунок не оголошує жодного типу блоків. Блок — це оголошення TypeScript, тож Studio не може його створити: команда, яка може, — у панелі «Блоки» ліворуч.',
    ru: 'Это приложение не объявляет ни одного типа блоков. Блок — это объявление TypeScript, поэтому Studio не может его создать: команда, которая может, — в панели «Блоки» слева.',
  },
  'canvas.empty': {
    en: 'This page has nothing on it yet',
    uk: 'На цій сторінці ще нічого немає',
    ru: 'На этой странице ещё ничего нет',
  },
  'canvas.emptyBody': {
    en: 'Every page is a tree of blocks. Put the first one in.',
    uk: 'Кожна сторінка — це дерево блоків. Покладіть перший.',
    ru: 'Каждая страница — это дерево блоков. Положите первый.',
  },
  'builder.viewport.desktop': { en: 'Desktop', uk: 'Комп’ютер', ru: 'Компьютер' },
  'builder.viewport.tablet': { en: 'Tablet', uk: 'Планшет', ru: 'Планшет' },
  'builder.viewport.mobile': { en: 'Mobile', uk: 'Телефон', ru: 'Телефон' },
  // --- the builder's own chrome --------------------------------------------------------
  'builder.cannotOpen': {
    en: 'This page could not be opened',
    uk: 'Не вдалося відкрити цю сторінку',
    ru: 'Не удалось открыть эту страницу',
  },
  'builder.noAnswer': {
    en: 'The application did not answer.',
    uk: 'Застосунок не відповів.',
    ru: 'Приложение не ответило.',
  },
  'builder.backToPages': {
    en: 'Back to Pages',
    uk: 'Назад до сторінок',
    ru: 'Назад к страницам',
  },
  'builder.unpublished': {
    en: 'unpublished changes',
    uk: 'неопубліковані зміни',
    ru: 'неопубликованные изменения',
  },
  // The shortcut is part of the label, and the keys are the same on every keyboard.
  'builder.undo': { en: 'Undo (⌘Z)', uk: 'Скасувати (⌘Z)', ru: 'Отменить (⌘Z)' },
  'builder.redo': { en: 'Redo (⌘⇧Z)', uk: 'Повторити (⌘⇧Z)', ru: 'Повторить (⌘⇧Z)' },
  'builder.preview': { en: 'Preview', uk: 'Перегляд', ru: 'Просмотр' },
  'builder.publish': { en: 'Publish', uk: 'Опублікувати', ru: 'Опубликовать' },
  'builder.conflict': {
    en: 'Someone else has changed this page since you opened it',
    uk: 'Хтось інший змінив цю сторінку, відколи ви її відкрили',
    ru: 'Кто-то другой изменил эту страницу с тех пор, как вы её открыли',
  },
  'builder.conflictBody': {
    en: 'Reloading takes their version. Nothing here has been written over.',
    uk: 'Перезавантаження візьме їхню версію. Тут нічого не перезаписано.',
    ru: 'Перезагрузка возьмёт их версию. Здесь ничего не перезаписано.',
  },
  'builder.reload': { en: 'Reload', uk: 'Перезавантажити', ru: 'Перезагрузить' },
  'builder.notReady': {
    en: 'This page is not ready to be published',
    uk: 'Ця сторінка ще не готова до публікації',
    ru: 'Эта страница ещё не готова к публикации',
  },
  'builder.draftSaved': {
    en: 'Draft saved · not published',
    uk: 'Чернетку збережено · не опубліковано',
    ru: 'Черновик сохранён · не опубликован',
  },
  // The version goes over as a string: it is a label on a build, not a quantity, so a
  // language that groups thousands must not turn v1024 into v1,024.
  'builder.published': {
    en: 'Published · v{version}',
    uk: 'Опубліковано · v{version}',
    ru: 'Опубликовано · v{version}',
  },
  // --- the rail beside the canvas --------------------------------------------------
  'palette.rail': { en: 'Rail', uk: 'Панель', ru: 'Панель' },
  'palette.outline': { en: 'Outline', uk: 'Структура', ru: 'Структура' },
  'palette.blocks': { en: 'Blocks', uk: 'Блоки', ru: 'Блоки' },
  'palette.beside': { en: 'beside', uk: 'поруч', ru: 'рядом' },
  'palette.inside': { en: 'inside', uk: 'усередину', ru: 'внутрь' },
  'palette.emptyPage': {
    en: 'This page is empty',
    uk: 'Ця сторінка порожня',
    ru: 'Эта страница пуста',
  },
  'palette.emptyPageBody': {
    en: 'Open Blocks and choose one, or use a + on the page.',
    uk: 'Відкрийте «Блоки» й оберіть один або скористайтеся + на сторінці.',
    ru: 'Откройте «Блоки» и выберите один или воспользуйтесь + на странице.',
  },
  // --- the inspector -----------------------------------------------------------------
  'properties.inspector': { en: 'Inspector', uk: 'Інспектор', ru: 'Инспектор' },
  'properties.content': { en: 'Content', uk: 'Вміст', ru: 'Содержимое' },
  'properties.design': { en: 'Design', uk: 'Оформлення', ru: 'Оформление' },
  'properties.hidden': { en: 'hidden', uk: 'приховано', ru: 'скрыт' },
  'properties.noFields': {
    en: 'This block has no fields.',
    uk: 'У цього блоку немає полів.',
    ru: 'У этого блока нет полей.',
  },
  'properties.duplicate': {
    en: 'Add a copy beside this block',
    uk: 'Додати копію поруч із цим блоком',
    ru: 'Добавить копию рядом с этим блоком',
  },
  'properties.indent': {
    en: 'Move inside the block above',
    uk: 'Перемістити всередину блоку вище',
    ru: 'Переместить внутрь блока выше',
  },
  'properties.outdent': {
    en: 'Move out of its container',
    uk: 'Винести з контейнера',
    ru: 'Вынести из контейнера',
  },
  'properties.show': { en: 'Show this block', uk: 'Показати цей блок', ru: 'Показать этот блок' },
  'properties.hide': { en: 'Hide this block', uk: 'Приховати цей блок', ru: 'Скрыть этот блок' },
} as const satisfies Catalogue
