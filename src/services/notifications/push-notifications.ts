// DLXSTORE — Push Notification Service for Chat
// Handles browser push notifications for new messages

// Service-worker notification APIs (PushEvent, NotificationEvent, `actions`,
// `renotify`) are absent from the default DOM type library, so the shapes used
// below are declared locally rather than pulled in from a new dependency.
export type ChatNotificationActions = { action: string; title: string; icon?: string }[];
export type ChatNotificationOptions = NotificationOptions & {
  actions?: ChatNotificationActions;
  renotify?: boolean;
  data?: any;
};
export type PushEventLike = Event & {
  data: { json(): any } | null;
  waitUntil(promise: Promise<unknown>): void;
};
export type NotificationClickEvent = Event & {
  notification: Notification & { data?: { conversationId?: string } };
  action?: string;
};

export class PushNotificationService {
  private static VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  private static serviceWorkerRegistration: ServiceWorkerRegistration | null = null;
  
  static async requestPermission(): Promise<NotificationPermission> {
    if (!("Notification" in window)) {
      console.warn("This browser does not support notifications");
      return "denied";
    }
    
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
      return permission;
    }
    
    return Notification.permission;
  }
  
  static async registerServiceWorker(): Promise<boolean> {
    if (!("serviceWorker" in navigator)) {
      console.warn("Service workers are not supported");
      return false;
    }
    
    try {
      this.serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js");
      console.log("Service worker registered:", this.serviceWorkerRegistration);
      return true;
    } catch (error) {
      console.error("Service worker registration failed:", error);
      return false;
    }
  }
  
  static async subscribeToPushNotifications(userId: string): Promise<PushSubscription | null> {
    if (!this.VAPID_PUBLIC_KEY) {
      console.warn("VAPID public key not configured");
      return null;
    }
    
    if (!this.serviceWorkerRegistration) {
      const registered = await this.registerServiceWorker();
      if (!registered) return null;
    }
    
    try {
      const subscription = await this.serviceWorkerRegistration!.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: this.urlBase64ToUint8Array(this.VAPID_PUBLIC_KEY).buffer as ArrayBuffer,
      });
      
      // Store subscription on server
      await this.storeSubscription(userId, subscription);
      
      return subscription;
    } catch (error) {
      console.error("Failed to subscribe to push notifications:", error);
      return null;
    }
  }
  
  static async unsubscribeFromPushNotifications(): Promise<boolean> {
    if (!this.serviceWorkerRegistration) return false;
    
    try {
      const subscription = await this.serviceWorkerRegistration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to unsubscribe from push notifications:", error);
      return false;
    }
  }
  
  static async showChatNotification(
    title: string,
    options: ChatNotificationOptions
  ): Promise<void> {
    const permission = await this.requestPermission();
    
    if (permission !== "granted") {
      console.warn("Notification permission not granted");
      return;
    }
    
    // Use service worker if available for background notifications
    if (this.serviceWorkerRegistration && "showNotification" in this.serviceWorkerRegistration) {
      await this.serviceWorkerRegistration.showNotification(title, {
        icon: "/icons/icon-192x192.png",
        badge: "/icons/badge-72x72.png",
        ...options,
      });
    } else {
      // Fallback to regular notifications
      new Notification(title, {
        icon: "/icons/icon-192x192.png",
        ...options,
      });
    }
  }
  
  static async notifyNewMessage(
    conversationId: string,
    senderName: string,
    message: string,
    conversationTitle?: string
  ): Promise<void> {
    const title = conversationTitle || "New Message";
    const body = `${senderName}: ${message.length > 100 ? message.substring(0, 100) + "..." : message}`;
    
    await this.showChatNotification(title, {
      body,
      icon: "/icons/chat-notification.png",
      badge: "/icons/chat-badge.png",
      tag: `chat-${conversationId}`,
      renotify: true,
      data: {
        conversationId,
        type: "chat_message",
        timestamp: Date.now(),
      },
      actions: [
        {
          action: "open",
          title: "Open Chat",
        },
        {
          action: "mark_read",
          title: "Mark as Read",
        },
      ],
    });
  }
  
  static async notifyTyping(
    conversationId: string,
    userName: string
  ): Promise<void> {
    // Only show typing notifications if user has been inactive for a while
    // or if it's a high-priority conversation
    await this.showChatNotification(`${userName} is typing...`, {
      body: "is typing a message...",
      icon: "/icons/typing-notification.png",
      tag: `typing-${conversationId}`,
      requireInteraction: false,
      silent: true,
      data: {
        conversationId,
        type: "typing_indicator",
        timestamp: Date.now(),
      },
    });
  }
  
  static async notifyMessageRead(
    conversationId: string,
    userName: string
  ): Promise<void> {
    await this.showChatNotification("Message Read", {
      body: `${userName} read your message`,
      icon: "/icons/read-notification.png",
      tag: `read-${conversationId}`,
      silent: true,
      data: {
        conversationId,
        type: "message_read",
        timestamp: Date.now(),
      },
    });
  }
  
  static async notifyReaction(
    conversationId: string,
    userName: string,
    emoji: string
  ): Promise<void> {
    await this.showChatNotification("New Reaction", {
      body: `${userName} reacted with ${emoji}`,
      icon: "/icons/reaction-notification.png",
      tag: `reaction-${conversationId}`,
      data: {
        conversationId,
        type: "message_reaction",
        emoji,
        timestamp: Date.now(),
      },
    });
  }
  
  // Helper methods
  private static urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    
    return outputArray;
  }
  
  private static async storeSubscription(
    userId: string,
    subscription: PushSubscription
  ): Promise<void> {
    try {
      // Store subscription in your backend
      const response = await fetch("/api/push-subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId,
          subscription: subscription.toJSON(),
        }),
      });
      
      if (!response.ok) {
        throw new Error("Failed to store subscription");
      }
    } catch (error) {
      console.error("Failed to store push subscription:", error);
    }
  }
  
  // Initialize push notifications
  static async initialize(userId: string): Promise<boolean> {
    try {
      const permission = await this.requestPermission();
      
      if (permission === "granted") {
        await this.registerServiceWorker();
        await this.subscribeToPushNotifications(userId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error("Failed to initialize push notifications:", error);
      return false;
    }
  }
  
  // Handle notification click
  static handleNotificationClick(event: NotificationClickEvent): void {
    const notification = event.notification;
    const action = event.action;
    
    // Close the notification
    notification.close();
    
    // Handle different actions
    if (action === "open") {
      // Open the chat conversation
      const data = notification.data;
      if (data?.conversationId) {
        window.open(`/chat?conversation=${data.conversationId}`, "_blank");
      }
    } else if (action === "mark_read") {
      // Mark conversation as read
      const data = notification.data;
      if (data?.conversationId) {
        // You would typically call an API here
        console.log("Mark conversation as read:", data.conversationId);
      }
    } else {
      // Default click behavior
      const data = notification.data;
      if (data?.conversationId) {
        window.open(`/chat?conversation=${data.conversationId}`, "_blank");
      }
    }
  }
  
  // Clean up
  static async cleanup(): Promise<void> {
    await this.unsubscribeFromPushNotifications();
  }
}

// Service worker event listeners (to be added to your service worker)
export const pushNotificationEventHandlers = {
  "push": (event: PushEventLike) => {
    const data = event.data?.json();
    
    const options: ChatNotificationOptions = {
      body: data.body,
      icon: data.icon || "/icons/icon-192x192.png",
      badge: "/icons/badge-72x72.png",
      tag: data.tag,
      data: data.data,
      actions: data.actions,
      requireInteraction: data.requireInteraction,
    };
    
    event.waitUntil(
      (self as any).registration.showNotification(data.title, options)
    );
  },
  
  "notificationclick": (event: NotificationClickEvent) => {
    PushNotificationService.handleNotificationClick(event);
  },
};