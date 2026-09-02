/**
 * The frame around every screen: the chrome bar, the sidebar, the command palette, the account menu and the sign-in form.
 */
import type { Catalogue } from '../catalogue.ts'

export const CHROME = {
  // --- the first screen of an application with nothing in it ---------------------
  'start.collection.title': {
    en: 'Describe some content',
    uk: 'Опишіть вміст',
    ru: 'Опишите содержимое',
  },
  'start.collection.body': {
    en: 'A collection is a kind of content named and shaped here rather than in TypeScript. Once it exists it is a resource like any other — a screen, the same policies, and a tool an agent can call.',
    uk: 'Колекція — це різновид вмісту, названий і описаний тут, а не в TypeScript. Щойно вона є, це ресурс, як будь-який інший: екран, ті самі політики й інструмент, який може викликати агент.',
    ru: 'Коллекция — это вид содержимого, названный и описанный здесь, а не в TypeScript. Как только она есть, это ресурс, как любой другой: экран, те же политики и инструмент, который может вызвать агент.',
  },
  'start.page.title': { en: 'Build a page', uk: 'Складіть сторінку', ru: 'Соберите страницу' },
  'start.page.body': {
    en: 'A page is a tree of blocks at an address. The builder puts blocks on it; publishing decides what a visitor sees.',
    uk: 'Сторінка — це дерево блоків за адресою. Конструктор складає на неї блоки, а публікація вирішує, що побачить відвідувач.',
    ru: 'Страница — это дерево блоков по адресу. Конструктор складывает на неё блоки, а публикация решает, что увидит посетитель.',
  },
  'start.page.go': { en: 'Go to pages', uk: 'До сторінок', ru: 'К страницам' },
  'start.block.title': { en: 'Declare a block', uk: 'Оголосіть блок', ru: 'Объявите блок' },
  'start.block.body': {
    en: 'Blocks are what a page is built from, and each one is a TypeScript declaration — so this is the step Studio cannot do for you.',
    uk: 'Сторінка складається з блоків, і кожен блок — це оголошення TypeScript. Тому цей крок Studio не може зробити за вас.',
    ru: 'Страница состоит из блоков, и каждый блок — это объявление TypeScript. Поэтому этот шаг Studio не может сделать за вас.',
  },
  // --- the sidebar and the rail --------------------------------------------------
  //
  // A resource's own name is not here: it comes from the registry, in whatever language
  // the application declared it in. These are the headings Studio puts around them.
  'nav.dashboard': { en: 'Dashboard', uk: 'Огляд', ru: 'Обзор' },
  'nav.content': { en: 'Content', uk: 'Вміст', ru: 'Содержимое' },
  'nav.collections': { en: 'Collections', uk: 'Колекції', ru: 'Коллекции' },
  'nav.manageCollections': {
    en: 'Manage collections',
    uk: 'Керувати колекціями',
    ru: 'Управление коллекциями',
  },
  'nav.media': { en: 'Media', uk: 'Медіа', ru: 'Медиа' },
  'nav.pages': { en: 'Pages', uk: 'Сторінки', ru: 'Страницы' },
  'nav.allPages': { en: 'All pages', uk: 'Усі сторінки', ru: 'Все страницы' },
  'nav.design': { en: 'Design', uk: 'Дизайн', ru: 'Дизайн' },
  'nav.theme': { en: 'Theme', uk: 'Тема', ru: 'Тема' },
  'nav.ai': { en: 'AI', uk: 'ШІ', ru: 'ИИ' },
  'nav.proposals': { en: 'Proposals', uk: 'Пропозиції', ru: 'Предложения' },
  'nav.settings': { en: 'Settings', uk: 'Налаштування', ru: 'Настройки' },
  'nav.users': { en: 'Users', uk: 'Користувачі', ru: 'Пользователи' },
  'nav.developer': { en: 'Developer', uk: 'Для розробника', ru: 'Для разработчика' },

  // --- the bar across the top ----------------------------------------------------
  'chrome.expandSidebar': {
    en: 'Expand the sidebar',
    uk: 'Розгорнути бічну панель',
    ru: 'Развернуть боковую панель',
  },
  'chrome.collapseSidebar': {
    en: 'Collapse the sidebar',
    uk: 'Згорнути бічну панель',
    ru: 'Свернуть боковую панель',
  },
  'chrome.notifications': { en: 'Notifications', uk: 'Сповіщення', ru: 'Уведомления' },

  // --- the breadcrumb, for the two segments that are not a section ---------------
  'crumb.new': { en: 'New', uk: 'Нове', ru: 'Новое' },
  'crumb.history': { en: 'History', uk: 'Історія', ru: 'История' },

  // --- the account menu ----------------------------------------------------------
  'account.menu': { en: 'Account', uk: 'Обліковий запис', ru: 'Учётная запись' },
  // Two different questions, said in each language the way that language says them: the
  // content one names the thing being edited, the interface one names Studio itself.
  'account.editingIn': { en: 'Editing in', uk: 'Мова вмісту', ru: 'Язык содержимого' },
  'account.interface': { en: 'Studio language', uk: 'Мова Studio', ru: 'Язык Studio' },
  'account.signOut': { en: 'Sign out', uk: 'Вийти', ru: 'Выйти' },
  // --- the command palette --------------------------------------------------------
  'palette.label': { en: 'Search Studio', uk: 'Пошук у Studio', ru: 'Поиск в Studio' },
  'palette.placeholder': {
    en: 'Search collections, pages, settings…',
    uk: 'Шукайте колекції, сторінки, налаштування…',
    ru: 'Ищите коллекции, страницы, настройки…',
  },
  'palette.nothing': {
    en: 'Nothing matches “{query}”.',
    uk: 'Нічого не знайдено за запитом «{query}».',
    ru: 'Ничего не найдено по запросу «{query}».',
  },
  'palette.overview': { en: 'Overview', uk: 'Огляд', ru: 'Обзор' },
  'palette.library': { en: 'Library', uk: 'Бібліотека', ru: 'Библиотека' },
  // --- signing in ------------------------------------------------------------------
  'login.title': { en: 'Sign in to Studio', uk: 'Вхід до Studio', ru: 'Вход в Studio' },
  'login.lede': {
    en: 'Editors, reviewers and owners use the same door.',
    uk: 'Редактори, рецензенти й власники входять тими самими дверима.',
    ru: 'Редакторы, рецензенты и владельцы входят в одну и ту же дверь.',
  },
  'login.email': { en: 'Email', uk: 'Пошта', ru: 'Почта' },
  'login.password': { en: 'Password', uk: 'Пароль', ru: 'Пароль' },
  'login.show': { en: 'Show the password', uk: 'Показати пароль', ru: 'Показать пароль' },
  'login.hide': { en: 'Hide the password', uk: 'Приховати пароль', ru: 'Скрыть пароль' },
  'login.submit': { en: 'Sign in', uk: 'Увійти', ru: 'Войти' },
  'login.busy': { en: 'Signing in…', uk: 'Входимо…', ru: 'Входим…' },
  'login.trouble': {
    en: 'Trouble signing in? A workspace owner can re-send your invite.',
    uk: 'Не вдається увійти? Власник робочого простору може надіслати запрошення ще раз.',
    ru: 'Не удаётся войти? Владелец рабочего пространства может отправить приглашение ещё раз.',
  },
  // The one sentence a login screen must say the same way for both answers: an address
  // nobody has and a password that is wrong (SPEC.md §86).
  'login.mismatch': {
    en: 'That email and password do not match.',
    uk: 'Ця пошта й пароль не збігаються.',
    ru: 'Эта почта и пароль не совпадают.',
  },
  'login.failed': {
    en: 'Could not sign in. Please try again.',
    uk: 'Не вдалося увійти. Спробуйте ще раз.',
    ru: 'Не удалось войти. Попробуйте ещё раз.',
  },

  // What the dark panel says: facts about the framework, never about this deployment.
  'login.claim': {
    en: 'The content layer your build already trusts.',
    uk: 'Шар вмісту, якому ваша збірка вже довіряє.',
    ru: 'Слой содержимого, которому ваша сборка уже доверяет.',
  },
  'login.claimBody': {
    en: 'One declaration produces the editor, the API and the types. Nothing drifts, because nothing is written twice.',
    uk: 'Одне оголошення дає редактор, API і типи. Ніщо не розходиться, бо ніщо не написане двічі.',
    ru: 'Одно объявление даёт редактор, API и типы. Ничто не расходится, потому что ничто не написано дважды.',
  },
  'login.fact.mutations': { en: 'Mutations', uk: 'Зміни', ru: 'Изменения' },
  'login.fact.mutationsValue': { en: 'One path', uk: 'Один шлях', ru: 'Один путь' },
  'login.fact.schema': { en: 'Schema', uk: 'Схема', ru: 'Схема' },
  'login.fact.schemaValue': { en: 'One source', uk: 'Одне джерело', ru: 'Один источник' },
  'login.fact.clients': { en: 'Clients', uk: 'Клієнти', ru: 'Клиенты' },
  'login.fact.clientsValue': { en: 'Four', uk: 'Чотири', ru: 'Четыре' },
  // --- the first screen ------------------------------------------------------------
  'dashboard.fresh': {
    en: 'Nothing has been made here yet',
    uk: 'Тут ще нічого не зроблено',
    ru: 'Здесь ещё ничего не сделано',
  },
  'dashboard.declares': {
    en: 'What this application declares',
    uk: 'Що оголошує цей застосунок',
    ru: 'Что объявляет это приложение',
  },
  'dashboard.wired': {
    en: 'Already wired up for you',
    uk: 'Уже підключено за вас',
    ru: 'Уже подключено за вас',
  },
  'dashboard.resources': { en: 'Resources', uk: 'Ресурси', ru: 'Ресурсы' },
  'dashboard.models': { en: 'Models', uk: 'Моделі', ru: 'Модели' },
  'dashboard.commands': { en: 'Commands', uk: 'Команди', ru: 'Команды' },
  'dashboard.endpoints': { en: 'Endpoints', uk: 'Точки доступу', ru: 'Точки доступа' },
  'dashboard.blocks': { en: 'Blocks', uk: 'Блоки', ru: 'Блоки' },
  'dashboard.fieldCount': {
    en: ['{count} field', '{count} fields', '{count} fields'],
    uk: ['{count} поле', '{count} поля', '{count} полів'],
    ru: ['{count} поле', '{count} поля', '{count} полей'],
  },
} as const satisfies Catalogue
