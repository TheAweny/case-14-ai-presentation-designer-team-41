import type { Messages } from 'next-intl';
import canvasMenu from './canvas-menu.json';
import designPanel from './design-panel.json';
import draft from './draft.json';
import editor from './editor.json';
import exportDialog from './export-dialog.json';
import fileBar from './file-bar.json';
import formatBar from './format-bar.json';
import imageCrop from './image-crop.json';
import inspectorFields from './inspector-fields.json';
import layersPanel from './layers-panel.json';
import localeSwitcher from './locale-switcher.json';
import metadata from './metadata.json';
import mobileBar from './mobile-bar.json';
import selectionBar from './selection-bar.json';
import shortcuts from './shortcuts.json';
import slideList from './slide-list.json';
import slideShow from './slide-show.json';
import speakerNotes from './speaker-notes.json';
import tableMenu from './table-menu.json';
import tablePanel from './table-panel.json';
import toolRail from './tool-rail.json';

/** Перевод повторяет состав исходного словаря: пропущенную строку поймает проверка типов. */
const messages = {
  metadata,
  localeSwitcher,
  editor,
  exportDialog,
  fileBar,
  selectionBar,
  formatBar,
  toolRail,
  designPanel,
  imageCrop,
  speakerNotes,
  canvasMenu,
  inspectorFields,
  shortcuts,
  draft,
  slideShow,
  mobileBar,
  tableMenu,
  tablePanel,
  layersPanel,
  slideList,
} satisfies Messages;

export default messages;
