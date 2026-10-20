---
title: "Схемы"
description: "Имена моделей из OpenAPI-документа API."
---

> Файл сгенерирован командой `yarn nx run api:export-openapi` из декораторов API и Zod-схем. Вручную не редактируется.

## Account

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `id` | string | да |  |
| `email` | string | да |  |
| `name` | string | да |  |
| `role` | `admin`, `user` | да |  |
| `disabled` | boolean | да |  |
| `createdAt` | string | да |  |
| `avatar` | string | нет | null — знак по id, `preset:N` — выбранный знак, иначе data URL картинки. |

## AccountInput

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `email` | string | да |  |
| `name` | string | да |  |
| `password` | string | да |  |
| `role` | `admin`, `user` | нет |  |

## AccountLimit

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `limit` | integer | да |  |
| `period` | `lifetime`, `day`, `month` | да |  |
| `timezone` | string | да |  |

## AccountPatch

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `email` | string | нет |  |
| `name` | string | нет |  |
| `password` | string | нет |  |
| `role` | `admin`, `user` | нет |  |
| `disabled` | boolean | нет |  |
| `avatar` | string | нет |  |

## AccountPolicy

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `generation` | — | нет |  |
| `assistant-response` | — | нет |  |
| `image` | — | нет |  |
| `edit` | — | нет |  |
| `concurrency` | — | нет |  |
| `storage` | — | нет |  |

## AccountUsageView

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `defaults` | [AccountPolicy](/docs/api/reference/schemas/#accountpolicy) | да |  |
| `override` | [AccountPolicy](/docs/api/reference/schemas/#accountpolicy) | да |  |
| `effective` | [AccountPolicy](/docs/api/reference/schemas/#accountpolicy) | да |  |
| `storageBytes` | number | да |  |
| `metrics` | array&lt;object&gt; | да |  |

## ApiError

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `statusCode` | integer | да |  |
| `message` | string или array&lt;string&gt; | да |  |
| `error` | string | нет |  |

## Box

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `x` | integer | да | Left edge in EMU. |
| `y` | integer | да | Top edge in EMU. |
| `cx` | integer | да | Width in EMU. |
| `cy` | integer | да | Height in EMU. |

## BuildStatus

Тип: ``preparing`, `running`, `done`, `failed`, `cancelled``.

## ChartElement

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `kind` | `chart` | да |  |
| `elementId` | string | да |  |
| `role` | [ElementRole](/docs/api/reference/schemas/#elementrole) | да |  |
| `box` | [Box](/docs/api/reference/schemas/#box) | да |  |
| `rotation` | number | нет | Clockwise, in degrees, about the centre of the box. Absent means 0. |
| `opacity` | number | нет | From 0 to 1. Absent means opaque. |
| `locked` | boolean | нет | True keeps the editor from selecting or moving the element by accident, as template backgrounds usually are. Absent means false. |
| `groupIds` | array&lt;string&gt; | нет | Groups the element belongs to, outermost first. Elements whose ids start with the same run form one group, and nested runs nest groups, as p:grpSp does in OOXML. Members of a group are consecutive in paint order. Absent: the element is in no group. |
| `sourcePart` | `slide`, `layout`, `master` | нет | Which part the shape was read from. Master and layout graphics are already painted when a slide of that layout is cloned, so an export that keeps the source slide must not draw them again. Absent means the slide itself. |
| `sourceShapeId` | integer | да |  |
| `chartType` | [ChartType](/docs/api/reference/schemas/#charttype) | да |  |
| `categories` | array&lt;string&gt; | да |  |
| `series` | array&lt;[ChartSeries](/docs/api/reference/schemas/#chartseries)&gt; | да |  |
| `xTitle` | string | да |  |
| `yTitle` | string | да |  |
| `positions` | array&lt;number&gt; | нет | Numeric position of each category, in category order. Present when the steps are not equal, so a line uses this axis instead of equal slots. |

## ChartSeries

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `name` | string | да |  |
| `values` | array&lt;number&gt; | да |  |
| `unit` | string | нет |  |

## ChartType

Тип: ``bar`, `column`, `line`, `pie`, `area``.

## ChatAnswer

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `optionLabels` | array&lt;string&gt; | да |  |
| `text` | string | да |  |

## ChatAttachment

Тип: `object или object или object`.

## ChatDocument

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `chatId` | string | да |  |
| `title` | string | да |  |
| `projectId` | string | да |  |
| `deckIds` | array&lt;string&gt; | да |  |
| `deckId` | string | да |  |
| `mode` | [ChatMode](/docs/api/reference/schemas/#chatmode) | да |  |
| `createdAt` | string | да |  |
| `updatedAt` | string | да |  |
| `model` | — | нет |  |
| `messages` | array&lt;[ChatMessage](/docs/api/reference/schemas/#chatmessage)&gt; | да |  |
| `running` | boolean | да |  |

## ChatMessage

Тип: `object или object`.

## ChatMode

Тип: ``chat`, `plan`, `auto``.

## ChatPart

## ChatPatch

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `title` | string | нет |  |
| `projectId` | string | нет | null — вынести из проекта. |
| `deckId` | string | нет | Вариант сборки, к которому ведёт чат. |

## ChatQuestionOption

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `label` | string | да |  |
| `description` | string | да |  |

## ChatSummary

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `chatId` | string | да |  |
| `title` | string | да |  |
| `projectId` | string | да |  |
| `deckIds` | array&lt;string&gt; | да |  |
| `deckId` | string | да |  |
| `mode` | [ChatMode](/docs/api/reference/schemas/#chatmode) | да |  |
| `createdAt` | string | да |  |
| `updatedAt` | string | да |  |

## ChatToolActivity

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `id` | string | да |  |
| `parentId` | string | нет |  |
| `kind` | `agent`, `tool` | да |  |
| `name` | string | да |  |
| `detail` | string | нет |  |
| `status` | `running`, `done`, `failed`, `cancelled` | да |  |
| `startedAt` | integer | да |  |
| `finishedAt` | integer | нет |  |
| `error` | string | нет |  |

## ChatTurnInput

Тип: `object или object или object`.

## ChatTurnRequest

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `requestId` | string | нет |  |
| `mode` | [ChatMode](/docs/api/reference/schemas/#chatmode) | да |  |
| `model` | — | нет |  |
| `reasoningEffort` | — | нет |  |
| `thinking` | boolean | нет |  |
| `projectId` | string | нет |  |
| `slideCount` | integer | нет |  |
| `deckId` | string | нет |  |
| `input` | [ChatTurnInput](/docs/api/reference/schemas/#chatturninput) | да |  |

## CheckError

Тип: `object или object или object или object или object или object`.

## ColorRef

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `hex` | string | да | Six hex digits when stated outright, otherwise empty. |
| `scheme` | string | да | Theme slot or alias (accent1, tx1, bg2 ...) when it refers to the theme. |
| `transforms` | array&lt;array&lt;string или integer&gt;&gt; | да | lumMod, lumOff, tint, shade and the like, in thousandths of a percent. |

## ColorRole

Тип: ``background`, `surface`, `text`, `text-muted`, `text-on-accent`, `accent`, `accent-alt`, `line`, `positive`, `negative``.

## ColorValue

A palette role, or six hex digits without a hash when a user chose their own.

## ConnectionCheck

Тип: `object или object`.

## ConnectionHeader

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `name` | string | да |  |
| `value` | string | да |  |

## ConnectionInput

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `connectionId` | string | нет |  |
| `name` | string | да |  |
| `preset` | [ConnectionPreset](/docs/api/reference/schemas/#connectionpreset) | да |  |
| `baseUrl` | string | да |  |
| `apiKey` | string | нет |  |
| `lastCheck` | — | нет |  |
| `shared` | boolean | нет |  |
| `headers` | array&lt;[ConnectionHeader](/docs/api/reference/schemas/#connectionheader)&gt; | нет |  |

## ConnectionModelsInput

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `connectionId` | string | да |  |
| `enabledModels` | array&lt;[ModelId](/docs/api/reference/schemas/#modelid)&gt; | да |  |

## ConnectionPreset

Тип: ``vk-ai-space`, `ollama`, `lm-studio`, `vllm`, `custom``.

## Credentials

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `email` | string | да |  |
| `password` | string | да |  |

## DeckOutline

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `title` | string | да |  |
| `audience` | string | да |  |
| `goal` | string | да |  |
| `slides` | array&lt;[OutlineSlide](/docs/api/reference/schemas/#outlineslide)&gt; | да |  |

## DeckPatch

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `title` | string | нет |  |
| `projectId` | string | нет | null — вынести из проекта. |

## DeckSummary

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `runId` | string | да |  |
| `variant` | [LayoutVariant](/docs/api/reference/schemas/#layoutvariant) | да |  |
| `title` | string | да |  |
| `designSystem` | [DesignSystem](/docs/api/reference/schemas/#designsystem) | да |  |
| `templateIr` | [TemplateIR](/docs/api/reference/schemas/#templateir) | да |  |
| `warnings` | array&lt;value&gt; | да |  |
| `imagesMocked` | boolean | да |  |

## DecorElement

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `kind` | `decor` | да |  |
| `elementId` | string | да |  |
| `role` | [ElementRole](/docs/api/reference/schemas/#elementrole) | да |  |
| `box` | [Box](/docs/api/reference/schemas/#box) | да |  |
| `rotation` | number | нет | Clockwise, in degrees, about the centre of the box. Absent means 0. |
| `opacity` | number | нет | From 0 to 1. Absent means opaque. |
| `locked` | boolean | нет | True keeps the editor from selecting or moving the element by accident, as template backgrounds usually are. Absent means false. |
| `groupIds` | array&lt;string&gt; | нет | Groups the element belongs to, outermost first. Elements whose ids start with the same run form one group, and nested runs nest groups, as p:grpSp does in OOXML. Members of a group are consecutive in paint order. Absent: the element is in no group. |
| `sourcePart` | `slide`, `layout`, `master` | нет | Which part the shape was read from. Master and layout graphics are already painted when a slide of that layout is cloned, so an export that keeps the source slide must not draw them again. Absent means the slide itself. |
| `sourceShapeId` | integer | да | Template shape this was placed from. Null when it was drawn in the editor. |
| `shape` | — | нет | Absent for template decoration of a geometry the parser did not name. |
| `geometry` | — | нет | Outline of a geometry `shape` cannot name. When present it is drawn instead. |
| `fill` | — | нет | Null for no fill. Absent when the template did not state one. |
| `stroke` | — | нет | Null for no outline. Absent when the template did not state one. |
| `cornerRadius` | number | нет | Corner radius of a round-rect as a share of the shorter side. Absent means 1/6. |
| `flipH` | boolean | нет | Mirrored horizontally. A line runs from the top left of its box unless flipped. |
| `flipV` | boolean | нет | Mirrored vertically. |
| `paragraphs` | array&lt;[Paragraph](/docs/api/reference/schemas/#paragraph)&gt; | нет | Text inside the shape. Absent when it has none. |
| `verticalAlign` | — | нет | Where the text sits in the shape (the bodyPr anchor). Absent means middle. |
| `textInsets` | — | нет | Absent: the OOXML defaults, 0.1 inch left and right and 0.05 inch top and bottom. |

## DecorGeometry

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `width` | number | да | Width of the space the paths are drawn in. |
| `height` | number | да | Height of the space the paths are drawn in. |
| `paths` | array&lt;object&gt; | да |  |

## DecorShape

Тип: ``rect`, `round-rect`, `ellipse`, `triangle`, `diamond`, `line``.

## DesignSystem

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да | Incremented by any incompatible change. |
| `templateHash` | string | да | Hash of the TemplateIR this was derived from, so the pair can be checked. |
| `aspect` | string | да | Aspect ratio in lowest terms, such as 16:9. |
| `palette` | array&lt;[PaletteEntry](/docs/api/reference/schemas/#paletteentry)&gt; | да | One entry per role the template supports. Roles it lacks are simply absent. |
| `surfaces` | array&lt;[Surface](/docs/api/reference/schemas/#surface)&gt; | да | One per tone the template uses. |
| `typeFamilies` | array&lt;[TypeFamily](/docs/api/reference/schemas/#typefamily)&gt; | да |  |
| `typeScale` | array&lt;[TypeStyle](/docs/api/reference/schemas/#typestyle)&gt; | да | One entry per role in use. |
| `grid` | [Grid](/docs/api/reference/schemas/#grid) | да |  |
| `strokes` | array&lt;[StrokeToken](/docs/api/reference/schemas/#stroketoken)&gt; | да | Outline styles in use, most common first. |
| `radii` | array&lt;[RadiusToken](/docs/api/reference/schemas/#radiustoken)&gt; | да | Corner radii in use, smallest first. |
| `shadows` | [ShadowToken](/docs/api/reference/schemas/#shadowtoken) | да |  |
| `protectedZones` | array&lt;[ProtectedZone](/docs/api/reference/schemas/#protectedzone)&gt; | да |  |
| `warnings` | array&lt;[DesignWarning](/docs/api/reference/schemas/#designwarning)&gt; | да | Empty only when every token was measured with confidence. |

## DesignWarning

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `code` | `observed-overrides-theme`, `font-unavailable`, `low-confidence`, `missing-surface`, `unresolved-color`, `theme-missing` | да |  |
| `token` | string | да | Which token it concerns, such as palette.accent or type.title. |
| `message` | string | да |  |

## EditorConflict

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да |  |
| `conflictId` | string | да |  |
| `expectedRevision` | integer | да |  |
| `server` | [EditorSnapshot](/docs/api/reference/schemas/#editorsnapshot) | да |  |
| `rejected` | object | да |  |

## EditorMediaPutResponse

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да |  |
| `media` | [EditorMediaRef](/docs/api/reference/schemas/#editormediaref) | да |  |

## EditorMediaRef

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `mediaPart` | string | да |  |
| `sha256` | string | да |  |
| `byteSize` | integer | да |  |
| `contentType` | `image/png`, `image/jpeg` | да |  |

## EditorRevisionExportRequest

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да |  |
| `format` | `pptx`, `pdf`, `png`, `html` | да |  |
| `variant` | — | нет |  |
| `slideIds` | array&lt;string&gt; | нет |  |

## EditorRevisionExportResponse

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да |  |
| `exportId` | string | да |  |
| `revision` | integer | да |  |
| `contentSha256` | string | да |  |
| `previews` | array&lt;string&gt; | да |  |

## EditorSnapshot

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да |  |
| `deckId` | string | да | The finished deck this snapshot belongs to. |
| `revision` | integer | да |  |
| `base` | string | да | Fingerprint of the deck the edits started from. |
| `savedAt` | string | да |  |
| `contentSha256` | string | да |  |
| `slides` | array&lt;[SlideIR](/docs/api/reference/schemas/#slideir)&gt; | да |  |
| `media` | array&lt;[EditorMediaRef](/docs/api/reference/schemas/#editormediaref)&gt; | да |  |

## EditorSnapshotLoad

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да |  |
| `snapshot` | — | да |  |

## EditorSnapshotSaveRequest

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да |  |
| `expectedRevision` | integer | да | 0 when the deck has no snapshot yet. Otherwise the revision last read or saved. |
| `idempotencyKey` | string | да |  |
| `base` | string | да |  |
| `slides` | array&lt;[SlideIR](/docs/api/reference/schemas/#slideir)&gt; | да |  |
| `media` | array&lt;[EditorMediaRef](/docs/api/reference/schemas/#editormediaref)&gt; | да |  |

## EditorSnapshotSaveResponse

Тип: `object или object`.

## ElementRole

Тип: ``title`, `subtitle`, `body`, `bullet-list`, `kpi-value`, `kpi-caption`, `quote`, `table`, `chart`, `image`, `logo`, `footer`, `page-number`, `decoration``.

## ElementStroke

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `color` | — | да | A palette role, or a hex value a user chose. |
| `widthEmu` | integer | да | Line width in EMU. |
| `dash` | [StrokeDash](/docs/api/reference/schemas/#strokedash) | да |  |
| `head` | — | да | Mark at the start of a line. |
| `tail` | — | да | Mark at the end of a line. |

## ExportedDeck

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `exportId` | string | да |  |
| `previews` | array&lt;string&gt; | да | Имена превью, если просили PNG или HTML. |

## ExportRequest

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `slides` | array&lt;[SlideIR](/docs/api/reference/schemas/#slideir)&gt; | да | Слайды, как они сейчас в редакторе. |
| `variant` | — | нет |  |
| `format` | `pptx`, `pdf`, `png`, `html` | нет |  |
| `media` | array&lt;object&gt; | нет | PNG/JPEG загруженных изображений, на которые ссылаются слайды; до 1 МиБ каждое и 3 МиБ всего. |

## Fill

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `kind` | `solid`, `gradient`, `image`, `pattern`, `none` | да |  |
| `color` | — | да | Set for a solid fill. |
| `stops` | array&lt;[ColorRef](/docs/api/reference/schemas/#colorref)&gt; | да | Gradient stops in order, for a gradient fill. |

## GenerationRequest

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `variantCopyMode` | — | нет |  |
| `requestId` | string | нет |  |
| `budget` | object | нет |  |
| `outlineSource` | `user`, `model` | нет |  |
| `templateId` | string | да |  |
| `brief` | string | да |  |
| `slideCount` | integer | нет |  |
| `outline` | — | нет |  |
| `projectId` | string | нет |  |
| `contentIds` | array&lt;string&gt; | нет |  |
| `seed` | integer | нет |  |
| `model` | — | нет |  |
| `thinking` | boolean | нет |  |
| `reasoningEffort` | — | нет |  |

## Grid

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `slideCx` | integer | да | Slide width in EMU. |
| `slideCy` | integer | да | Slide height in EMU. |
| `marginLeft` | integer | да |  |
| `marginRight` | integer | да |  |
| `marginTop` | integer | да |  |
| `marginBottom` | integer | да |  |
| `columns` | integer | да | Columns the content area divides into. |
| `gutter` | integer | да | Space between columns in EMU. |
| `baseline` | integer | да | Vertical step layout snaps to, in EMU. |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## HealthCheck

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `status` | `ok`, `degraded`, `down` | да | Current state of the component. |
| `service` | string | да | Name of the component that answered. |
| `version` | string | да | Semantic version of the component. |
| `uptimeSeconds` | number | да | Seconds since the component started. |

## HexColor

Six hex digits, no leading hash.

Тип: `string`.

## ImageCrop

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `l` | number | да | Share of the width cut off on the left. |
| `t` | number | да | Share of the height cut off at the top. |
| `r` | number | да | Share of the width cut off on the right. |
| `b` | number | да | Share of the height cut off at the bottom. |

## ImageElement

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `kind` | `image` | да |  |
| `elementId` | string | да |  |
| `role` | [ElementRole](/docs/api/reference/schemas/#elementrole) | да |  |
| `box` | [Box](/docs/api/reference/schemas/#box) | да |  |
| `rotation` | number | нет | Clockwise, in degrees, about the centre of the box. Absent means 0. |
| `opacity` | number | нет | From 0 to 1. Absent means opaque. |
| `locked` | boolean | нет | True keeps the editor from selecting or moving the element by accident, as template backgrounds usually are. Absent means false. |
| `groupIds` | array&lt;string&gt; | нет | Groups the element belongs to, outermost first. Elements whose ids start with the same run form one group, and nested runs nest groups, as p:grpSp does in OOXML. Members of a group are consecutive in paint order. Absent: the element is in no group. |
| `sourcePart` | `slide`, `layout`, `master` | нет | Which part the shape was read from. Master and layout graphics are already painted when a slide of that layout is cloned, so an export that keeps the source slide must not draw them again. Absent means the slide itself. |
| `sourceShapeId` | integer | да |  |
| `mediaPart` | string | да | Part name inside the template, or a path under the run directory. |
| `fit` | — | да | Never stretch: the audit looks for distortion. |
| `crop` | — | нет | The part of the picture that shows, filling the box. Absent: the whole picture, placed by `fit`. |

## ImageFit

Тип: ``contain`, `cover``.

## JobErrorCode

Тип: ``template-unreadable`, `template-unsupported`, `content-empty`, `model-unavailable`, `model-refused`, `budget-exceeded`, `usage-budget-exceeded`, `account-limit`, `account-disabled`, `engine-failed`, `cancelled`, `interrupted`, `provider-rate-limit`, `provider-auth`, `provider-quota`, `provider-timeout`, `invalid-response`, `quality-blocked`, `export-failed`, `persistence-failed`, `unknown-outcome`, `internal``.

## JobEvent

Тип: `object или object или object или object или object или object или object`.

## JobStage

Тип: ``queued`, `parsing-template`, `profiling-template`, `planning`, `illustrating`, `laying-out`, `rendering`, `auditing`, `exporting``.

## LayoutVariant

Тип: ``dense`, `balanced`, `airy``.

## LayoutVariantName

Тип: ``dense`, `balanced`, `airy``.

## LibraryDeck

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `deck` | [DeckSummary](/docs/api/reference/schemas/#decksummary) | да |  |
| `metadata` | object | да |  |

## LineEnd

Тип: ``none`, `arrow``.

## ListedProject

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `projectId` | string | да |  |
| `name` | string | да |  |
| `appearance` | object | да |  |
| `createdAt` | string | да |  |
| `updatedAt` | string | да |  |
| `pinnedAt` | string | да |  |
| `templateIds` | array&lt;string&gt; | да |  |
| `deckCount` | integer | да | Сборки проекта: три варианта считаются одной колодой. |

## ManualKindsInput

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `modelId` | [ModelId](/docs/api/reference/schemas/#modelid) | да |  |
| `kinds` | array&lt;[ModelKind](/docs/api/reference/schemas/#modelkind)&gt; | да |  |

## MediaItem

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `part` | string | да | Package part name. |
| `contentType` | string | да | File extension, lower-cased. |
| `bytes` | integer | да | Size of the part. |
| `widthPx` | integer | да | Pixel width, null for non-raster parts. |
| `heightPx` | integer | да | Pixel height, null for non-raster parts. |

## ModelBinding

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `role` | `planner`, `writer`, `critic`, `vision`, `image` | да | Role in the pipeline. |
| `modelId` | string | да | Identifier from configs/models.yaml. |

## ModelCapabilities

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `reasoning` | [ReasoningCapability](/docs/api/reference/schemas/#reasoningcapability) | да |  |
| `probed` | boolean | да |  |

## ModelConnection

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `connectionId` | string | да |  |
| `name` | string | да |  |
| `preset` | [ConnectionPreset](/docs/api/reference/schemas/#connectionpreset) | да |  |
| `baseUrl` | string | да |  |
| `hasKey` | boolean | да |  |
| `keyHint` | string | да |  |
| `headers` | array&lt;[ConnectionHeader](/docs/api/reference/schemas/#connectionheader)&gt; | нет |  |
| `lastCheck` | — | да |  |
| `enabledModels` | array&lt;[ModelId](/docs/api/reference/schemas/#modelid)&gt; | нет |  |
| `manualKinds` | object | нет |  |
| `managed` | boolean | да |  |
| `shared` | boolean | нет |  |
| `editable` | boolean | нет |  |

## ModelDetails

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `kinds` | array&lt;[ModelKind](/docs/api/reference/schemas/#modelkind)&gt; | нет |  |
| `reasoning` | — | нет |  |

## ModelFailure

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `kind` | `rate-limit`, `unauthorized`, `quota-exhausted`, `unavailable`, `timeout`, `context`, `unsupported`, `not-configured`, `unknown` | да |  |
| `modelId` | string | нет |  |
| `connectionId` | string | нет |  |
| `retryAt` | integer | нет |  |
| `stage` | `template-index` | нет |  |
| `role` | `planner` | нет |  |
| `httpStatus` | integer | нет |  |

## ModelId

Тип: `string`.

## ModelKind

Тип: ``text`, `vision`, `image`, `speech``.

## ModelRef

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `connectionId` | string | да |  |
| `modelId` | [ModelId](/docs/api/reference/schemas/#modelid) | да |  |

## ModelSettings

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `connections` | array&lt;[ModelConnection](/docs/api/reference/schemas/#modelconnection)&gt; | да |  |
| `roles` | array&lt;[RoleAssignment](/docs/api/reference/schemas/#roleassignment)&gt; | да |  |
| `inheritedRoles` | array&lt;[PipelineRole](/docs/api/reference/schemas/#pipelinerole)&gt; | нет |  |
| `managesShared` | boolean | нет |  |

## ModelSettingsError

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `reason` | `notFound`, `invalid`, `managed`, `unavailable` | да |  |
| `problems` | object | да |  |

## Ok

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `ok` | `true` | да |  |

## OutlineSlide

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `title` | string | да |  |
| `points` | array&lt;string&gt; | да |  |
| `kind` | — | да |  |

## PaletteEntry

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `role` | [ColorRole](/docs/api/reference/schemas/#colorrole) | да |  |
| `hex` | [HexColor](/docs/api/reference/schemas/#hexcolor) | да |  |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## Paragraph

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `level` | integer | да | Indent level, zero at the top. |
| `align` | — | нет | Null or absent when the paragraph inherits its alignment. |
| `runs` | array&lt;[TextRun](/docs/api/reference/schemas/#textrun)&gt; | да | Runs in reading order. |
| `lineSpacing` | number | да | Multiple of single spacing, when stated as a percentage. |
| `bullet` | string | нет | Character the paragraph is bulleted with (`a:buChar`). Absent: no bullet. |
| `marginEmu` | integer | нет | Left margin of the paragraph (`marL`). Absent: inherited, which reads as 0. |
| `indentEmu` | integer | нет | First-line indent against the margin (`indent`); negative hangs the bullet. Absent: 0. |
| `spaceBeforePt` | number | нет | Space above the paragraph in points (`spcBef`). Absent: none. |
| `spaceAfterPt` | number | нет | Space below the paragraph in points (`spcAft`). Absent: none. |

## ParagraphAlign

Тип: ``left`, `center`, `right`, `justify``.

## ParseWarning

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `code` | [ParseWarningCode](/docs/api/reference/schemas/#parsewarningcode) | да |  |
| `message` | string | да | What happened, in a sentence. |
| `location` | string | да | Part name, or a part and shape id. |

## ParseWarningCode

Тип: ``unsupported-shape`, `unresolved-color`, `missing-font-scheme`, `missing-theme`, `embedded-font-ignored`, `unreadable-media`, `no-slide-layout``.

## PipelineRole

Тип: ``assistant`, `planner`, `writer`, `critic`, `vision`, `image`, `speech``.

## PlaceholderRef

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `type` | string | да | Placeholder type, lower-cased and hyphenated. |
| `idx` | integer | да | Placeholder index within the layout. |

## PolicyMetric

Тип: ``generation`, `assistant-response`, `image`, `edit`, `concurrency`, `storage``.

## PrepareRequest

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `templateId` | string | да |  |
| `model` | — | нет | Модель описания макетов; null — роль. |

## ProbeInput

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `connectionId` | string | нет |  |
| `baseUrl` | string | да |  |
| `apiKey` | string | нет |  |
| `headers` | array&lt;[ConnectionHeader](/docs/api/reference/schemas/#connectionheader)&gt; | нет |  |

## ProfilePatch

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `name` | string | нет |  |
| `avatar` | string | нет |  |
| `currentPassword` | string | нет | Нужен, если меняется пароль. |
| `password` | string | нет |  |

## Project

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `projectId` | string | да |  |
| `name` | string | да |  |
| `appearance` | object | да |  |
| `createdAt` | string | да |  |
| `updatedAt` | string | да |  |
| `pinnedAt` | string | да |  |

## ProjectInput

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `name` | string | нет |  |
| `appearance` | object | нет |  |
| `pinned` | boolean | нет |  |

## ProtectedZone

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `role` | `logo`, `footer`, `page-number`, `decoration` | да |  |
| `box` | — | да | Where it sits, in EMU. |
| `mediaPart` | string | да | Image it draws, for a logo. Empty otherwise. |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## QrCodePart

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `type` | `qr-code` | да |  |
| `callId` | string | да |  |
| `qrId` | string | да |  |
| `url` | [QrUrl](/docs/api/reference/schemas/#qrurl) | да |  |
| `pngDataUrl` | string | да |  |
| `sha256` | string | да |  |
| `width` | integer | да |  |
| `height` | integer | да |  |
| `moduleCount` | integer | да |  |
| `minSizeEmu` | integer | да |  |
| `source` | object | да |  |
| `reachability` | object или object | да |  |

## QrUrl

Тип: `string`.

## RadiusToken

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `name` | `sm`, `md`, `lg` | да |  |
| `radiusPt` | number | да |  |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## ReasoningCapability

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `toggle` | `enable-thinking`, `reasoning-effort` | да |  |
| `levels` | boolean | да |  |

## ReasoningEffort

Тип: ``low`, `medium`, `high``.

## RetryVariant

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `buildId` | string | да |  |
| `variant` | [LayoutVariant](/docs/api/reference/schemas/#layoutvariant) | да |  |

## RoleAssignment

Тип: `object или object или object или object`.

## RunConfig

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `templatePath` | string | да | Path to the .pptx used as the style source. |
| `contentPath` | string | да | Path to the content pack for the deck. |
| `slideCount` | integer | да | Number of slides to produce. |
| `layoutVariants` | array&lt;[LayoutVariant](/docs/api/reference/schemas/#layoutvariant)&gt; | да | Layout variants built from the single deck plan. |
| `auditProfile` | string | да | Name of the audit profile from configs/audit.yaml. |
| `models` | array&lt;[ModelBinding](/docs/api/reference/schemas/#modelbinding)&gt; | да | Models bound to pipeline roles. |
| `seed` | integer | да | Seed that makes a run reproducible. |
| `outputDir` | string | да | Directory that receives run artifacts. |
| `goal` | string | нет | What the deck has to achieve. Absent: the first paragraph of the content file. |
| `audience` | string | нет | Who the deck is for. Absent: not stated. |
| `language` | string | нет | BCP 47 tag of the deck. Absent: ru. |

## RunRecord

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `runId` | string | да |  |
| `state` | `queued`, `running`, `done`, `failed` | да |  |
| `createdAt` | string | да |  |
| `updatedAt` | string | да |  |
| `startedAt` | string | да |  |
| `completedAt` | string | да |  |

## ShadowToken

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `present` | boolean | да | False when the template draws no shadows. Do not add any. |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## Shape

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `shapeId` | integer | да | OOXML shape id, unique within its part. |
| `name` | string | да | Name the authoring tool gave the shape. |
| `kind` | string | да | Shape kind: auto-shape, text-box, picture, table, chart, group. |
| `box` | — | да | Null when the shape inherits its position from a layout. |
| `rotation` | number | да | Rotation in degrees, clockwise. |
| `flipH` | boolean | да | Mirrored horizontally. |
| `flipV` | boolean | да | Mirrored vertically. |
| `z` | integer | да | Paint order within the parent, lowest first. |
| `path` | array&lt;integer&gt; | да | Ids of the groups this shape sits in, outermost first. Empty at the top level. |
| `placeholder` | — | да |  |
| `paragraphs` | array&lt;[Paragraph](/docs/api/reference/schemas/#paragraph)&gt; | да | Text of the shape, empty when it carries none. |
| `mediaPart` | string | да | Part name of the image this shape draws, for pictures. |
| `tableSize` | array&lt;integer или integer&gt; | да | Rows and columns, for tables. |
| `chartPart` | string | да | Part name of the chart, for charts. |
| `chartType` | string | да | Chart type, lower-cased and hyphenated. |
| `fill` | — | да | Null when the shape inherits its fill. |
| `stroke` | — | да | Null when the shape inherits its outline. |
| `geometry` | string | да | Preset geometry such as rect or roundRect, empty otherwise. |
| `cornerRadiusEmu` | integer | да | Corner radius of a rounded rectangle, from its adjust value and size. |
| `hasShadow` | boolean | да | Whether the shape states an outer shadow of its own. |

## SlideElement

## SlideIR

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да | Incremented by any incompatible change. |
| `slideId` | string | да | Matches the planned slide, across all three variants. |
| `variant` | [LayoutVariantName](/docs/api/reference/schemas/#layoutvariantname) | да |  |
| `index` | integer | да | Position in the deck, from zero. |
| `patternId` | string | да | Pattern from the template profile this slide was built on. |
| `slideCx` | integer | да | Slide width in EMU, from the template. |
| `slideCy` | integer | да | Slide height in EMU, from the template. |
| `elements` | array&lt;[SlideElement](/docs/api/reference/schemas/#slideelement)&gt; | да | In paint order, lowest first. |
| `background` | — | нет | Colour the slide is filled with. Null or absent: the template background. |
| `backgroundImage` | string | нет | Picture the slide is painted with, stretched over it and drawn above `background`: a part name inside the template or a path under the run directory, as an image `mediaPart`. |
| `notes` | string | нет | Speaker notes as plain text, one paragraph of the notes page (`p:notes`) per line. Absent or empty: the slide has none. |

## SlideKind

Тип: ``cover`, `section`, `statement`, `list`, `cards`, `process`, `comparison`, `problem-solution`, `team`, `closing`, `reference`, `other``.

## SlideLike

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `part` | string | да | Package part name, which identifies it. |
| `name` | string | да | Name from the file, or a generated one for slides. |
| `follows` | string | да | Part this one inherits from: a layout for a slide, a master for a layout. |
| `shapes` | array&lt;[Shape](/docs/api/reference/schemas/#shape)&gt; | да | Shapes in paint order, groups flattened. |
| `background` | — | да | Null when the part inherits its background. |
| `theme` | string | да | For a master, the theme part it uses. Empty below the master. |
| `colorMap` | array&lt;array&lt;string или string&gt;&gt; | да | Alias to slot map (bg1 to lt1 ...). In full on a master, overrides below it. |

## StartedBuild

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `runId` | string | да |  |
| `state` | `queued`, `running`, `done`, `failed` | да |  |
| `createdAt` | string | да |  |
| `updatedAt` | string | да |  |
| `startedAt` | string | да |  |
| `completedAt` | string | да |  |
| `variants` | array&lt;object&gt; | да |  |

## StoredFile

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `fileId` | string | да |  |
| `kind` | `template`, `content`, `artifact` | да |  |
| `fileName` | string | нет |  |
| `size` | integer | нет |  |
| `sha256` | string | нет |  |
| `profile` | — | нет | Профиль шаблона, который вернул движок. |
| `name` | string | нет | Имя шаблона в библиотеке. |
| `shared` | boolean | нет | Шаблон открыт всем аккаунтам. |
| `mine` | boolean | нет | Шаблон загрузил этот аккаунт. |
| `createdAt` | string | нет |  |

## Stroke

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `visible` | boolean | да | False when the outline is explicitly switched off. |
| `color` | — | да |  |
| `widthEmu` | integer | да |  |

## StrokeDash

Тип: ``solid`, `dash`, `dot``.

## StrokeToken

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `widthPt` | number | да |  |
| `hex` | [HexColor](/docs/api/reference/schemas/#hexcolor) | да |  |
| `colorRole` | — | да | Palette role this colour matches, if any. |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## StyleSource

Тип: ``observed`, `theme`, `fallback``.

## Surface

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `tone` | `light`, `dark` | да |  |
| `background` | [HexColor](/docs/api/reference/schemas/#hexcolor) | да |  |
| `text` | — | да | Text colour observed on this surface, or the best contrast. |
| `accent` | — | да | Accent observed on this surface, if any. |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## TableBorders

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `color` | — | да | A palette role, or a hex value a user chose. |
| `widthEmu` | integer | да | Line width in EMU. |
| `horizontal` | boolean | да | A rule under every row, the last one included. |
| `vertical` | boolean | да | Rules between columns. |
| `outer` | boolean | да | A frame around the whole table. |

## TableCellStyle

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `fill` | — | нет | Background of the cell. Null for none, even in a header or banded row. |
| `color` | — | нет | Colour of the text. Absent: the type role. |
| `bold` | boolean | нет | Absent: bold in the header row, regular elsewhere. |
| `italic` | boolean | нет |  |
| `underline` | boolean | нет |  |
| `align` | — | нет | Horizontal alignment. Absent means left. |
| `verticalAlign` | — | нет | Absent means top. |

## TableElement

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `kind` | `table` | да |  |
| `elementId` | string | да |  |
| `role` | [ElementRole](/docs/api/reference/schemas/#elementrole) | да |  |
| `box` | [Box](/docs/api/reference/schemas/#box) | да |  |
| `rotation` | number | нет | Clockwise, in degrees, about the centre of the box. Absent means 0. |
| `opacity` | number | нет | From 0 to 1. Absent means opaque. |
| `locked` | boolean | нет | True keeps the editor from selecting or moving the element by accident, as template backgrounds usually are. Absent means false. |
| `groupIds` | array&lt;string&gt; | нет | Groups the element belongs to, outermost first. Elements whose ids start with the same run form one group, and nested runs nest groups, as p:grpSp does in OOXML. Members of a group are consecutive in paint order. Absent: the element is in no group. |
| `sourcePart` | `slide`, `layout`, `master` | нет | Which part the shape was read from. Master and layout graphics are already painted when a slide of that layout is cloned, so an export that keeps the source slide must not draw them again. Absent means the slide itself. |
| `sourceShapeId` | integer | да |  |
| `headers` | array&lt;string&gt; | да |  |
| `rows` | array&lt;array&lt;string&gt;&gt; | да |  |
| `columnWidths` | array&lt;number&gt; | нет | Share of the box width each column takes, one per header, read relative to their sum. Absent: equal columns. |
| `rowHeights` | array&lt;number&gt; | нет | Share of the box height each row takes, header first, read relative to their sum. A row still grows to fit its text, as a PowerPoint row does. Absent: the rows share the box, each growing to fit its text. |
| `headerRow` | boolean | нет | Whether the first row looks like a header (OOXML firstRow). Absent means true. |
| `bandedRows` | boolean | нет | Whether every other body row is tinted (OOXML bandRow). Absent means false. |
| `bandFill` | — | нет | Fill of the tinted body rows. Absent: the surface role. |
| `borders` | — | нет | Null for no lines. Absent: a hairline in the line role under every row. |
| `cellStyles` | array&lt;array&lt;value&gt;&gt; | нет | Look of each cell, header row first, then by column. A missing or null entry inherits. |

## TemplateIR

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | да | Incremented by any incompatible change. |
| `sourceName` | string | да | File name of the upload, kept out of the hash. |
| `slideCx` | integer | да | Slide width in EMU. |
| `slideCy` | integer | да | Slide height in EMU. |
| `aspect` | string | да | Aspect ratio in lowest terms, such as 16:9. |
| `hash` | string | да | Digest over the canonical IR. Two runs over one file agree; the name is excluded. |
| `themeColors` | array&lt;[ThemeColors](/docs/api/reference/schemas/#themecolors)&gt; | да | One entry per theme part. |
| `themeFonts` | [ThemeFonts](/docs/api/reference/schemas/#themefonts) | да |  |
| `masters` | array&lt;[SlideLike](/docs/api/reference/schemas/#slidelike)&gt; | да |  |
| `layouts` | array&lt;[SlideLike](/docs/api/reference/schemas/#slidelike)&gt; | да |  |
| `slides` | array&lt;[SlideLike](/docs/api/reference/schemas/#slidelike)&gt; | да |  |
| `media` | array&lt;[MediaItem](/docs/api/reference/schemas/#mediaitem)&gt; | да | Inventory of ppt/media, ordered by part name. |
| `warnings` | array&lt;[ParseWarning](/docs/api/reference/schemas/#parsewarning)&gt; | да | Empty when nothing was lost. |

## TemplatePatch

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `name` | string | нет |  |
| `shared` | boolean | нет | Открыть шаблон всем; только администратор. |

## TemplatePreparation

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `readiness` | object | нет |  |
| `stage` | `profile`, `index` | да | Идущий этап; null — подготовки нет. |
| `described` | integer | да |  |
| `total` | integer | да |  |
| `indexed` | boolean | да |  |
| `drawing` | boolean | да |  |
| `drawn` | boolean | да |  |

## TextElement

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `kind` | `text` | да |  |
| `elementId` | string | да |  |
| `role` | [ElementRole](/docs/api/reference/schemas/#elementrole) | да |  |
| `box` | [Box](/docs/api/reference/schemas/#box) | да |  |
| `rotation` | number | нет | Clockwise, in degrees, about the centre of the box. Absent means 0. |
| `opacity` | number | нет | From 0 to 1. Absent means opaque. |
| `locked` | boolean | нет | True keeps the editor from selecting or moving the element by accident, as template backgrounds usually are. Absent means false. |
| `groupIds` | array&lt;string&gt; | нет | Groups the element belongs to, outermost first. Elements whose ids start with the same run form one group, and nested runs nest groups, as p:grpSp does in OOXML. Members of a group are consecutive in paint order. Absent: the element is in no group. |
| `sourcePart` | `slide`, `layout`, `master` | нет | Which part the shape was read from. Master and layout graphics are already painted when a slide of that layout is cloned, so an export that keeps the source slide must not draw them again. Absent means the slide itself. |
| `sourceShapeId` | integer | да | Template shape this was placed from, when it came from one. |
| `paragraphs` | array&lt;[Paragraph](/docs/api/reference/schemas/#paragraph)&gt; | да |  |
| `overflow` | object | да | Null when the text fits. Set instead of truncating it. |
| `verticalAlign` | — | нет | Absent when the element inherits it, which reads as top. |
| `textInsets` | — | нет | Space between the box and its text (`a:bodyPr` insets). Absent: none. |

## TextInsets

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `l` | integer | да |  |
| `t` | integer | да |  |
| `r` | integer | да |  |
| `b` | integer | да |  |

## TextRun

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `text` | string | да | Literal text of the run. |
| `font` | string | да | Typeface named on the run. Empty when it inherits from the theme. |
| `sizePt` | number | да | Size in points, or null when inherited. |
| `bold` | boolean | да | Null when inherited. |
| `italic` | boolean | да | Null when inherited. |
| `underline` | boolean | нет | Null or absent when inherited, which for almost every template means no underline. |
| `color` | string | да | Six-digit hex when the run states a colour. Empty when it inherits one. |
| `letterSpacingPt` | number | нет | Extra space between letters in points, as OOXML `spc`. Null or absent: inherited. |

## ThemeColors

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `name` | string | да | Name the theme gives its colour scheme. |
| `slots` | array&lt;array&lt;string или string&gt;&gt; | да | Slot name and hex value. An empty value means the slot is indirect. |
| `part` | string | да | Theme part this scheme lives in, as a master names it. |

## ThemeFonts

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `majorLatin` | string | да | Latin typeface for headings, as declared. |
| `minorLatin` | string | да | Latin typeface for body text, as declared. |

## TokenMeta

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `source` | [StyleSource](/docs/api/reference/schemas/#stylesource) | да |  |
| `count` | integer | да | Occurrences that support this value. |
| `share` | number | да | Share of the relevant population that agrees. |
| `confidence` | number | да | How far to trust the value. 1 for a measurement nobody contradicts. |
| `parts` | array&lt;string&gt; | да | A few parts it was observed on, so the value can be traced back to the file. |

## ToolStatus

Тип: ``running`, `done`, `failed``.

## TypeFamily

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `role` | `primary`, `secondary`, `mono` | да |  |
| `font` | string | да |  |
| `declared` | string | да | What the theme names for this role. Differs from font when the slides disagree. |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## TypeRole

Тип: ``title`, `subtitle`, `heading`, `body`, `bullet`, `caption`, `kpi-value`, `kpi-caption`, `quote`, `footer``.

## TypeStyle

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `role` | [TypeRole](/docs/api/reference/schemas/#typerole) | да |  |
| `font` | string | да | Typeface to set this role in. |
| `sizePt` | number | да | Size in points. |
| `bold` | boolean | да |  |
| `italic` | boolean | да |  |
| `lineSpacing` | number | да | Multiple of the line height, 1 for single. |
| `colorRole` | — | да | Which palette role this text takes its colour from. |
| `meta` | [TokenMeta](/docs/api/reference/schemas/#tokenmeta) | да |  |

## ValidatedInputs

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `template` | object | да |  |
| `content` | object | да |  |
| `outputDir` | string | да |  |

## VariantCopyMode

Тип: ``independent`, `shared``.

## VariantReview

Тип: `object`.

| Поле | Тип | Обязательно | Описание |
| --- | --- | --- | --- |
| `errors` | integer | да |  |
| `warnings` | integer | да |  |
| `status` | `complete`, `requires-review`, `unknown` | нет |  |
| `contentRevision` | integer | нет |  |
| `contentHash` | string | нет |  |

## VerticalAlign

Тип: ``top`, `middle`, `bottom``.
