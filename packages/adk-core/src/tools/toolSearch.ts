import type { FunctionTool } from './tool';
import type { ResolvedToolInfo } from './toolResolver';

/**
 * Interface for deferred tool loading.
 *
 * When the model requests a tool that isn't in the current tool set,
 * the framework can call a ToolSearchProvider to discover and load
 * the tool on demand. This is useful for large tool catalogs where
 * loading all tools upfront is impractical.
 *
 * Works with LlamaStack's `/v1/tool-runtime/list-tools` endpoint
 * for server-side tool discovery.
 */
export interface ToolSearchProvider {
  /**
   * Search for tools matching the given query or name.
   * Returns matching tools that can be registered and used.
   */
  search(query: string): Promise<ToolSearchResult[]>;
}

export interface ToolSearchResult {
  tool: FunctionTool | ResolvedToolInfo;
  relevance?: number;
}

/**
 * A static tool search provider backed by a pre-loaded catalog.
 * Performs simple substring matching on tool names and descriptions.
 */
export class StaticToolSearchProvider implements ToolSearchProvider {
  private readonly catalog: Array<FunctionTool | ResolvedToolInfo>;

  constructor(tools: Array<FunctionTool | ResolvedToolInfo>) {
    this.catalog = tools;
  }

  async search(query: string): Promise<ToolSearchResult[]> {
    const lower = query.toLowerCase();
    return this.catalog
      .filter(tool => {
        const name = 'prefixedName' in tool ? tool.prefixedName : tool.name;
        const desc = tool.description.toLowerCase();
        return name.toLowerCase().includes(lower) || desc.includes(lower);
      })
      .map(tool => ({ tool, relevance: 1.0 }));
  }
}

/**
 * A tool search provider that delegates to a remote API
 * (e.g. LlamaStack's tool-runtime/list-tools endpoint).
 */
export class RemoteToolSearchProvider implements ToolSearchProvider {
  private readonly fetcher: (query: string) => Promise<ToolSearchResult[]>;

  constructor(fetcher: (query: string) => Promise<ToolSearchResult[]>) {
    this.fetcher = fetcher;
  }

  async search(query: string): Promise<ToolSearchResult[]> {
    return this.fetcher(query);
  }
}
