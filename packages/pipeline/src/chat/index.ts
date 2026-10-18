export {
  OpenAICompatibleChatModel,
  ThinkingFilter,
  type ChatModel,
  type ModelMessage,
  type ModelStep,
  type ModelStepRequest,
  type OpenAICompatibleChatOptions,
  type ToolCall,
  type ToolSpec,
} from './chat-model.js';
export {
  AnswerWriter,
  CHAT_AGENT_ID,
  chatInstructions,
  loadChatAgent,
  modelHistory,
  runChatTurn,
  toolSpecs,
  closeToolPart,
  mergeToolActivity,
  type ChatAgent,
  type ChatEventBody,
  type ChatTool,
  type ChatTurnOptions,
  type ChatTurnResult,
  type ToolContext,
  type ToolOutcome,
} from './agent.js';
export { ChatToolDispatcher, type ToolDispatcherOptions } from './tool-runtime.js';

export { ModelRequestError, modelHttpFailure, modelFailureOf } from './model-failure.js';
export {
  loadMaterialResearchAgent,
  researchMaterials,
  type MaterialResearchOptions,
} from './material-research.js';
