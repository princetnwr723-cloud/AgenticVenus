"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useInView } from "@/lib/useInView";

const PROVIDER_CHIPS = [
  "Claude",
  "ChatGPT",
  "Gemini",
  "Grok",
  "OpenRouter",
  "Mistral",
  "Cohere",
  "Perplexity",
  "Groq",
  "DeepSeek",
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-cream text-ink">
      <Nav />
      <Hero />
      <HowItWorks />
      <Providers />
      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-black/5 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-clay text-sm font-semibold text-cream">
            V
          </span>
          <span className="text-lg font-medium">AgenticVenus</span>
        </div>
        <nav className="hidden items-center gap-8 text-sm text-ink/70 md:flex">
          <a href="#how-it-works" className="transition-colors hover:text-ink">
            How it works
          </a>
          <a href="#providers" className="transition-colors hover:text-ink">
            Providers
          </a>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/login"
            className="focus-ring rounded-md px-4 py-2 text-ink/80 transition-colors hover:text-ink"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="focus-ring rounded-md bg-ink px-4 py-2 font-medium text-cream transition-all hover:scale-[1.03] hover:bg-ink/90"
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const router = useRouter();
  const [draft, setDraft] = useState("");

  function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    // User isn't signed in yet — stash the message and continue after signup.
    sessionStorage.setItem("agenticvenus_draft", draft.trim());
    router.push("/signup");
  }

  return (
    <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
      <h1
        className="animate-fade-in-up font-serif text-5xl leading-[1.1] tracking-tight text-ink sm:text-6xl"
        style={{ animationDelay: "0ms" }}
      >
        Your own AI agent, built from any model you trust
      </h1>
      <p
        className="animate-fade-in-up mx-auto mt-6 max-w-2xl text-lg text-ink/70"
        style={{ animationDelay: "120ms" }}
      >
        Pick a provider, paste your API key, and start working with an
        agent that runs on the model of your choice — no lock-in, no
        middleman.
      </p>
      <div
        className="animate-fade-in-up mt-9 flex items-center justify-center gap-4"
        style={{ animationDelay: "220ms" }}
      >
        <Link
          href="/signup"
          className="focus-ring rounded-md bg-clay px-6 py-3 font-medium text-cream shadow-sm transition-all hover:scale-[1.03] hover:bg-clay-dark"
        >
          Get started free
        </Link>
        <Link
          href="/login"
          className="focus-ring rounded-md border border-ink/15 px-6 py-3 font-medium text-ink transition-all hover:scale-[1.03] hover:bg-sand"
        >
          I already have an account
        </Link>
      </div>

      {/* Working chatbox preview — sending routes an unauthenticated visitor to sign up */}
      <form
        onSubmit={handleSend}
        className="animate-fade-in-up mx-auto mt-16 max-w-2xl rounded-card border border-ink/10 bg-white/60 p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-shadow focus-within:shadow-md"
        style={{ animationDelay: "340ms" }}
      >
        <div className="flex items-center gap-2 rounded-md border border-ink/10 bg-cream px-3 py-2 transition-colors focus-within:border-clay/40">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask your agent anything..."
            className="flex-1 bg-transparent px-1 py-1.5 text-sm text-ink outline-none placeholder:text-ink/50"
          />
          <span className="flex items-center gap-2 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/80">
            <span className="h-1.5 w-1.5 rounded-full bg-clay" />
            Claude Sonnet
          </span>
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send message"
            className="focus-ring flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink text-cream transition-all hover:scale-105 disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path
                d="M2 7h10M7 2l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <p className="mt-3 px-1 text-xs text-ink/40">
          Type a message and hit send — you&apos;ll create your account to
          keep the conversation going.
        </p>
      </form>
    </section>
  );
}

function HowItWorks() {
  const { ref, isVisible } = useInView<HTMLDivElement>();

  return (
    <section id="how-it-works" className="border-t border-black/5 bg-white/40">
      <div
        ref={ref}
        className={`mx-auto max-w-5xl px-6 py-20 in-view ${
          isVisible ? "is-visible" : ""
        }`}
      >
        <h2 className="font-serif text-3xl text-ink">How it works</h2>
        <div className="mt-10 grid gap-10 md:grid-cols-3">
          <div>
            <p className="font-serif text-2xl text-clay">1</p>
            <h3 className="mt-2 text-lg font-medium">Create an account</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/65">
              Sign up with email or continue with Google. You&apos;ll land
              straight in your workspace.
            </p>
          </div>
          <div>
            <p className="font-serif text-2xl text-clay">2</p>
            <h3 className="mt-2 text-lg font-medium">Choose a provider</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/65">
              Open the model selector and pick from ten leading AI
              providers.
            </p>
          </div>
          <div>
            <p className="font-serif text-2xl text-clay">3</p>
            <h3 className="mt-2 text-lg font-medium">Paste your API key</h3>
            <p className="mt-2 text-sm leading-relaxed text-ink/65">
              Connect your own key and your agent is ready to work, running
              on your terms.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function Providers() {
  const { ref, isVisible } = useInView<HTMLDivElement>();

  return (
    <section id="providers" className="border-t border-black/5">
      <div
        ref={ref}
        className={`mx-auto max-w-5xl px-6 py-20 in-view ${
          isVisible ? "is-visible" : ""
        }`}
      >
        <h2 className="font-serif text-3xl text-ink">
          Works with the providers you already use
        </h2>
        <p className="mt-3 max-w-xl text-ink/65">
          Bring your own key from any of these — swap between them
          whenever you like.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          {PROVIDER_CHIPS.map((name) => (
            <span
              key={name}
              className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm text-ink/75 transition-all hover:-translate-y-0.5 hover:border-clay/30 hover:shadow-sm"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-black/5 bg-white/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-ink/50 sm:flex-row">
        <span>&copy; {new Date().getFullYear()} AgenticVenus</span>
        <div className="flex gap-6">
          <Link href="/login" className="transition-colors hover:text-ink/80">
            Log in
          </Link>
          <Link href="/signup" className="transition-colors hover:text-ink/80">
            Sign up
          </Link>
        </div>
      </div>
    </footer>
  );
}