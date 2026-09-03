/**
 * Users, roles, API tokens and agents.
 */
import type { Catalogue } from '../catalogue.ts'

export const PEOPLE = {
  // --- four views of one question --------------------------------------------------
  'people.tab.people': { en: 'People', uk: 'Люди', ru: 'Люди' },
  'people.tab.roles': { en: 'Roles', uk: 'Ролі', ru: 'Роли' },
  'people.tab.tokens': { en: 'API tokens', uk: 'Токени API', ru: 'Токены API' },
  'people.tab.agents': { en: 'Agents', uk: 'Агенти', ru: 'Агенты' },
  'people.tabs': { en: 'Access views', uk: 'Розділи доступу', ru: 'Разделы доступа' },
  'people.lede': {
    en: 'Who may sign in, and what they may do',
    uk: 'Хто може входити і що йому дозволено',
    ru: 'Кто может входить и что ему разрешено',
  },

  // --- people -----------------------------------------------------------------------
  'people.newPerson': { en: 'New person', uk: 'Додати людину', ru: 'Добавить человека' },
  'people.name': { en: 'Name', uk: 'Ім’я', ru: 'Имя' },
  'people.passwordHelp': {
    en: 'At least twelve characters',
    uk: 'Щонайменше дванадцять символів',
    ru: 'Не менее двенадцати символов',
  },
  'people.role': { en: 'Role', uk: 'Роль', ru: 'Роль' },
  'people.noRole': { en: 'No role', uk: 'Без ролі', ru: 'Без роли' },
  'people.createFailed': {
    en: 'Could not create them',
    uk: 'Не вдалося створити',
    ru: 'Не удалось создать',
  },
  'people.creating': { en: 'Creating…', uk: 'Створюємо…', ru: 'Создаём…' },
  'people.searchPlaceholder': {
    en: 'Search by name or email…',
    uk: 'Пошук за ім’ям або поштою…',
    ru: 'Поиск по имени или почте…',
  },
  'people.noMatch': {
    en: 'Nobody matches that',
    uk: 'Нікого не знайдено',
    ru: 'Никого не найдено',
  },
  'people.takeRoleAway': {
    en: 'Take this role away',
    uk: 'Забрати цю роль',
    ru: 'Забрать эту роль',
  },
  'people.addRole': { en: 'Add role…', uk: 'Додати роль…', ru: 'Добавить роль…' },
  'people.active': { en: 'active', uk: 'активний', ru: 'активен' },
  'people.blocked': { en: 'blocked', uk: 'заблокований', ru: 'заблокирован' },
  'people.cannotBlockSelf': {
    en: 'You cannot block yourself',
    uk: 'Себе заблокувати не можна',
    ru: 'Себя заблокировать нельзя',
  },
  'people.block': { en: 'Block', uk: 'Заблокувати', ru: 'Заблокировать' },
  'people.unblock': { en: 'Unblock', uk: 'Розблокувати', ru: 'Разблокировать' },

  // --- roles and permissions ----------------------------------------------------------
  'people.allPermissions': {
    en: 'Every permission this application has recorded',
    uk: 'Усі дозволи, які записав цей застосунок',
    ru: 'Все права, которые записало это приложение',
  },
  'people.permissionsAreCommands': {
    en: 'A permission name is a command name. {example} grants everything under it.',
    uk: 'Назва дозволу — це назва команди. {example} дає все, що під ним.',
    ru: 'Название права — это название команды. {example} даёт всё, что под ним.',
  },
  'people.permissions': { en: 'Permissions', uk: 'Дозволи', ru: 'Права' },

  // --- API tokens ----------------------------------------------------------------------
  'people.issueToken': { en: 'Issue an API token', uk: 'Видати токен API', ru: 'Выдать токен API' },
  'people.issueAToken': { en: 'Issue a token', uk: 'Видати токен', ru: 'Выдать токен' },
  'people.tokenScope': {
    en: 'A token can do exactly what you give it, and no more than you hold yourself.',
    uk: 'Токен може рівно те, що ви йому дасте, і не більше, ніж маєте самі.',
    ru: 'Токен может ровно то, что вы ему дадите, и не больше, чем есть у вас самих.',
  },
  'people.tokenPurpose': { en: 'What is it for?', uk: 'Для чого він?', ru: 'Для чего он?' },
  'people.tokenExample': {
    en: 'Analytics export',
    uk: 'Експорт аналітики',
    ru: 'Экспорт аналитики',
  },
  'people.expires': { en: 'Expires', uk: 'Термін дії', ru: 'Срок действия' },
  'people.expiresHelp': {
    en: 'A token that never expires is one nobody remembers to revoke',
    uk: 'Токен без терміну дії — це той, який ніхто не згадає відкликати',
    ru: 'Токен без срока действия — тот, который никто не вспомнит отозвать',
  },
  'people.expiry.30': { en: '30 days', uk: '30 днів', ru: '30 дней' },
  'people.expiry.90': { en: '90 days', uk: '90 днів', ru: '90 дней' },
  'people.expiry.year': { en: 'A year', uk: 'Рік', ru: 'Год' },
  'people.chooseOne': {
    en: 'Choose at least one',
    uk: 'Оберіть хоча б один',
    ru: 'Выберите хотя бы одно',
  },
  'people.issueFailed': {
    en: 'Could not issue it',
    uk: 'Не вдалося видати',
    ru: 'Не удалось выдать',
  },
  'people.issuing': { en: 'Issuing…', uk: 'Видаємо…', ru: 'Выдаём…' },
  'people.issue': { en: 'Issue', uk: 'Видати', ru: 'Выдать' },
  'people.copyNow': {
    en: 'Copy this now. It is never shown again.',
    uk: 'Скопіюйте зараз. Більше він не показується.',
    ru: 'Скопируйте сейчас. Больше он не показывается.',
  },
  'people.noTokens': { en: 'No API tokens', uk: 'Токенів API немає', ru: 'Токенов API нет' },
  'people.noTokensBody': {
    en: 'A token authenticates an integration, not a person.',
    uk: 'Токен посвідчує інтеграцію, а не людину.',
    ru: 'Токен удостоверяет интеграцию, а не человека.',
  },
  'people.lastUsed': {
    en: 'Last used',
    uk: 'Востаннє використано',
    ru: 'Последнее использование',
  },
  'people.confirmRevoke': {
    en: 'Revoke “{name}”? It stops working at once.',
    uk: 'Відкликати «{name}»? Він одразу перестане працювати.',
    ru: 'Отозвать «{name}»? Он сразу перестанет работать.',
  },
  'people.revoke': { en: 'Revoke', uk: 'Відкликати', ru: 'Отозвать' },

  // --- agents ---------------------------------------------------------------------------
  'people.createAgent': { en: 'Create an agent', uk: 'Створити агента', ru: 'Создать агента' },
  'people.newAgent': { en: 'New agent', uk: 'Новий агент', ru: 'Новый агент' },
  'people.agentScope': {
    en: 'An agent reaches the tools this application generates, and only what you tick here.',
    uk: 'Агент дістає інструменти, які створює цей застосунок, і лише те, що ви позначите тут.',
    ru: 'Агент получает инструменты, которые создаёт это приложение, и только то, что вы отметите здесь.',
  },
  'people.agentName': {
    en: 'What is it called?',
    uk: 'Як він називається?',
    ru: 'Как он называется?',
  },
  'people.agentExample': {
    en: 'Content agent',
    uk: 'Агент вмісту',
    ru: 'Агент содержимого',
  },
  'people.agentPurpose': { en: 'What does it do?', uk: 'Що він робить?', ru: 'Что он делает?' },
  'people.agentPurposeHelp': {
    en: 'Read in the audit log beside everything it did.',
    uk: 'Читається в журналі поруч з усім, що він зробив.',
    ru: 'Читается в журнале рядом со всем, что он сделал.',
  },
  'people.agentFailed': {
    en: 'The agent was not created.',
    uk: 'Агента не створено.',
    ru: 'Агент не создан.',
  },
  'people.create': { en: 'Create', uk: 'Створити', ru: 'Создать' },
  'people.agentTokenIs': {
    en: 'This is the agent. Copy it now — it is never shown again.',
    uk: 'Це і є агент. Скопіюйте зараз — більше він не показується.',
    ru: 'Это и есть агент. Скопируйте сейчас — больше он не показывается.',
  },
  'people.noAgents': { en: 'No agents yet', uk: 'Агентів ще немає', ru: 'Агентов пока нет' },
  'people.noAgentsBody': {
    en: 'An agent is an identity with its own permissions, audited like anyone else.',
    uk: 'Агент — це особа з власними дозволами, і його дії журналюються, як і будь-чиї.',
    ru: 'Агент — это личность со своими правами, и его действия журналируются, как и любые другие.',
  },
  'people.enabled': { en: 'enabled', uk: 'увімкнено', ru: 'включён' },
  'people.disabled': { en: 'disabled', uk: 'вимкнено', ru: 'выключен' },
  'people.enable': { en: 'Enable', uk: 'Увімкнути', ru: 'Включить' },
  'people.disable': { en: 'Disable', uk: 'Вимкнути', ru: 'Выключить' },
} as const satisfies Catalogue
