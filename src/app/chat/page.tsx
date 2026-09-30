import { Metadata } from "next";
import { ChatPage } from "./ChatPage";

export const metadata: Metadata = {
  title: "DLX Chat | Real-time Messaging",
  description: "Real-time messaging with DLX Store. Chat with support, team members, and friends.",
  openGraph: {
    title: "DLX Chat | Real-time Messaging",
    description: "Real-time messaging with DLX Store. Chat with support, team members, and friends.",
    type: "website",
  },
};

export default function Page() {
  return <ChatPage />;
}