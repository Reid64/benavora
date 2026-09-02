# SPEC_AI_CHATBOT.md
## AFS — Customer Support Chatbot
**Phase 7**
**Component:** ChatWidget.tsx — fixed bottom-right on all customer-facing pages
**Model:** claude-sonnet-4-6

---

## 1. WHAT IT DOES AND WHAT IT DOESN'T

**Does:**
- Answers questions about AFS products, profiles, materials, fabrication
- Explains the ordering process (quote request → formal quote → payment)
- Answers questions about order status (reads from DB per authenticated user)
- Helps customers navigate to the right feature (upload, configure, quote)
- Provides installation guidance from guides in the database

**Does not:**
- Quote prices — ever. Not even ballpark estimates.
- Override AFS estimator decisions
- Process orders, change order status, or modify data
- Handle billing disputes or warranty claims (escalates to human)
- Discuss competitors

---

## 2. WIDGET BEHAVIOR

```typescript
// Collapsed state (default):
//   Circular button, 64px, fixed bottom-right, right-6 bottom-6
//   Background: bg-afs-crimson
//   AFS mark logo (white) or chat icon
//   UnreadBadge: number of unread AI messages (crimson on white) — appears after first interaction

// Expanded state:
//   Panel: 380px wide × 520px tall
//   Slides up from button position
//   bg-afs-bg-raised border border-[var(--afs-border)] metal-edge
//   Header: "AFS Support" font-heading + [×] close button
//   MessageList (scrollable)
//   InputBar: textarea (auto-grow) + [Send] button

// Persistent within session (does not reset on navigation)
// Does NOT persist across browser sessions (no localStorage)
// Authenticated users: messages saved to chat_conversations table
// Guest users: session-only, not saved
```

---

## 3. SYSTEM PROMPT

```typescript
const CHATBOT_SYSTEM_PROMPT = `You are AFS Support, the customer service AI for
AFS Architectural Flashing Supply — a specialty sheet metal fabricator.

YOUR ROLE:
Help customers understand products, navigate the ordering process, find
answers to technical questions, and direct them to the right AFS tools.

WHAT YOU KNOW (injected at runtime):
- AFS product catalog (profiles, materials, gauges, finishes)
- Customer's current orders and quote requests (if authenticated)
- AFS ordering process
- Installation guides in the system

ABSOLUTE RULES:
1. NEVER quote a price. Not even an estimate. Not even "around $X".
   When asked about price: "Pricing is set by our estimators and delivered
   in your formal quote. Submit a request and you'll have pricing within
   [time — BLOCKED]."

2. NEVER promise a lead time without hedging:
   "Lead times vary by material and workload. Submit a request and our
   estimators will confirm timing in your quote."

3. ESCALATE immediately to human when:
   - Customer expresses anger, frustration, or dissatisfaction
   - Order dispute or complaint
   - Engineering question requiring professional judgment
   - Payment or billing issue
   - Any "I'll take legal action" or similar statement

4. SHORT ANSWERS. This is a support chat, not a documentation portal.
   Max 3 sentences per response unless explaining a process step-by-step.

5. You are not a salesperson. Help the customer find what they need.
   Do not upsell.

ESCALATION TRIGGER:
When escalation needed, respond with this exact JSON wrapper before your text:
[ESCALATE: {reason: "brief reason"}]
"Let me connect you with our team directly..."`;
```

---

## 4. RUNTIME CONTEXT INJECTION

```typescript
// app/api/chat/route.ts
// On every chat request, inject current context:

async function buildChatContext(
  userId: string | null,
  supabase: SupabaseClient
): Promise<string> {
  if (!userId) {
    return `Customer: Guest (not logged in)
Products available: [product catalog summary — 20 most common]`;
  }

  const [profile, activeOrders, pendingQuotes] = await Promise.all([
    supabase.from('profiles').select('full_name, company, role').eq('id', userId).single(),
    supabase.from('orders').select('order_number, status, created_at')
      .eq('user_id', userId).in('status', ['submitted','received','in_queue','cutting','bending','qc','ready','shipped']),
    supabase.from('quote_requests').select('request_number, status, submitted_at')
      .eq('user_id', userId).in('status', ['submitted','reviewing']),
  ]);

  return `
Customer: ${profile.data?.full_name} (${profile.data?.company ?? 'no company'})
Active orders: ${JSON.stringify(activeOrders.data)}
Pending quote requests: ${JSON.stringify(pendingQuotes.data)}
Products available: [catalog summary]
  `.trim();
}
```

---

## 5. STREAMING RESPONSE

```typescript
// app/api/chat/route.ts — streaming
export async function POST(request: NextRequest) {
  const { messages, userId } = await request.json();
  const context = await buildChatContext(userId, supabase);

  const stream = await anthropic.messages.stream({
    model:      'claude-sonnet-4-6',
    max_tokens: 512,   // Shorter for chat — forces concise answers
    system:     CHATBOT_SYSTEM_PROMPT + '\n\nCONTEXT:\n' + context,
    messages,
  });

  return new Response(stream.toReadableStream());
}

// Client reads ReadableStream and appends tokens to message
// TypingIndicator: three dots animation during streaming
```

---

## 6. ESCALATION FLOW

```typescript
// When AI response contains [ESCALATE: {...}]:
// 1. Parse escalation reason
// 2. Show EscalationCard in message list:
//    bg-afs-bg-surface border-l-4 border-afs-crimson p-4
//    "We've flagged your question for our team."
//    "Contact us directly:"
//      Phone: [BLOCKED #5] — button
//      Email: [BLOCKED #5] — button
//    "Or submit a contact form:" → /contact
// 3. Save escalation to chat_conversations.escalated = true
// 4. Admin notified (email) of escalation with conversation context
// 5. AI continues responding but flags itself as in escalated state
```

---

## 7. CHAT HISTORY (AUTHENTICATED USERS)

```typescript
// chat_conversations table (from SCHEMA.md)
// messages column: JSONB array — full conversation
// Updated on every message exchange
// Admin can view escalated conversations in /admin/settings (basic view)
// Guest conversations: not saved — session only
// Retention: 90 days then purged (BLOCKED: confirm with client #65)
```

---

## 8. PERFORMANCE

- Widget loads lazily — not in initial bundle
- Streaming starts < 500ms after user sends message
- Widget expand/collapse: CSS transition, no JavaScript layout thrash
- On mobile: widget collapses to icon when keyboard opens (viewport detection)

---

*SPEC_AI_CHATBOT.md | AFS | Reid Whitesides | June 2026*
