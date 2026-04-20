import type { ChatCompletionResult, ChatMessage, ChatOptions, LLMUsage } from "../base-provider.js";
import { BaseLLMProvider } from "../base-provider.js";
import { OpenAIProvider } from "./openai.provider.js";
import { sidecarModelService } from "../../sidecar/sidecar-model.service.js";
import { sidecarProcessService } from "../../sidecar/sidecar-process.service.js";
import { resolveSidecarRequestModel } from "../../sidecar/sidecar-request-model.js";

export class LocalSidecarProvider extends BaseLLMProvider {
  constructor() {
    super("", "");
  }

  private async createDelegate(): Promise<OpenAIProvider> {
    const baseUrl = await sidecarProcessService.ensureReady(true);
    const contextSize = sidecarModelService.getConfig().contextSize;
    return new OpenAIProvider(`${baseUrl}/v1`, "local-sidecar", contextSize, null);
  }

  private getRequestModel(): string {
    return resolveSidecarRequestModel(
      sidecarModelService.getResolvedBackend(),
      sidecarModelService.getConfiguredModelRef(),
    );
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string, LLMUsage | void, unknown> {
    const delegate = await this.createDelegate();
    return yield* delegate.chat(messages, {
      ...options,
      model: this.getRequestModel(),
    });
  }

  async chatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    const delegate = await this.createDelegate();
    return delegate.chatComplete(messages, {
      ...options,
      model: this.getRequestModel(),
    });
  }

  async embed(_texts: string[], _model: string): Promise<number[][]> {
    throw new Error("The local sidecar does not support embeddings.");
  }
}
