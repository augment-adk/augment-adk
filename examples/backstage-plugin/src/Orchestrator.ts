/**
 * ADK Orchestrator for Backstage
 *
 * Bridges the Backstage plugin's Express routes to the ADK's
 * `run()` and `runStream()` functions. This is the central
 * integration point.
 *
 * Simplified from:
 * https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/
 *   workspaces/augment/plugins/augment-backend/src/providers/llamastack/
 *   adk-adapters/AdkOrchestrator.ts
 */
import {
  run as adkRun,
  runStream,
  type RunOptions,
  type ILogger,
  type FunctionTool,
  type AgentConfig,
  type EffectiveConfig,
  type MCPServerConfig,
  type Model,
} from '@augment-adk/augment-adk';
import { mapAdkEventToFrontend } from './streamEventMapper';

/**
 * Chat request from the frontend (simplified).
 */
export interface ChatRequest {
  messages: Array<{ role: string; content: string }>;
  conversationId?: string;
}

/**
 * Chat response to the frontend (simplified).
 */
export interface ChatResponse {
  role: 'assistant';
  content: string;
  agentName?: string;
  handoffPath?: string[];
  toolCalls?: Array<{ name: string; arguments: string; output?: string }>;
  pendingApprovals?: Array<{
    toolName: string;
    arguments: string;
    approvalRequestId: string;
  }>;
}

export interface OrchestratorOptions {
  model: Model;
  config: EffectiveConfig;
  agents: Record<string, AgentConfig>;
  defaultAgent: string;
  mcpServers?: MCPServerConfig[];
  functionTools?: FunctionTool[];
  logger: ILogger;
  maxAgentTurns?: number;
}

/**
 * Bridges Backstage routes to ADK run()/runStream().
 *
 * The real Backstage plugin rebuilds `RunOptions` per-request
 * by resolving the agent graph and discovering tools from MCP servers.
 * This simplified version takes static options.
 */
export class Orchestrator {
  private readonly options: OrchestratorOptions;

  constructor(options: OrchestratorOptions) {
    this.options = options;
  }

  /**
   * Non-streaming chat. Used by POST /chat.
   */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const userInput = this.extractLastUserMessage(request);
    const runOptions = this.buildRunOptions(request.conversationId);

    const result = await adkRun(userInput, runOptions);

    return {
      role: 'assistant',
      content: result.content,
      agentName: result.agentName,
      handoffPath: result.handoffPath,
      toolCalls: result.toolCalls?.map(t => ({
        name: t.name,
        arguments: t.arguments ?? '',
        output: t.output,
      })),
      pendingApprovals: result.pendingApprovals?.map(a => ({
        toolName: a.toolName,
        arguments: a.arguments,
        approvalRequestId: a.approvalRequestId ?? '',
      })),
    };
  }

  /**
   * Streaming chat. Used by POST /chat/stream.
   *
   * Emits events as JSON strings that the frontend reducer handles.
   * Raw model events are normalized via normalizeLlamaStackEvent().
   */
  async chatStream(
    request: ChatRequest,
    onEvent: (eventJson: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const userInput = this.extractLastUserMessage(request);
    const runOptions: RunOptions = {
      ...this.buildRunOptions(request.conversationId),
      signal,
    };

    const streamed = runStream(userInput, runOptions);

    for await (const event of streamed) {
      const frontendEvents = mapAdkEventToFrontend(event);
      for (const fe of frontendEvents) {
        onEvent(fe);
      }
    }

    const result = streamed.result;
    onEvent(JSON.stringify({
      type: 'stream.completed',
      usage: result.usage,
      agentName: result.agentName,
    }));
  }

  private buildRunOptions(conversationId?: string): RunOptions {
    return {
      model: this.options.model,
      agents: this.options.agents,
      defaultAgent: this.options.defaultAgent,
      config: this.options.config,
      mcpServers: this.options.mcpServers,
      functionTools: this.options.functionTools,
      conversationId,
      logger: this.options.logger,
      maxAgentTurns: this.options.maxAgentTurns,
    };
  }

  private extractLastUserMessage(request: ChatRequest): string {
    for (let i = request.messages.length - 1; i >= 0; i--) {
      if (request.messages[i].role === 'user') {
        return request.messages[i].content;
      }
    }
    throw new Error('No user message found in chat request');
  }
}
