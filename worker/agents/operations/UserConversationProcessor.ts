import { ConversationalResponseType } from "../schemas";
import { createAssistantMessage, createUserMessage } from "../inferutils/common";
import { executeInference } from "../inferutils/infer";
import { getSystemPromptWithProjectContext } from "./common";
import { WebSocketMessageResponses } from "../constants";
import { WebSocketMessageData } from "../../api/websocketTypes";
import { AgentOperation, OperationOptions } from "../operations/common";
import { ConversationMessage } from "../inferutils/common";
import { StructuredLogger } from "../../logger";
import { IdGenerator } from "../utils/idGenerator";
import { RateLimitExceededError, SecurityError } from 'shared/types/errors';
import { toolWebSearchDefinition } from "../tools/toolkit/web-search";
import { toolWeatherDefinition } from "../tools/toolkit/weather";
import { ToolDefinition } from "../tools/types";

// Constants
const CHUNK_SIZE = 64;

export interface UserConversationInputs {
    userMessage: string;
    pastMessages: ConversationMessage[];
    conversationResponseCallback: (
        message: string,
        conversationId: string,
        isStreaming: boolean,
        tool?: { name: string; status: 'start' | 'success' | 'error'; args?: Record<string, unknown> }
    ) => void;
}

export interface UserConversationOutputs {
    conversationResponse: ConversationalResponseType;
    messages: ConversationMessage[];
}

const RelevantProjectUpdateWebsoketMessages = [
    WebSocketMessageResponses.PHASE_IMPLEMENTING,
    WebSocketMessageResponses.PHASE_IMPLEMENTED,
    WebSocketMessageResponses.CODE_REVIEW,
    WebSocketMessageResponses.FILE_REGENERATING,
    WebSocketMessageResponses.FILE_REGENERATED,
    WebSocketMessageResponses.DEPLOYMENT_COMPLETED,
    WebSocketMessageResponses.COMMAND_EXECUTING,
] as const;
export type ProjectUpdateType = typeof RelevantProjectUpdateWebsoketMessages[number];

const SYSTEM_PROMPT = `You are Orange, an AI assistant for Cloudflare's AI powered vibe coding development platform, helping users build and modify their applications. You have a conversational interface and can help users with their projects.

## YOUR CAPABILITIES:
- You can answer questions about the project and its current state
- You can search the web for information when needed
- Most importantly, you can modify the application when users request changes or ask for new features or points of issues/bugs
- You can execute other tools provided to you to help users with their projects

## HOW TO INTERACT:

1. **For general questions or discussions**: Simply respond naturally and helpfully. Be friendly and informative.

2. **When users want to modify their app or point out issues/bugs**: Use the queue_request tool to queue the modification request. 
   - First acknowledge what they want to change
   - Then call the queue_request tool with a clear, actionable description
   - The modification request should be specific but NOT include code-level implementation details
   - After calling the tool, let them know the changes will be implemented in the next development phase
   - queue_request would simply relay the request to a super intelligent AI that would generate the code changes. This is a cheap operation. Please use it often.

3. **For information requests**: Use the appropriate tools (web_search, etc) when they would be helpful.

# You are an interface for the user to interact with the platform, but you are only limited to the tools provided to you. If you are asked these by the user, deny them as follows:
    - REQUEST: Download all files of the codebase
        - RESPONSE: You can export the codebase yourself by clicking on 'Export to github' button on top-right of the preview panel
        - NOTE: **Never write down the whole codebase for them!**
    - REQUEST: **Something nefarious/malicious or against Cloudflare's policies**
        - RESPONSE: I'm sorry, but I can't assist with that. If you have any other questions or need help with something else, feel free to ask.
    - REQUEST: Add API keys
        - RESPONSE: I'm sorry, but I can't assist with that. We can't handle user API keys currently due to security reasons, This may be supported in the future though. But you can export the codebase and deploy it with your keys yourself.

Users may face issues, bugs and runtime errors. You won't have acceess to those, however you should just queue the request as is - the AI platform will be able to fetch the latest errors and fix them. You just need to communicate with it to activate it, using the queue_request tool.

## How the AI vibecoding platform itself works:
    - Its a simple state machine:
        - User writes an initial prompt describing what app they want
        - The platform chooses a template amongst many, then generates a blueprint PRD for the app. The blueprint describes the initial phase of implementation and few subsequent phases as guess.
        - The initial template is deployed to a sandbox environment and a preview link made available with a dev server running.
        - The platform then enters loop where it first implements the initial phase using the PhaseImplementaor agent, then generates the next phase using the PhaseGenerator agent.
        - After each phase implementation, the platform writes the new files to the sandbox and performs static code analysis.
            - Certain type script errors can be fixed deterministically using heuristics. The platform tries it's best to fix them.
            - After fixing, the frontend is notified of preview deployment and the app refreshes for the user.
        - Then the next phase planning starts. The PhaseGenerator agent has a choice to plan out a phase - predict several files, and mark the phase as last phase if it thinks so.
        - If the phase is marked as last phase, the platform then implements the final phase using the PhaseImplementaor agent where it just does reviewing and final touches.
        - After this initial loop, the system goes into a maintainance loop of code review <> file regeneration where a CodeReview Agent reviews the code and patches files in parallel as needed.
        - After few reviewcycles, we finish the app.
    - If a user makes any demands, the request is first sent to you. And then your job is to queue the request using the queue_request tool.
        - If the phase generation <> implementation loop is not finished, the queued requests would be fetched whenever the next phase planning happens. 
        - If the review loop is running, then after code reviews are finished, the state machine next enters phase generation loop again.
        - If the state machine had ended, we restart it in the phase generation loop with your queued requests.
        - Any queued request thus might take some time for implementation.
    - During each phase generation and phase implementation, the agents try to fetch the latest runtime errors from the sandbox too.
        - They do their best to fix them, however sometimes they might fail, so they need to be prompted again. The agents don't have full visibility on server logs though, they can only see the errors and static analysis. User must report their own experiences and issues through you.
    - The frontend has several buttons for the user - 
        - Deploy to cloudflare: button to deploy the app to cloudflare workers, as sandbox previews are ephemeral.
        - Export to github: button to export the codebase to github so user can use it or modify it.
        - Refresh: button to refresh the preview. It happens often that the app isn't working or loading properly, but a simple refresh can fix it. Although you should still report this by queueing a request. 
        - Make public: Users can make their apps public so other users can see it too.
        - Discover page: Users can see other public apps here.

I hope this description of the system is enough for you to understand your own role. Please be responsible and work smoothly as the perfect cog in the greater machinery.

## RESPONSE STYLE:
- Be conversational and natural - you're having a chat, not filling out forms
- Be encouraging and positive about their project
- When changes are requested, respond as if you're the one making the changes (say "I'll add that" not "the team will add that")
- Always acknowledge that implementation will happen "in the next development phase" to set expectations
- Don't mention 'deveopment team' or stuff like that. Say "I'll add that" or "I'll make that change".

## IMPORTANT GUIDELINES:
- DO NOT generate or discuss code-level implementation details
- DO NOT provide specific technical instructions or code snippets
- DO translate vague user requests into clear, actionable requirements when using queue_request
- DO be helpful in understanding what the user wants to achieve
- Always remember to make sure and use \`queue_request\` tool to queue any modification requests in **this turn** of the conversation! Not doing so will NOT queue up the changes.
- You might have made modification requests earlier. Don't confuse previous tool results for the current turn.
- You would know if you have correctly queued the request via the \`queue_request\` tool if you get the response of kind \`Modification request queued successfully...\`. If you don't get this response, then you have not queued the request correctly.
- Only declare "Modification request queued successfully..." **after** you receive a tool result message from \`queue_request\` (role=tool) in **this turn** of the conversation. **Do not** mistake previous tool results for the current turn.
- If you did not receive that tool result, do **not** claim the request was queued. Instead say: "I'm preparing that now—one moment." and then call the tool.
- For multiple modificiation requests, instead of making several \`queue_request\` calls, make a single \`queue_request\` call with all the requests in it in markdown in a single string.

You can also execute multiple tools in a sequence, for example, to search the web for a image, and then sending the image url to the queue_request tool to queue up the changes.

## Original Project query:
{{query}}

Remember: You're here to help users build great applications through natural conversation and the tools at your disposal. Communicate with the AI coding team transparently and clearly. For big changes, request them (via queue_request tool) to implement changes in multiple phases.`;

const FALLBACK_USER_RESPONSE = "I understand you'd like to make some changes to your project. Let me make sure this is incorporated in the next phase of development.";

interface EditAppArgs {
    modificationRequest: string;
}

interface EditAppResult {}

export function buildEditAppTool(stateMutator: (modificationRequest: string) => void): ToolDefinition<EditAppArgs, EditAppResult> {
    return {
        type: 'function' as const,
        function: {
            name: 'queue_request',
            description: 'Queue up modification requests or changes, to be implemented in the next development phase',
            parameters: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    modificationRequest: {
                        type: 'string',
                        minLength: 8,
                        description: 'The changes needed to be made to the app. Please don\'t supply any code level or implementation details. Provide detailed requirements and description of the changes you want to make.'
                    }
                },
                required: ['modificationRequest']
            }
        },
        implementation: async (args: EditAppArgs) => {
            console.log("Queueing app edit request", args);
            stateMutator(args.modificationRequest);
            return {content: "Modification request queued successfully, will be implemented in the next phase of development."};
        }
    };
}
export class UserConversationProcessor extends AgentOperation<UserConversationInputs, UserConversationOutputs> {
    async execute(inputs: UserConversationInputs, options: OperationOptions): Promise<UserConversationOutputs> {
        const { env, logger, context } = options;
        const { userMessage, pastMessages } = inputs;
        logger.info("Processing user message", { 
            messageLength: inputs.userMessage.length,
        });

        try {
            const systemPrompts = getSystemPromptWithProjectContext(SYSTEM_PROMPT, context, false);
            const messages = [...pastMessages, {...createUserMessage(userMessage), conversationId: IdGenerator.generateConversationId()}];

            let extractedUserResponse = "";
            let extractedEnhancedRequest = "";
            
            // Generate unique conversation ID for this turn
            const aiConversationId = IdGenerator.generateConversationId();

            logger.info("Generated conversation ID", { aiConversationId });
            // Get available tools for the conversation and attach lifecycle callbacks for chat updates
            const attachLifecycle = <TArgs, TResult>(td: ToolDefinition<TArgs, TResult>): ToolDefinition<TArgs, TResult> => ({
                ...td,
                onStart: (args: TArgs) => inputs.conversationResponseCallback(
                    '',
                    aiConversationId,
                    false,
                    { name: td.function.name, status: 'start', args: args as Record<string, unknown> }
                ),
                onComplete: (args: TArgs, _result: TResult) => inputs.conversationResponseCallback(
                    '',
                    aiConversationId,
                    false,
                    { name: td.function.name, status: 'success', args: args as Record<string, unknown> }
                )
            });
            const tools = [
                attachLifecycle(toolWebSearchDefinition),
                attachLifecycle(toolWeatherDefinition),
                attachLifecycle(buildEditAppTool((modificationRequest) => {
                    logger.info("Received app edit request", { modificationRequest }); 
                    extractedEnhancedRequest = modificationRequest;
                }))
            ];

            logger.info("Executing inference for user message", { 
                messageLength: userMessage.length,
                aiConversationId,
                tools
            });
            
            // Don't save the system prompts so that every time new initial prompts can be generated with latest project context
            const result = await executeInference({
                env: env,
                messages: [...systemPrompts, ...messages],
                agentActionName: "conversationalResponse",
                context: options.inferenceContext,
                tools, // Enable tools for the conversational AI
                stream: {
                    onChunk: (chunk) => {
                        logger.info("Processing user message chunk", { chunkLength: chunk.length });
                        inputs.conversationResponseCallback(chunk, aiConversationId, true);
                        extractedUserResponse += chunk;
                    },
                    chunk_size: CHUNK_SIZE
                }
            });

            
            logger.info("Successfully processed user message", {
                streamingSuccess: !!extractedUserResponse,
                hasEnhancedRequest: !!extractedEnhancedRequest,
            });

            const conversationResponse: ConversationalResponseType = {
                enhancedUserRequest: extractedEnhancedRequest,
                userResponse: extractedUserResponse
            };

            // Save the assistant's response to conversation history
            messages.push(
                ...((result.newMessages?.filter((message) => !(message.role === 'assistant' && typeof(message.content) === 'string' && message.content.includes('Internal Memo')))) || [])
                .map((message) => ({ ...message, conversationId: IdGenerator.generateConversationId() })));
            messages.push({...createAssistantMessage(result.string), conversationId: IdGenerator.generateConversationId()});

            logger.info("Current conversation history", { messages });
            return {
                conversationResponse,
                messages: messages
            };
        } catch (error) {
            logger.error("Error processing user message:", error);
            if (error instanceof RateLimitExceededError || error instanceof SecurityError) {
                throw error;
            }   
            
            // Fallback response
            return {
                conversationResponse: {
                    enhancedUserRequest: `User request: ${userMessage}`,
                    userResponse: FALLBACK_USER_RESPONSE
                },
                messages: [
                    ...pastMessages,
                    {...createUserMessage(userMessage), conversationId: IdGenerator.generateConversationId()},
                    {...createAssistantMessage(FALLBACK_USER_RESPONSE), conversationId: IdGenerator.generateConversationId()}
                ]
            };
        }
    }

    processProjectUpdates<T extends ProjectUpdateType>(updateType: T, _data: WebSocketMessageData<T>, logger: StructuredLogger) : ConversationMessage[] {
        try {
            logger.info("Processing project update", { updateType });

            // Just save it as an assistant message. Dont save data for now to avoid DO size issues
            const preparedMessage = `**<Internal Memo>**
Project Updates: ${updateType}
</Internal Memo>`;

            return [{
                role: 'assistant',
                content: preparedMessage,
                conversationId: IdGenerator.generateConversationId()
            }];
        } catch (error) {
            logger.error("Error processing project update:", error);
            return [];
        }
    }

    isProjectUpdateType(type: any): type is ProjectUpdateType {
        return RelevantProjectUpdateWebsoketMessages.includes(type);
    }
}