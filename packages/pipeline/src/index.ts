export {
  createMastra,
  DEFAULT_STORAGE_URL,
  ensureLocalStorageDirectory,
  type PipelineOptions,
} from './mastra.js';
export { PIPELINE_STEP_IDS, pipelineSteps, type PipelineStepId } from './steps.js';
export {
  RunLifecycle,
  type LifecycleArtifact,
  type LifecycleStage,
  type LifecycleStageContext,
  type RunLifecycleOptions,
  type RunLifecycleResult,
} from './run-lifecycle.js';
export {
  CONTEXTUAL_CHECKS,
  CONTEXTUAL_CHECK_IDS,
  type ContextualCheck,
} from './audit/contextual-checks.js';
export {
  createProvider,
  DEFAULT_RECORDINGS_DIR,
  extractJson,
  InvalidModelAnswerError,
  OpenAICompatibleProvider,
  RecordedProvider,
  requestKey,
  runAgent,
  type AgentUsage,
  type ModelProvider,
  type ModelRequest,
  type OpenAICompatibleOptions,
  type ProviderEnv,
  type RecordedProviderOptions,
} from './models/index.js';
export {
  buildContentPack,
  checkGrounding,
  planDeck,
  type ContentPackInput,
  type GroundingProblem,
  type PlanDeckOptions,
  type PlanDeckResult,
  type SourceDocument,
} from './planner/index.js';
export {
  findingsOf,
  runContextualAudit,
  type ContextualAuditOptions,
  type ContextualAuditResult,
} from './audit/contextual-audit.js';
export {
  generateDeck,
  GenerateDeckError,
  type BoundAgent,
  type GenerateDeckOptions,
  type GenerateDeckResult,
  type VariantResult,
} from './orchestrator/index.js';
export { findOverflows, fitCopy, type CopyTarget, type FitCopyResult } from './writer/index.js';
export { VisionProvider, type VisionProviderOptions } from './generation/vision-provider.js';
export {
  reviewVariantVisually,
  type VisualReview,
  type VisualReviewOptions,
} from './generation/visual-review.js';
export {
  OpenAICompatibleProvider as GenerationProvider,
  RoutedTextProvider,
  type TextProvider,
} from './generation/provider.js';
export {
  createGenerationWorkflow,
  validateBindings,
  compositionPlanSchema,
  critiqueSchema,
  type GenerationDependencies,
  variantCatalog,
  remapPlan,
  SharedPlan,
  type DeckVariant,
  type LayoutRemapPolicy,
  prepareVariantCatalog,
} from './generation/workflow.js';
export {
  compareLayoutRemap,
  LayoutRemapComparisonError,
  type LayoutRemapComparison,
} from './generation/remap-evaluation.js';
export { generatePresentation, type GenerateOptions } from './generation/runner.js';
export {
  AttemptBudget,
  DEFAULT_ATTEMPT_BUDGET,
  type AttemptBudgetSnapshot,
} from './generation/attempt-budget.js';
export {
  FakeImageProvider,
  OpenAICompatibleImageProvider,
  sizeFor,
  type ImageProvider,
} from './generation/images.js';
export { SharedIllustrations, styleOf, type Illustration } from './generation/illustrations.js';
export {
  currentTemplateIndexRevision,
  indexTemplate,
  indexTemplateWithAgent,
  templateIndexRevision,
  type IndexProgress,
} from './generation/indexer.js';
export * from './chat/index.js';
export {
  generateQrCode,
  minimumQrSizeEmu,
  qrUrlsInText,
  type QrCodeImage,
} from './assets/qr-code.js';
