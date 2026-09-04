import Link from "next/link";

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
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-black/5 bg-cream/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-clay text-sm font-semibold text-cream">
              V
            </span>
            <span className="text-lg font-medium">AgenticVenus</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm text-ink/70 md:flex">
            <a href="#how-it-works" className="hover:text-ink">
              How it works
            </a>
            <a href="#providers" className="hover:text-ink">
              Providers
            </a>
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <Link
              href="/login"
              className="focus-ring rounded-md px-4 py-2 text-ink/80 hover:text-ink"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="focus-ring rounded-md bg-ink px-4 py-2 font-medium text-cream transition-colors hover:bg-ink/90"
            >
              Sign up
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center">
        <h1 className="font-serif text-5xl leading-[1.1] tracking-tight text-ink sm:text-6xl">
          Your own AI agent, built from any model you trust
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-ink/70">
          Pick a provider, paste your API key, and start working with an
          agent that runs on the model of your choice — no lock-in, no
          middleman.
        </p>
        <div className="mt-9 flex items-center justify-center gap-4">
          <Link
            href="/signup"
            className="focus-ring rounded-md bg-clay px-6 py-3 font-medium text-cream shadow-sm transition-colors hover:bg-clay-dark"
          >
            Get started free
          </Link>
          <Link
            href="/login"
            className="focus-ring rounded-md border border-ink/15 px-6 py-3 font-medium text-ink transition-colors hover:bg-sand"
          >
            I already have an account
          </Link>
        </div>

        {/* Mock chat / model-selector preview */}
        <div className="mx-auto mt-16 max-w-2xl rounded-card border border-ink/10 bg-white/60 p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between rounded-md border border-ink/10 bg-cream px-4 py-3">
            <span className="text-sm text-ink/50">
              Ask your agent anything...
            </span>
            <span className="flex items-center gap-2 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/80">
              <span className="h-1.5 w-1.5 rounded-full bg-clay" />
              Claude Sonnet
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M2 3.5L5 6.5L8 3.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
          <p className="mt-3 px-1 text-xs text-ink/40">
            Switch providers any time from the model selector — this is just
            a preview of what you&apos;ll see after signing up.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-black/5 bg-white/40">
        <div className="mx-auto max-w-5xl px-6 py-20">
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

      {/* Providers */}
      <section id="providers" className="border-t border-black/5">
        <div className="mx-auto max-w-5xl px-6 py-20">
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
                className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm text-ink/75"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-black/5 bg-white/40">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 text-sm text-ink/50 sm:flex-row">
          <span>&copy; {new Date().getFullYear()} AgenticVenus</span>
          <div className="flex gap-6">
            <Link href="/login" className="hover:text-ink/80">
              Log in
            </Link>
            <Link href="/signup" className="hover:text-ink/80">
              Sign up
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}