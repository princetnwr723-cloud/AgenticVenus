"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/components/AuthProvider";
import ModelSelectorModal from "@/components/ModelSelectorModal";
import type { Provider } from "@/lib/providers";

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [connected, setConnected] = useState<Provider | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-cream">
        <p className="text-sm text-ink/50">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-cream">
      <header className="border-b border-black/5">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-clay text-sm font-semibold text-cream">
              V
            </span>
            <span className="text-lg font-medium">AgenticVenus</span>
          </div>
          <button
            onClick={() => signOut(auth)}
            className="focus-ring rounded-md px-4 py-2 text-sm text-ink/70 hover:text-ink"
          >
            Log out
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="font-serif text-3xl text-ink">
          Welcome{user.displayName ? `, ${user.displayName}` : ""}
        </h1>
        <p className="mt-2 text-ink/60">
          Connect a provider to start using your agent.
        </p>

        <div className="mt-8 rounded-card border border-ink/10 bg-white/60 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium text-ink/70">AI provider</h2>
              {connected ? (
                <p className="mt-1 flex items-center gap-2 text-base text-ink">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: connected.accent }}
                  />
                  {connected.name}
                </p>
              ) : (
                <p className="mt-1 text-base text-ink/40">Not connected yet</p>
              )}
            </div>
            <button
              onClick={() => setModalOpen(true)}
              className="focus-ring rounded-md border border-ink/15 bg-white px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-sand"
            >
              {connected ? "Switch model" : "Select model"}
            </button>
          </div>
        </div>

        <div className="mt-6 rounded-card border border-dashed border-ink/15 bg-white/30 p-10 text-center">
          <p className="text-sm text-ink/45">
            {connected
              ? "Your agent workspace goes here — chat UI coming next."
              : "Connect a provider above to unlock your agent workspace."}
          </p>
        </div>
      </section>

      <ModelSelectorModal
        uid={user.uid}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConnected={(provider) => setConnected(provider)}
      />
    </main>
  );
}