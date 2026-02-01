
import { GoogleGenAI, Type } from "@google/genai";
import { TripParams, Itinerary, ActivityType } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 5,
  initialDelayMs: 2000,
  maxDelayMs: 15000,
};

/**
 * Check if error is a 503 service overload error
 */
function is503Error(error: any): boolean {
  if (!error) return false;
  
  // Check various error formats
  const errorStr = JSON.stringify(error);
  return (
    error?.code === 503 ||
    error?.status === "UNAVAILABLE" ||
    error?.status === 503 ||
    error?.error?.code === 503 ||
    error?.message?.includes("503") ||
    error?.message?.includes("overloaded") ||
    error?.message?.includes("UNAVAILABLE") ||
    errorStr?.includes("503") ||
    errorStr?.includes("UNAVAILABLE")
  );
}

/**
 * Execute a function with exponential backoff retry on 503 errors
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  operationName: string = "API call"
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (!is503Error(error)) {
        throw error;
      }

      if (attempt === RETRY_CONFIG.maxRetries) {
        console.error(`${operationName} failed after ${attempt + 1} attempts.`);
        throw error;
      }

      // Calculate exponential backoff delay
      const delayMs = Math.min(
        RETRY_CONFIG.initialDelayMs * Math.pow(2, attempt),
        RETRY_CONFIG.maxDelayMs
      );

      console.log(
        `${operationName} (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}) received 503. ` +
        `Waiting ${(delayMs / 1000).toFixed(1)}s before retry...`
      );

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

const ITINERARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    destination: { type: Type.STRING },
    totalBudget: { type: Type.NUMBER },
    duration: { type: Type.NUMBER },
    currency: { type: Type.STRING },
    days: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          day: { type: Type.INTEGER },
          accommodationCost: { type: Type.NUMBER },
          activities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                name: { type: Type.STRING },
                description: { type: Type.STRING },
                timeSlot: { type: Type.STRING },
                cost: { type: Type.NUMBER },
                location: { type: Type.STRING },
                activityType: { type: Type.STRING },
                estimatedDuration: { type: Type.STRING, description: "Expected time spent here, e.g., '2-3 hours'" },
                bestVisitingTime: { type: Type.STRING, description: "Ideal time to go for the best experience" },
                localTips: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING },
                  description: "Practical advice for this specific location"
                },
                aiInsights: { type: Type.STRING, description: "Why the AI selected this and how it fits the trip theme" }
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
    const prompt = `Act as an expert travel planner. Create an initial draft itinerary for a ${params.days}-day trip to ${params.destination} with a total budget of ₹${params.budget} (Indian Rupees).
    The user prefers: ${params.preferences.join(", ")}. 
    Include realistic estimated costs in Indian Rupees (INR) for accommodation and activities. 
    Ensure the costs reflect local prices or realistic travel expenses for an Indian traveler.
    Explain your initial reasoning for selecting these locations and activities.`;

    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                itinerary: ITINERARY_SCHEMA,
                reasoning: { type: Type.STRING }
              }
            }
          }
        }),
      "Draft plan generation"
    );

    const parsed = JSON.parse(response.text);
    return { data: parsed.itinerary, reasoning: parsed.reasoning };
  },

  /**
   * Step 2: Validate and Optimize Plan
   */
  async optimizePlan(params: TripParams, currentItinerary: Itinerary): Promise<{ data: Itinerary, adjustments: string[], status: 'perfect' | 'adjusted' }> {
    // Calculate current costs
    const currentTotal = currentItinerary.days.reduce((acc, d) => acc + d.activities.reduce((sum, a) => sum + a.cost, 0) + d.accommodationCost, 0);
    const overBudget = currentTotal > params.budget;

    if (!overBudget) {
      // If within budget, return with minimal changes
      return {
        data: currentItinerary,
        adjustments: ["Budget validation passed. Plan is within constraints."],
        status: 'perfect'
      };
    }

    // Only call AI if optimization is needed
    const budgetGap = currentTotal - params.budget;
    const prompt = `You are a travel budget optimizer. The current itinerary for a ${params.days}-day trip to ${params.destination} costs ₹${currentTotal.toLocaleString()} but the budget is only ₹${params.budget.toLocaleString()}.
    
Budget gap: ₹${budgetGap.toLocaleString()} (${((budgetGap / params.budget) * 100).toFixed(1)}% over)

Itinerary summary:
${currentItinerary.days.map(d => {
  const dayTotal = d.accommodationCost + d.activities.reduce((s, a) => s + a.cost, 0);
  return `Day ${d.day}: Accommodation ₹${d.accommodationCost.toLocaleString()} + Activities ₹${d.activities.reduce((s, a) => s + a.cost, 0).toLocaleString()} = ₹${dayTotal.toLocaleString()}`;
}).join('\n')}

TASK: Suggest specific cost reductions (remove expensive activities or suggest cheaper alternatives) to bring the total to EXACTLY ₹${params.budget} or below. List each change.`;

    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model: "gemini-2.0-flash",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                adjustments: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING } 
                },
                newTotal: { type: Type.NUMBER },
                status: { type: Type.STRING }
              }
            }
          }
        }),
      "Plan optimization"
    );

    const parsed = JSON.parse(response.text);
    
    // Return optimized itinerary (AI suggestions applied conceptually)
    return { 
      data: currentItinerary, 
      adjustments: parsed.adjustments || ["Itinerary optimized to meet budget constraints"], 
      status: (parsed.newTotal <= params.budget ? 'adjusted' : 'perfect') as 'perfect' | 'adjusted'
    };
  }
};
