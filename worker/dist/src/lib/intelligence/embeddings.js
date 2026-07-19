"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateEmbedding = generateEmbedding;
exports.generateEmbeddingsBatch = generateEmbeddingsBatch;
exports.chunkText = chunkText;
const openai_1 = __importDefault(require("openai"));
let openaiClient = null;
function getOpenAI() {
    if (openaiClient === null) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey)
            throw new Error('Missing required env var: OPENAI_API_KEY');
        openaiClient = new openai_1.default({ apiKey });
    }
    return openaiClient;
}
async function generateEmbedding(text) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await getOpenAI().embeddings.create({
                model: 'text-embedding-3-small',
                input: text,
            });
            const item = response.data[0];
            if (item === undefined)
                throw new Error('No embedding returned from API');
            return item.embedding;
        }
        catch (err) {
            lastError = err;
            if (attempt < 2) {
                await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            }
        }
    }
    throw lastError;
}
async function generateEmbeddingsBatch(texts) {
    const BATCH_SIZE = 100;
    const results = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const response = await getOpenAI().embeddings.create({
            model: 'text-embedding-3-small',
            input: batch,
        });
        const sorted = response.data.sort((a, b) => a.index - b.index);
        results.push(...sorted.map((item) => item.embedding));
        if (i + BATCH_SIZE < texts.length) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
    return results;
}
function chunkText(text, maxTokens = 500, overlap = 50) {
    const maxChars = maxTokens * 4;
    const overlapChars = overlap * 4;
    const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
    const chunks = [];
    let current = '';
    let overlapBuffer = '';
    for (const sentence of sentences) {
        if ((current + sentence).length > maxChars && current.length > 0) {
            chunks.push((overlapBuffer + current).trim());
            const combined = current;
            overlapBuffer = combined.length > overlapChars
                ? combined.slice(combined.length - overlapChars)
                : combined;
            current = sentence;
        }
        else {
            current += sentence;
        }
    }
    if (current.trim().length > 0) {
        chunks.push((overlapBuffer + current).trim());
    }
    return chunks;
}
