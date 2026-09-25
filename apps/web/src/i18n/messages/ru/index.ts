import canvasMenu from './canvas-menu.json';
import designPanel from './design-panel.json';
import draft from './draft.json';
import editor from './editor.json';
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

/**
 * Исходный словарь, по нему next-intl проверяет ключи. Один файл — одно пространство имён:
 * `file-bar.json` лежит под ключом `fileBar` и относится к компоненту `file-bar.tsx`.
 */
const messages = {
  metadata,
  localeSwitcher,
  editor,
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
};

export default messages;
