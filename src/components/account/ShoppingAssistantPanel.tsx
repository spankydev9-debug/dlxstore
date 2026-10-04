"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, Send, Sparkles, Trash2 } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import {
  appendAssistantTurn,
  askAssistant,
  startAssistantConversation,
} from "../../services/db/assistant";
import { ProductImage } from "../shared/ProductImage";

/** The product shape the assistant returns, narrowed to what the panel renders. */
type AssistantProduct = {
  id: string;
  name: string;
  slug: string;
  price: number;
  discount_price: number | null;
  image_url: string | null;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  products: AssistantProduct[];
};

/**
 * DLX AI Shopping Assistant (master roadmap area 15).
 *
 * The important thing about this panel is what it is NOT: it is not a chatbot
 * pretending to be a person, and it is not generating text from a model. Every
 * product it shows is a real, in-stock row from the catalogue, and the footer says
 * so. A customer shopping in Goma is being asked to turn up with cash for a
 * specific item; a confident wrong answer is a wasted trip.
 *
 * Turns are persisted best-effort: a lost turn costs a line of history, never the
 * answer the customer is already reading.
 */
export function ShoppingAssistantPanel() {
  const { t } = useLanguage();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || busy) return;

    setInput("");
    setError(null);
    setBusy(true);

    // Show the customer's message immediately, before any network round trip.
    setMessages((current) => [
      ...current,
      { id: `u-${Date.now()}`, role: "user", text: question, products: [] },
    ]);

    try {
      // The first exchange mints the conversation; later turns reuse it.
      let conversation = conversationId;
      if (!conversation) {
        conversation = await startAssistantConversation(question.slice(0, 120)).catch(() => null);
        if (conversation) setConversationId(conversation);
      }

      const answer = await askAssistant(question);

      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: answer.message,
          products: answer.products,
        },
      ]);

      // Persist both turns, but never let a persistence failure undo the answer.
      await Promise.all([
        appendAssistantTurn({
          conversationId: conversation,
          role: "user",
          message: question,
          productIds: [],
          source: "deterministic",
        }),
        appendAssistantTurn({
          conversationId: conversation,
          role: "assistant",
          message: answer.message,
          productIds: answer.products.map((product) => product.id),
          source: answer.source,
        }),
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.assistantError);
    } finally {
      setBusy(false);
    }
  }, [busy, conversationId, input, t.assistantError]);

return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-bold text-foreground">{t.assistantTitle}</h3>
          <p className="truncate text-[11px] text-muted-foreground">{t.assistantSubtitle}</p>
        </div>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setConversationId(null);
            }}
            className="ml-auto rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted"
            aria-label={t.assistantClear}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Scrolls, so a long exchange never pushes the composer off screen. */}
      <div className="max-h-[26rem] min-h-[8rem] flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 ? (
          <div className="space-y-2 rounded-xl border border-border/50 bg-muted/20 p-4">
            <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {t.assistantTryAsking}
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>• {t.assistantExample1}</li>
              <li>• {t.assistantExample2}</li>
              <li>• {t.assistantExample3}</li>
            </ul>
          </div>
        ) : null}

        {messages.map((message) =>
          message.role === "user" ? (
            <p
              key={message.id}
              className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
            >
              {message.text}
            </p>
          ) : (
            <div key={message.id} className="max-w-[92%] space-y-2">
              <p className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-foreground">
                {message.text}
              </p>
              {message.products.length > 0 ? (
                <ul className="space-y-1.5">
                  {message.products.map((product) => (
                    <li key={product.id}>
                      <Link
                        href={`/product/${product.slug}`}
                        className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-2 transition-colors hover:bg-muted"
                      >
                        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {product.image_url ? (
                            <ProductImage
                              src={product.image_url}
                              alt={product.name}
                              fill
                              sizes="48px"
                              className="object-cover"
                            />
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold text-foreground">
                            {product.name}
                          </span>
                          <span className="flex items-baseline gap-1.5">
                            <span className="text-xs font-extrabold text-foreground">
                              {(product.discount_price ?? product.price)} $
                            </span>
                            {product.discount_price !== null ? (
                              <span className="text-[10px] text-muted-foreground line-through">
                                {product.price} $
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        )}

        {busy ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t.assistantThinking}
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

{error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value.slice(0, 300))}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline. Expected in a chat surface.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={t.assistantPlaceholder}
          className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary"
        />
        <button
          type="submit"
          disabled={busy || input.trim() === ""}
          aria-label={t.assistantSend}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </form>

      {/* Honest about what this is. No "powered by AI" claim while it is retrieval. */}
      <p className="text-[10px] leading-relaxed text-muted-foreground">{t.assistantGrounding}</p>
    </div>
  );
}
