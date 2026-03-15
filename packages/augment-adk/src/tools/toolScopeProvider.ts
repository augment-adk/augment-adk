/**
 * Interface for semantic tool scoping.
 *
 * Implementations filter tools by relevance to the user's query,
 * reducing the number of tools sent to the model when there are
 * many available (prevents context window overflow).
 *
 * The ADK ships this as an interface only. A full TF-IDF or
 * embedding-based implementation can be provided as a separate
 * package (e.g. `@augment-adk/toolscope`).
 */
export interface ToolScopeProvider {
  /**
   * Update the internal index with the current set of tool descriptors.
   */
  updateIndex(descriptors: ToolDescriptor[]): void;

  /**
   * Filter tools by relevance to the given query.
   *
   * @param query - The user's natural language query
   * @param maxTools - Maximum tools to return
   * @param serverIds - Optional filter by server IDs
   * @param minScore - Minimum relevance score threshold
   * @returns Filtered tool names grouped by server
   */
  filterTools(
    query: string,
    maxTools: number,
    serverIds?: string[],
    minScore?: number,
  ): ToolScopeResult;
}

export interface ToolDescriptor {
  serverId: string;
  name: string;
  description: string;
}

export interface ToolScopeResult {
  scopedTools: Map<string, string[]>;
  durationMs: number;
}
