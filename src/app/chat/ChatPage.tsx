"use client";

import { Suspense } from "react";
import { ModernChatInterface } from "../../components/chat/ModernChatInterface";
import { ChatProvider } from "../../context/ChatContext";
import { useAuth } from "../../context/AuthContext";
import { useLanguage } from "../../context/LanguageContext";
import Link from "next/link";
import { ArrowLeft, MessageSquare, Loader } from "lucide-react";

function ChatContent() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { t } = useLanguage();

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="mt-4 text-sm text-muted-foreground">{t.authenticating}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <MessageSquare className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t.chatStartChat}</h1>
            <p className="mt-2 text-muted-foreground">{t.chatContactSupportBody}</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/auth?mode=login"
              className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              {t.signIn}
            </Link>
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium hover:bg-muted transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              {t.home}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <ModernChatInterface />;
}

export function ChatPage() {
  return (
    <ChatProvider>
      <Suspense
        fallback={
          <div className="flex min-h-screen flex-col items-center justify-center">
            <Loader className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Loading chat...</p>
          </div>
        }
      >
        <ChatContent />
      </Suspense>
    </ChatProvider>
  );
}