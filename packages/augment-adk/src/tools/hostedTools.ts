import type {
  ResponsesApiWebSearchTool,
  ResponsesApiFileSearchTool,
} from '../types/responsesApi';

export interface WebSearchToolOptions {
  userLocation?: {
    type: 'approximate';
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
  searchContextSize?: 'low' | 'medium' | 'high';
}

/**
 * Create a hosted web search tool definition for the Responses API.
 *
 * The web search is executed server-side by the LlamaStack provider;
 * no local execution handler is needed.
 */
export function webSearchTool(options?: WebSearchToolOptions): ResponsesApiWebSearchTool {
  const tool: ResponsesApiWebSearchTool = { type: 'web_search' };
  if (options?.userLocation) {
    tool.user_location = options.userLocation;
  }
  if (options?.searchContextSize) {
    tool.search_context_size = options.searchContextSize;
  }
  return tool;
}

export interface FileSearchToolOptions {
  vectorStoreIds: string[];
  maxNumResults?: number;
  rankingOptions?: {
    ranker?: string;
    scoreThreshold?: number;
  };
}

/**
 * Create a hosted file search tool definition for the Responses API.
 *
 * File search is executed server-side against configured vector stores.
 */
export function fileSearchTool(options: FileSearchToolOptions): ResponsesApiFileSearchTool {
  const tool: ResponsesApiFileSearchTool = {
    type: 'file_search',
    vector_store_ids: options.vectorStoreIds,
  };
  if (options.maxNumResults !== undefined) {
    tool.max_num_results = options.maxNumResults;
  }
  if (options.rankingOptions) {
    tool.ranking_options = {
      ranker: options.rankingOptions.ranker,
      score_threshold: options.rankingOptions.scoreThreshold,
    };
  }
  return tool;
}
