import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export async function generateEmbedding(text: string): Promise<number[]> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      })
      return response.data[0].embedding
    } catch (err) {
      lastError = err
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }
  }
  throw lastError
}

export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 100
  const results: number[][] = []

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE)
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    })
    const sorted = response.data.sort((a, b) => a.index - b.index)
    results.push(...sorted.map((item) => item.embedding))

    if (i + BATCH_SIZE < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  return results
}

export function chunkText(text: string, maxTokens: number = 500, overlap: number = 50): string[] {
  const maxChars = maxTokens * 4
  const overlapChars = overlap * 4

  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text]
  const chunks: string[] = []
  let current = ''
  let overlapBuffer = ''

  for (const sentence of sentences) {
    if ((current + sentence).length > maxChars && current.length > 0) {
      chunks.push((overlapBuffer + current).trim())
      const combined = current
      overlapBuffer = combined.length > overlapChars
        ? combined.slice(combined.length - overlapChars)
        : combined
      current = sentence
    } else {
      current += sentence
    }
  }

  if (current.trim().length > 0) {
    chunks.push((overlapBuffer + current).trim())
  }

  return chunks
}
