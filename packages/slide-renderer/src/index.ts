export {
  EMU_PER_PT,
  boxStyle,
  boxToRect,
  cqw,
  emuToCqw,
  ptToCqw,
  slideSizeOf,
  type SlideRect,
  type SlideSize,
} from './geometry.js';
export { SlideFrame, type SlideFrameProps } from './slide-frame.js';
export { SlideSchematic, type SlideSchematicProps } from './schematic/slide-schematic.js';
export { createTypeResolver, typeRoleOf, type TypeResolver } from './schematic/text-layout.js';
export { SlideView, type SlideViewProps } from './slide-view.js';
export {
  fontFamily,
  genericFamily,
  isHexColor,
  paint,
  resolveColor,
  seriesPaint,
  seriesRoles,
} from './view/color.js';
export { markHooks, markStyle } from './view/mark.js';
export {
  TABLE_CELL_PADDING,
  TableColumns,
  isBandedRow,
  isHeaderRow,
  tableBordersOf,
  tableCellLook,
  tableView,
  trackShares,
  type TableCellLook,
  type TableView,
} from './view/table.js';
export { cropPlacement } from './view/marks.js';
export { decorFill } from './view/decor.js';
export {
  DEFAULT_TEXT_INSETS,
  SHAPE_TEXT_ROLE,
  holdsText,
  shapeTextColor,
  shapeTextLook,
  shapeTextPadding,
} from './view/shape-text.js';
