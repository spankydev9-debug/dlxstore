"use client";
import { useEffect } from "react";
export function PwaRegistration() { useEffect(() => { if (!("serviceWorker" in navigator)) return; navigator.serviceWorker.register("/sw.js").then((registration) => { registration.addEventListener("updatefound", () => { const worker = registration.installing; worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) worker.postMessage({ type: "SKIP_WAITING" }); }); }); }).catch(() => undefined); }, []); return null; }
