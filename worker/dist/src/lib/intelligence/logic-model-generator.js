"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateLogicModel = generateLogicModel;
exports.formatLogicModelAsText = formatLogicModelAsText;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const server_1 = require("../../lib/supabase/server");
const embeddings_1 = require("./embeddings");
let anthropicClient = null;
function getClient() {
    if (anthropicClient === null) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey)
            throw new Error('Missing required env var: ANTHROPIC_API_KEY');
        anthropicClient = new sdk_1.default({ apiKey });
    }
    return anthropicClient;
}
const LOGIC_MODEL_COLS = 'id, category, subcategory, inputs, activities, outputs, outcomes, impact';
const SYSTEM_PROMPT = `You are a nonprofit grant writer expert in logic models. Return ONLY valid JSON with no markdown fences. The JSON must match this exact structure:
{
  "inputs": ["string describing a resource or input"],
  "activities": ["string describing a program activity"],
  "outputs": ["string describing a measurable output (e.g., number of people served)"],
  "outcomes": ["string describing a short-term or medium-term change"],
  "impact": ["string describing the long-term community change"]
}
Each array should have 3-6 items. Be specific, measurable, and tailored to the program described.`;
function toStringArray(value) {
    if (Array.isArray(value)) {
        return value.filter((v) => typeof v === 'string');
    }
    return [];
}
function parseLogicModelJson(raw) {
    let text = raw.trim();
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```$/m);
    if (fenceMatch) {
        text = fenceMatch[1]?.trim() ?? text;
    }
    const parsed = JSON.parse(text);
    return {
        inputs: toStringArray(parsed['inputs']),
        activities: toStringArray(parsed['activities']),
        outputs: toStringArray(parsed['outputs']),
        outcomes: toStringArray(parsed['outcomes']),
        impact: toStringArray(parsed['impact']),
    };
}
async function generateLogicModel(params) {
    const { category, programDescription, organizationName, targetPopulation, geography } = params;
    const supabase = (0, server_1.createClient)();
    // Step 1: exact category match
    const { data: exactMatch } = await supabase
        .from('intelligence_logic_models')
        .select(LOGIC_MODEL_COLS)
        .eq('category', category)
        .limit(1)
        .maybeSingle();
    let template = exactMatch;
    // Step 2: embedding similarity fallback if no exact match
    if (!template) {
        try {
            const queryText = `${category} ${programDescription}`;
            const embedding = await (0, embeddings_1.generateEmbedding)(queryText);
            const { data: similar } = await supabase.rpc('match_logic_models', {
                query_embedding: embedding,
                match_threshold: 0.6,
                match_count: 1,
            });
            if (Array.isArray(similar) && similar.length > 0) {
                template = similar[0];
            }
        }
        catch {
            // RPC may not be deployed yet; proceed without template
        }
    }
    const contextParts = [
        `Organization: ${organizationName}`,
        `Program: ${programDescription}`,
    ];
    if (targetPopulation)
        contextParts.push(`Target Population: ${targetPopulation}`);
    if (geography)
        contextParts.push(`Geography: ${geography}`);
    const contextBlock = contextParts.join('\n');
    let userContent;
    if (template) {
        const templateJson = JSON.stringify({
            inputs: toStringArray(template.inputs),
            activities: toStringArray(template.activities),
            outputs: toStringArray(template.outputs),
            outcomes: toStringArray(template.outcomes),
            impact: toStringArray(template.impact),
        }, null, 2);
        userContent = `Here is a template logic model for ${template.category}:\n${templateJson}\n\nCustomize it for this specific program:\n${contextBlock}\n\nAdapt the inputs, activities, outputs, outcomes, and impact to be specific to this program. Return ONLY valid JSON matching the same structure.`;
    }
    else {
        userContent = `Generate a logic model for this program:\n${contextBlock}\n\nCategory: ${category}\n\nReturn ONLY valid JSON.`;
    }
    const response = await getClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') {
        throw new Error('No text response from Claude');
    }
    const data = parseLogicModelJson(block.text);
    return {
        ...data,
        category,
        templateBased: template !== null,
        templateId: template?.id,
    };
}
function formatLogicModelAsText(model) {
    const fmt = (items) => items.map((item) => `  - ${item}`).join('\n');
    return [
        `INPUTS:\n${fmt(model.inputs)}`,
        `ACTIVITIES:\n${fmt(model.activities)}`,
        `OUTPUTS:\n${fmt(model.outputs)}`,
        `OUTCOMES:\n${fmt(model.outcomes)}`,
        `IMPACT:\n${fmt(model.impact)}`,
    ].join('\n\n');
}
