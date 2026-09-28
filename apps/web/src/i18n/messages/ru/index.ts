import assistant from './assistant.json';
import auth from './auth.json';
import auditPanel from './audit-panel.json';
import canvasMenu from './canvas-menu.json';
import composer from './composer.json';
import designPanel from './design-panel.json';
import draft from './draft.json';
import editor from './editor.json';
import exportDialog from './export-dialog.json';
import fileBar from './file-bar.json';
import formatBar from './format-bar.json';
import home from './home.json';
import imageCrop from './image-crop.json';
import inspectorFields from './inspector-fields.json';
import layersPanel from './layers-panel.json';
import library from './library.json';
import libraryMenu from './library-menu.json';
import localeSwitcher from './locale-switcher.json';
import metadata from './metadata.json';
import mobileBar from './mobile-bar.json';
import deckChat from './deck-chat.json';
import projectAppearance from './project-appearance.json';
import projectPage from './project-page.json';
import selectionBar from './selection-bar.json';
import settings from './settings.json';
import shortcuts from './shortcuts.json';
import slideList from './slide-list.json';
import slideShow from './slide-show.json';
import splash from './splash.json';
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
  auditPanel,
  slideList,
  library,
  libraryMenu,
  home,
  projectPage,
  projectAppearance,
  composer,
  deckChat,
  assistant,
  splash,
  settings,
  auth,
};

export default messages;
