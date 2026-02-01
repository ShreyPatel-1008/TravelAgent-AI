
import Anthropic from "@anthropic-ai/sdk";
import { TripParams, Itinerary, ActivityType } from "../types";

// Initialize Anthropic client
// Note: We're using the client-side approach which usually requires a proxy for security in production,
// but for this local demo we'll use dangerouslyBrowser: true if needed or just standard init if the key is exposed.
// However, Anthropic SDK usually warns about browser usage.
// For a simple local vite app, we often use the SDK directly.
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    dangerouslyAllowBrowser: true // Required for client-side usage
});

const ITINERARY_SCHEMA = {
    type: "object",
    properties: {
        destination: { type: "string" },
        totalBudget: { type: "number" },
        duration: { type: "number" },
        currency: { type: "string" },
        days: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    day: { type: "integer" },
                    accommodationCost: { type: "number" },
                    activities: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                name: { type: "string" },
                                description: { type: "string" },
                                timeSlot: { type: "string" },
                                cost: { type: "number" },
                                location: { type: "string" },
                                activityType: { type: "string" },
                                estimatedDuration: { type: "string", description: "Expected time spent here, e.g., '2-3 hours'" },
                                bestVisitingTime: { type: "string", description: "Ideal time to go for the best experience" },
                                localTips: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "Practical advice for this specific location"
                                },
                                aiInsights: { type: "string", description: "Why the AI selected this and how it fits the trip theme" }
                            },
                            required: ["id", "name", "description", "timeSlot", "cost", "location", "activityType", "estimatedDuration", "bestVisitingTime", "localTips", "aiInsights"]
                        }
                    }
                },
                required: ["day", "accommodationCost", "activities"]
            }
        }
    },
    required: ["destination", "totalBudget", "duration", "currency", "days"]
};

export const travelAgentService = {
    /**
     * Step 1: Draft initial plan
     */
    async draftPlan(params: TripParams): Promise<{ data: Itinerary, reasoning: string }> {
        const systemPrompt = `Act as an expert travel planner. Create an initial draft itinerary for a ${params.days}-day trip to ${params.destination} with a total budget of ${params.budget} INR.
    The user prefers: ${params.preferences.join(", ")}.
    Include realistic estimated costs in Indian Rupees (INR) for accommodation and activities.
    Ensure the costs reflect local prices or realistic travel expenses for an Indian traveler.
    Explain your initial reasoning for selecting these locations and activities.
    
    You must output valid JSON matching the provided schema.`;

        try {
            const msg = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4000,
                system: systemPrompt,
                messages: [
                    {
                        role: "user",
                        content: "Please generate the itinerary."
                    }
                ],
                tools: [
                    {
                        name: "generate_itinerary",
                        description: "Generate a detailed travel itinerary based on user preferences and budget.",
                        input_schema: ITINERARY_SCHEMA as any
                    }
                ],
                tool_choice: { type: "tool", name: "generate_itinerary" }
            });

            // Handle tool use response
            const toolUse = msg.content.find(c => c.type === 'tool_use');

            if (toolUse && toolUse.type === 'tool_use') {
                const itinerary = toolUse.input as unknown as Itinerary;
                // For reasoning, checking if there is any text content before tool use or we might need to ask for it separately/infer it.
                // In tool use mode, the model often just gives the tool call.
                // We can assume a generic reasoning or try to extract it if mixed.
                // Often models output text then tool use.
                const textContent = msg.content.find(c => c.type === 'text');
                const reasoning = textContent && textContent.type === 'text' ? textContent.text : "Generated based on your preferences and budget constraints.";

                return { data: itinerary, reasoning };
            } else {
                throw new Error("No itinerary generated via tool use.");
            }

        } catch (error) {
            console.error("Error creating draft plan:", error);
            throw error;
        }
    },

    /**
     * Step 2: Validate and Optimize Plan
     */
    async optimizePlan(params: TripParams, currentItinerary: Itinerary): Promise<{ data: Itinerary, adjustments: string[], status: 'perfect' | 'adjusted' }> {
        // Calculate current costs
        const currentTotal = currentItinerary.days.reduce((acc, d) => acc + d.activities.reduce((sum, a) => sum + a.cost, 0) + d.accommodationCost, 0);
        const overBudget = currentTotal > params.budget;

        if (!overBudget) {
            return {
                data: currentItinerary,
                adjustments: ["Budget validation passed. Plan is within constraints."],
                status: 'perfect'
            };
        }

        const budgetGap = currentTotal - params.budget;
        const prompt = `You are a travel budget optimizer. The current itinerary for a ${params.days}-day trip to ${params.destination} costs ${currentTotal} but the budget is only ${params.budget}.
    Budget gap: ${budgetGap} (${((budgetGap / params.budget) * 100).toFixed(1)}% over).
    
    Current Itinerary structure provided in context.
    
    TASK: Suggest specific cost reductions to bring the total to EXACTLY ${params.budget} or below.
    Output the adjustments and new total.`;

        try {
            const msg = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 4000,
                system: "You are a helpful travel assistant optimizing a budget.",
                messages: [
                    {
                        role: "user",
                        content: `Here is the current itinerary JSON: ${JSON.stringify(currentItinerary)}\n\n${prompt}`
                    }
                ],
                tools: [
                    {
                        name: "optimize_itinerary",
                        description: "Return optimized budget details.",
                        input_schema: {
                            type: "object",
                            properties: {
                                adjustments: { type: "array", items: { type: "string" } },
                                newTotal: { type: "number" },
                                status: { type: "string", enum: ["perfect", "adjusted"] }
                            },
                            required: ["adjustments", "newTotal", "status"]
                        }
                    }
                ],
                tool_choice: { type: "tool", name: "optimize_itinerary" }
            });

            const toolUse = msg.content.find(c => c.type === 'tool_use');

            if (toolUse && toolUse.type === 'tool_use') {
                const result = toolUse.input as any;
                return {
                    data: currentItinerary, // In this simplified flow we keep the old data but simpler would be to update it. For now matching gemini flow which largely returns "adjustments" text lists in the original code, though here we structure it.
                    // Actually the original code just returns the old itinerary + text adjustments.
                    adjustments: result.adjustments,
                    status: (result.newTotal <= params.budget ? 'adjusted' : 'perfect')
                };
            } else {
                throw new Error("No optimization result generated.");
            }

        } catch (error) {
            console.error("Error optimizing plan:", error);
            throw error;
        }
    }
};
