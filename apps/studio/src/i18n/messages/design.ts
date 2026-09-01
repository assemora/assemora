/**
 * The theme screen and the universal design controls a block carries.
 */
import type { Catalogue } from '../catalogue.ts'

export const DESIGN = {
  // --- the seven controls every block carries (SPEC.md §61) -------------------------
  //
  // A token's own name — `lg`, `wide`, `surface` — is never translated: it is what the
  // block stores and what the theme declares, and a Ukrainian word here would name
  // nothing.
  'design.themeDefault': { en: 'Theme default', uk: 'Як у темі', ru: 'Как в теме' },
  'design.notInTheme': {
    en: '{token} — not in the theme',
    uk: '{token} — немає в темі',
    ru: '{token} — нет в теме',
  },
  'design.spaceAbove': { en: 'Space above', uk: 'Відступ згори', ru: 'Отступ сверху' },
  'design.spaceBelow': { en: 'Space below', uk: 'Відступ знизу', ru: 'Отступ снизу' },
  'design.width': { en: 'Width', uk: 'Ширина', ru: 'Ширина' },
  'design.container': { en: 'Container', uk: 'Контейнер', ru: 'Контейнер' },
  'design.alignment': { en: 'Alignment', uk: 'Вирівнювання', ru: 'Выравнивание' },
  'design.background': { en: 'Background', uk: 'Тло', ru: 'Фон' },
  'design.hiddenOn': { en: 'Hidden on', uk: 'Приховано на', ru: 'Скрыт на' },
  'design.hiddenOnHelp': {
    en: 'Responsive visibility. The block stays in the tree',
    uk: 'Видимість за розміром екрана. Блок лишається в дереві',
    ru: 'Видимость по размеру экрана. Блок остаётся в дереве',
  },
  // --- the five groups of tokens (SPEC.md §62) ----------------------------------------
  'design.group.colours': { en: 'Colours', uk: 'Кольори', ru: 'Цвета' },
  'design.group.coloursHelp': {
    en: 'A block names one of these as its background, so this list is the list of backgrounds there are',
    uk: 'Блок називає один із них своїм тлом, тож цей список і є списком можливих тл',
    ru: 'Блок называет один из них своим фоном, поэтому этот список и есть список возможных фонов',
  },
  'design.group.fonts': { en: 'Font stacks', uk: 'Набори шрифтів', ru: 'Наборы шрифтов' },
  'design.group.fontsHelp': {
    en: 'Most preferred family first, ending in a generic family a browser always has',
    uk: 'Спершу найбажаніша гарнітура, наприкінці — родова, яка є в кожному браузері',
    ru: 'Сначала самая желаемая гарнитура, в конце — родовая, которая есть в каждом браузере',
  },
  'design.group.sizes': { en: 'Type scale', uk: 'Шкала розмірів', ru: 'Шкала размеров' },
  'design.group.sizesHelp': {
    en: 'The sizes text is set at',
    uk: 'Розміри, якими набирається текст',
    ru: 'Размеры, которыми набирается текст',
  },
  'design.group.weights': {
    en: 'Font weights',
    uk: 'Насиченість шрифту',
    ru: 'Насыщенность шрифта',
  },
  'design.group.weightsHelp': {
    en: '1 to 1000, as a font declares them',
    uk: 'Від 1 до 1000, як їх оголошує шрифт',
    ru: 'От 1 до 1000, как их объявляет шрифт',
  },
  'design.group.lineHeights': {
    en: 'Line heights',
    uk: 'Міжрядкові інтервали',
    ru: 'Межстрочные интервалы',
  },
  'design.group.lineHeightsHelp': {
    en: 'Unitless, so they scale with whatever size they are used at',
    uk: 'Без одиниць, тож вони масштабуються разом із розміром, з яким їх ужито',
    ru: 'Без единиц, поэтому они масштабируются вместе с размером, с которым их применили',
  },
  'design.group.spacing': { en: 'Spacing', uk: 'Відступи', ru: 'Отступы' },
  'design.group.spacingHelp': {
    en: 'What the space above and below a block means',
    uk: 'Що означає відступ згори й знизу блоку',
    ru: 'Что означает отступ сверху и снизу блока',
  },
  'design.group.radius': { en: 'Corner radius', uk: 'Радіус кутів', ru: 'Радиус углов' },
  'design.group.radiusHelp': {
    en: 'The corners a site rounds, from square to a pill',
    uk: 'Як сайт заокруглює кути — від прямого до пігулки',
    ru: 'Как сайт скругляет углы — от прямого до пилюли',
  },
  'design.group.container': {
    en: 'Container widths',
    uk: 'Ширини контейнерів',
    ru: 'Ширины контейнеров',
  },
  'design.group.containerHelp': {
    en: 'How wide a block is allowed to be at each of the four widths',
    uk: 'Якої ширини може бути блок за кожної з чотирьох ширин',
    ru: 'Какой ширины может быть блок при каждой из четырёх ширин',
  },
  'design.typography': { en: 'Typography', uk: 'Типографіка', ru: 'Типографика' },
  'design.typographyHelp': {
    en: 'Four maps rather than one, so every entry holds a single kind of value and is checked as that kind',
    uk: 'Чотири мапи, а не одна, щоб кожен запис тримав значення одного виду й перевірявся як цей вид',
    ru: 'Четыре карты, а не одна, чтобы каждая запись держала значение одного вида и проверялась как этот вид',
  },

  // --- the theme screen ------------------------------------------------------------------
  'design.lede': {
    en: 'The tokens every page is drawn from. A block picks a name; this decides what it looks like',
    uk: 'Токени, з яких малюється кожна сторінка. Блок обирає назву, а тут вирішується, як вона виглядає',
    ru: 'Токены, из которых рисуется каждая страница. Блок выбирает название, а здесь решается, как оно выглядит',
  },
  'design.neverEdited': { en: 'never edited', uk: 'не редаговано', ru: 'не редактировалась' },
  'design.unsaved': { en: 'unsaved', uk: 'не збережено', ru: 'не сохранено' },
  'design.changed': { en: 'changed', uk: 'змінено', ru: 'изменено' },
  'design.undo': { en: 'Undo', uk: 'Скасувати', ru: 'Отменить' },
  'design.undoQuiet': { en: 'undo', uk: 'скасувати', ru: 'отменить' },
  'design.reset': { en: 'Reset', uk: 'Скинути', ru: 'Сбросить' },
  'design.resetTitle': {
    en: 'Stop overriding it and take the default back',
    uk: 'Перестати перекривати і повернути початкове значення',
    ru: 'Перестать перекрывать и вернуть исходное значение',
  },
  'design.removeTitle': {
    en: 'Take this token out of the theme',
    uk: 'Вилучити цей токен із теми',
    ru: 'Удалить этот токен из темы',
  },
  'design.backTo': { en: 'back to {value}', uk: 'назад до {value}', ru: 'назад к {value}' },
  'design.backToDefault': {
    en: 'back to the default',
    uk: 'назад до початкового значення',
    ru: 'назад к исходному значению',
  },
  'design.removedFromTheme': {
    en: 'removed from the theme',
    uk: 'вилучено з теми',
    ru: 'удалено из темы',
  },
  'design.newToken': { en: 'New token', uk: 'Новий токен', ru: 'Новый токен' },
  'design.nameTaken': {
    en: 'The theme already has a token by that name',
    uk: 'У темі вже є токен із такою назвою',
    ru: 'В теме уже есть токен с таким названием',
  },
  'design.name.colour': {
    en: 'Lowercase letters, digits and single dashes, opening with a letter',
    uk: 'Малі латинські літери, цифри й одинарні дефіси, починаючи з літери',
    ru: 'Строчные латинские буквы, цифры и одиночные дефисы, начиная с буквы',
  },
  'design.name.token': {
    en: 'Lowercase letters, digits and single dashes',
    uk: 'Малі латинські літери, цифри й одинарні дефіси',
    ru: 'Строчные латинские буквы, цифры и одиночные дефисы',
  },
  'design.openNames': { en: 'your own names', uk: 'власні назви', ru: 'свои названия' },
  'design.fixedNames': { en: 'fixed names', uk: 'сталі назви', ru: 'фиксированные названия' },
  'design.fixedNamesWhy': {
    en: ' — a block names these, so none can be added or removed',
    uk: ' — блок звертається до них на ім’я, тож жодну не можна додати чи вилучити',
    ru: ' — блок обращается к ним по имени, поэтому ни одно нельзя добавить или удалить',
  },
  'design.unsavedCount': {
    en: ['{count} unsaved change', '{count} unsaved changes', '{count} unsaved changes'],
    uk: ['{count} незбережена зміна', '{count} незбережені зміни', '{count} незбережених змін'],
    ru: [
      '{count} несохранённое изменение',
      '{count} несохранённых изменения',
      '{count} несохранённых изменений',
    ],
  },
  'design.unsavedTokens': {
    en: ['{count} unsaved token', '{count} unsaved tokens', '{count} unsaved tokens'],
    uk: [
      '{count} незбережений токен',
      '{count} незбережені токени',
      '{count} незбережених токенів',
    ],
    ru: [
      '{count} несохранённый токен',
      '{count} несохранённых токена',
      '{count} несохранённых токенов',
    ],
  },
  'design.confirmLeave': {
    en: 'Your theme changes have not been saved. Leave the screen anyway?',
    uk: 'Зміни теми не збережено. Усе одно піти з екрана?',
    ru: 'Изменения темы не сохранены. Всё равно уйти с экрана?',
  },
  'design.confirmRemoval': {
    en: 'Saving takes {names} out of the theme. A block whose background names one is drawn with no background at all. The change is a revision, so undo puts it back.',
    uk: 'Збереження вилучить {names} із теми. Блок, тло якого називає такий токен, буде намальовано взагалі без тла. Ця зміна — ревізія, тож скасування поверне її.',
    ru: 'Сохранение удалит {names} из темы. Блок, фон которого называет такой токен, будет нарисован вообще без фона. Это изменение — ревизия, поэтому отмена вернёт его.',
  },
  'design.conflict': {
    en: 'Somebody else has changed the theme since this screen read it. Reloading takes their version and drops the changes listed below.',
    uk: 'Хтось інший змінив тему, відколи цей екран її прочитав. Перезавантаження візьме їхню версію й відкине зміни, перелічені нижче.',
    ru: 'Кто-то другой изменил тему с тех пор, как этот экран её прочитал. Перезагрузка возьмёт их версию и отбросит изменения, перечисленные ниже.',
  },
  'design.readOnly': {
    en: 'You can read the theme but not change it. Editing needs the {permission} permission.',
    uk: 'Ви можете читати тему, але не змінювати її. Для редагування потрібен дозвіл {permission}.',
    ru: 'Вы можете читать тему, но не менять её. Для редактирования нужно право {permission}.',
  },
  'design.noTheme': {
    en: 'This application has no theme',
    uk: 'У цього застосунку немає теми',
    ru: 'У этого приложения нет темы',
  },
  'design.noThemeBody': {
    en: 'Add {call} to its modules and the five groups of tokens appear here.',
    uk: 'Додайте {call} до його модулів — і тут з’являться п’ять груп токенів.',
    ru: 'Добавьте {call} в его модули — и здесь появятся пять групп токенов.',
  },
  'design.previewNote': {
    en: 'Drawn from the tokens above, under the names the generated stylesheet declares — {groups} groups, {tokens} tokens.',
    uk: 'Намальовано з токенів вище, під назвами, які оголошує згенерована таблиця стилів — {groups} груп, {tokens} токенів.',
    ru: 'Нарисовано из токенов выше, под названиями, которые объявляет сгенерированная таблица стилей — {groups} групп, {tokens} токенов.',
  },
  'design.lastSaved': {
    en: 'Last saved {when}.',
    uk: 'Востаннє збережено {when}.',
    ru: 'Последнее сохранение {when}.',
  },
  // --- the sample the tokens are drawn on -----------------------------------------------
  'preview.heading': { en: 'A page heading', uk: 'Заголовок сторінки', ru: 'Заголовок страницы' },
  'preview.body': {
    en: 'Body text, at the size and line height the theme decides. A block never says any of this: it names a token, and this answers.',
    uk: 'Основний текст, розміром і інтервалом, які вирішує тема. Блок нічого з цього не каже: він називає токен, а тема відповідає.',
    ru: 'Основной текст, размером и интервалом, которые решает тема. Блок ничего из этого не говорит: он называет токен, а тема отвечает.',
  },
  'preview.sunken': {
    en: 'A sunken surface, the way a card sits on a page.',
    uk: 'Заглиблена поверхня — так картка лежить на сторінці.',
    ru: 'Углублённая поверхность — так карточка лежит на странице.',
  },
  'preview.button': { en: 'A button', uk: 'Кнопка', ru: 'Кнопка' },
  // `{step}` is a token name — `sm`, `2xl` — and stays as the theme wrote it.
  'preview.spaceStep': {
    en: 'space above and below: {step}',
    uk: 'відступ згори й знизу: {step}',
    ru: 'отступ сверху и снизу: {step}',
  },
  'preview.corners': { en: 'Corners', uk: 'Кути', ru: 'Углы' },
  'preview.everyColour': { en: 'Every colour', uk: 'Усі кольори', ru: 'Все цвета' },
  'preview.stylesheet': {
    en: 'The stylesheet this renders to is served under {version}, which changes when and only when the CSS does — so a cached copy is never the wrong one.',
    uk: 'Таблицю стилів, на яку це перетворюється, віддають за адресою {version}, що змінюється тоді й лише тоді, коли змінюється CSS — тож кешована копія ніколи не буває не тією.',
    ru: 'Таблицу стилей, в которую это превращается, отдают по адресу {version}, который меняется тогда и только тогда, когда меняется CSS — поэтому кешированная копия никогда не бывает не той.',
  },

  // --- the token inputs -----------------------------------------------------------------
  'inputs.unit': { en: 'Unit', uk: 'Одиниця', ru: 'Единица' },
  'inputs.moveEarlier': {
    en: 'Move {name} earlier',
    uk: 'Перемістити {name} раніше',
    ru: 'Переместить {name} раньше',
  },
  'inputs.addFamily': {
    en: 'Add a family, such as Inter or sans-serif',
    uk: 'Додайте гарнітуру, наприклад Inter або sans-serif',
    ru: 'Добавьте гарнитуру, например Inter или sans-serif',
  },
  'design.didNotWork': { en: 'That did not work', uk: 'Не вийшло', ru: 'Не получилось' },
} as const satisfies Catalogue
