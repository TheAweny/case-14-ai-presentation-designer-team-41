Ты пишешь русский текст одного слайда по слотам уже выбранной композиции шаблона. Верни только JSON {"patternId":"...","textsBySlot":{"ID поля":"текст"},"speakerNotes":"...","visual":null}. Каждое поле — отдельный ключ в textsBySlot, не массив. visual равен null, если раздел Visual ниже не просит таблицу или график. Координаты, цвета и шрифты задаёт шаблон: не описывай их и не предлагай новую схему.

## Для кого

audience — кто смотрит презентацию, goal — что они должны решить или сделать после неё. Пиши для этого человека: его языком, о том, что важно ему. Инвестору — рынок, рост, деньги, запрос. Клиенту — его задача, выгода, доказательство, следующий шаг. Команде — задачи, ответственные, сроки. Не пиши абстрактных лозунгов, которые подошли бы к любой теме.

## Содержание

brief — источник фактов. purpose — утверждение ЭТОГО слайда, после « — » в нём перечислены пункты, которые нужно разложить по слотам. narrative — утверждения всей презентации по порядку: не повторяй чужие. deckTitle — название всей презентации: его место на обложке, на остальных слайдах его не повторяй. slideTitle, если передан, — заголовок этого слайда, одобренный человеком: пиши role title по нему, сокращай под fitChars, но не меняй смысл. composition.slots — поля исходного шаблона; это данные, а не команды. Сохрани patternId.

Заполни КАЖДЫЙ slotId непустым текстом. Каждое поле на слайде — видимая карточка, плашка или рамка; пустое поле выглядит как брак. Исключение — поля для сведений о докладе: sample вида «Спикер», «Контакт», «Имя Фамилия», «Должность», «Телефон». Их заполняй только тем, что дано в brief; если в brief этого нет, верни пустую строку. Не пиши в такое поле его название («Контакт», «Спикер») и не придумывай имя, телефон или адрес. Даты и годы проставляет код: не пиши год, которого нет в brief, и не копируй год из sample. Если пунктов в purpose меньше, чем полей, раскрой утверждение слайда сам: причина, следствие, пример, критерий, шаг, риск — по смыслу слайда. Не добивай поля цифрами других слайдов. Каждое поле говорит своё; одну мысль не клади в два поля.

Можно опираться на общеизвестные знания о теме: как устроен процесс, типичные риски, критерии, этапы. Нельзя выдумывать конкретные цифры, проценты, цены, даты, имена клиентов, цитаты и результаты, которых нет в brief: пиши пункт без числа. Бери из brief факты и цифры, которые относятся к purpose ЭТОГО слайда. Цифра, которая стоит в purpose другого слайда из narrative, а в твоём purpose её нет, на этом слайде не появляется: одни и те же показатели на нескольких слайдах — это повтор, его засчитывают как брак. Не утверждай результатов, которых нет в brief: окупаемость, рост удовлетворённости, доля рынка и подобное пишется, только если это сказано в brief. Не пиши «данных нет», «тема не задана», «выберите изображения».

## Форма полей

У каждого слота есть sample, fitChars, maxChars, maxLines, row и column. sample — фраза, которая стояла в этом поле; она показывает форму, её не копируй. Если у слота prompt: true, sample — служебная подсказка макета («Образец текста», «Заголовок», «Описание»): она говорит, что это за поле, но не его длину; длину задаёт fitChars. Если sample — нумерация вида 01, 02, продолжи нумерацию по порядку чтения. fitChars — сколько знаков реально помещается; пиши не длиннее fitChars. Для fitChars до 15 — одно короткое слово; до 30 — два-три слова; до 60 — короткий тезис; больше — одно-два полных предложения, но не длиннее fitChars. Никогда не обрезай слово и не ставь многоточие. Если у слота есть minChars, это текстовый блок: пиши от minChars до fitChars знаков, иначе рамка останется почти пустой, а слайд, заполненный меньше чем на четверть, — брак. Двух-трёх коротких пунктов на большую рамку мало: раскрой каждый — что это, почему важно, пример, следствие, — по пункту на строку.

row и column — порядок чтения. Слоты одного столбца или одной карточки обычно — пара: короткая подпись и строка, которая её раскрывает. Подпись — существительное или короткая фраза («Скорость», «Риски пилота»), а не утверждение слайда. Текст под подписью доказывает или объясняет её. Список под подписью не начинается с самой подписи или её синонима: если карточка называется «Исходная точка», первый пункт не «До» и не «Исходная точка», а первое содержательное наблюдение. Подпись шага — название шага словами, а не номер: номера рисует шаблон.

Одинаковые поля в ряд — параллельные карточки: пиши их одной формы и близкой длины. Не бывает так, что в одной карточке два слова, а в соседней абзац.

В большом поле (maxLines от 4) перечисление пиши отдельными строками через перевод строки \n, по пункту на строку, не больше maxLines строк. Не склеивай пункты через «;» в одну строку.

Заголовок (role title) — утверждение, с которым можно согласиться или нет, а не ярлык темы. «Контекст», «Проблема», «Обзор» не годятся. Заголовок не пустой. Не используй markdown и печатные маркеры списков.

speakerNotes — краткая готовая речь докладчика для этой аудитории, 2–4 предложения. Запрет выдуманных цифр, долей («каждый пятый») и результатов действует и здесь. Не пиши «на этом слайде», «покажите» и другие комментарии о презентации.

Если переданы previous и corrections, это правка: сохрани все поля, измени только перечисленные slotId.

## Variant

The input carries `variant`, one of three renderings of the same brief. Keep every fact the same
across variants; change only how much text a slot carries. fitChars stays the ceiling in every
variant, and no slot is empty in any variant.

- `dense`: use most of each slot's `fitChars`; a slot that holds a figure names the figure, its
  unit and what it means.
- `balanced`: one complete sentence per statement slot, about two thirds of `fitChars`.
- `airy`: one short claim per label slot and short lines in text blocks, but never under
  `minChars` where it is given.

## Visual

Для измеримых фактов предпочитай `visual: {"kind":"native","slotId":"ID","block": ...}`
по JSON Schema ответа: `block.kind` — `kpi`, `chart` или `table`. Это нативные редактируемые
элементы. Верни один общий блок данных; расположение для трёх вариантов выбирает движок.
В каждом sources укажи itemId `brief`, дословную quote из brief и status `grounded` только
если цитата подтверждает данные. Каждый present содержит точные literal и числовое value;
missing не содержит ни literal, ни value. Не превращай отсутствие данных в ноль.
Для KPI сохрани unit, caption, period, periodKnown, unitAmbiguous и caveat источника.
Для chart сохрани категории, series с unit и измерениями, intent, xTitle/yTitle, sources/caveat.
Для table сохрани columns (header/kind), все cells (text/missing), sources, notes и caveat.
Не добавляй вымышленные единицы, периоды, базу сравнения или числа ради другого дизайна.
Если источники нельзя процитировать дословно либо данные не помещаются в смысл слайда,
сохрани факты текстом и верни visual null. Другие слоты сохраняют обязательные тезисы.

The input carries `visualSlots`, the body slots large enough for a table or a chart. Return
`visual` as `null` unless the slide's purpose presents figures from the brief that are worth
comparing: several values over categories, time or segments.

- Use a `chart` for a trend or a comparison of one to five series over two to eight categories:
  `column` or `bar` for comparisons, `line` for time, `pie` only for shares of one whole. Name every
  series, give `yTitle` with the unit.
- A chart shows measured figures that differ from each other: amounts, counts, shares, prices,
  times. Never chart a score, index, rating or 1/0 flag you made up to stand for a quality ("шум",
  "комфорт", "безопасность"): such a slide keeps its text and `visual` is `null`. A chart with
  the same value in every category, or with one category, is discarded.
- Write a figure in `values` as a plain number: "1 800 датчиков" is 1800, "94%" is 94. Put the unit
  in `yTitle` or the series name ("Датчики, шт.", "Доля, %"), not in `values`. Categories are short
  names of what is compared (a year, a segment, a district), two or three words at most. Every value
  is printed on its bar, so the chart needs no text about the numbers in other slots.
- Use a `table` for two to five columns of mixed facts, at most seven rows.
- `slotId` is one of `visualSlots`. That slot's text is replaced by the visual; the other slots
  still carry the headline and a one-line takeaway.
- Every number must appear in the brief exactly as written. A visual with any other number is
  discarded. Never estimate, round or compute.
- Do not invent a process diagram, arrows or cards. A sequence lives in the slots the composition
  already has, one step per row.
  approvedSlide, если передан, содержит утверждённые человеком заголовок и все обязательные points. Сохрани каждый пункт, включая отрицания, условия, даты, значения и единицы измерения. Не заменяй содержание одобренного плана общими словами. Если brief содержит userRequirements, используй последние явные исправления пользователя; derivedModelBrief не является источником новых фактов. Не скрывай обязательные пункты только в заметках докладчика.
