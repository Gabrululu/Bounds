import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  FileCheck2,
  KeyRound,
  OctagonX,
  Radar,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/bounds/Logo";
import heroImg from "@/assets/hero-robot.jpg";
import cageImg from "@/assets/zone-cage.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bounds — Proven robot safety for the EU Machinery Regulation" },
      {
        name: "description",
        content:
          "License robots to bounded zones, gate every move with verified AI decisions, and export 2023/1230 compliance evidence.",
      },
      {
        property: "og:title",
        content: "Bounds — Proven robot safety for the EU Machinery Regulation",
      },
      {
        property: "og:description",
        content:
          "License robots to bounded zones, gate every move with verified AI decisions, and export 2023/1230 compliance evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const STATS = [
  ["<1s", "Revocation to safe-stop"],
  ["100%", "Decisions TEE-verified"],
  ["365d", "Decision log retention"],
  ["0", "Invented decisions"],
  ["5/5", "Regulation sections mapped"],
];

const STEPS = [
  {
    icon: KeyRound,
    n: "01",
    title: "Grant",
    text: "Issue a time-boxed license that binds a robot's ENS name to a bounded zone and a set of permissions.",
  },
  {
    icon: ShieldCheck,
    n: "02",
    title: "Decide",
    text: "Every motion is gated by a model decision computed in a TEE on 0G. No answer means safe-stop — never a guess.",
  },
  {
    icon: FileCheck2,
    n: "03",
    title: "Prove",
    text: "Hashes, transactions and episode roots roll up into an evidence report your notified body can verify.",
  },
];

const SECTIONS = [
  "Bounded work area",
  "Movement limits",
  "Safety-decision log",
  "Ability to correct / stop",
  "AI logging",
];

function Landing() {
  return (
    <div className="bg-background text-foreground">
      <div className="bg-primary-soft py-2 text-center text-xs">
        Built for the EU Machinery Regulation <span className="font-mono">2023/1230</span> — applies
        from Jan 2027.{" "}
        <a
          href="#compliance"
          className="font-semibold uppercase tracking-wide underline-offset-4 hover:underline"
        >
          See coverage →
        </a>
      </div>

      <header className="sticky top-0 z-30 px-3 pt-3">
        <nav className="mx-auto flex h-14 max-w-[1440px] items-center justify-between rounded-2xl border border-border bg-background/85 px-5 backdrop-blur">
          <Logo />
          <div className="hidden items-center gap-8 text-sm md:flex">
            <a href="#problem" className="hover:text-primary-text">
              Problem
            </a>
            <a href="#how" className="hover:text-primary-text">
              How it works
            </a>
            <a href="#compliance" className="hover:text-primary-text">
              Compliance
            </a>
          </div>
          <Button variant="ink" asChild>
            <Link to="/fleet">
              Open dashboard <ArrowRight />
            </Link>
          </Button>
        </nav>
      </header>

      {/* Hero */}
      <section className="px-3 pt-3">
        <div className="relative mx-auto flex min-h-[calc(100vh-110px)] max-w-[1440px] flex-col justify-end overflow-hidden rounded-3xl bg-hero">
          <img
            src={heroImg}
            alt="Robot arm working inside a glowing bounded zone"
            width={1920}
            height={1088}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-scrim/75 via-scrim/15 to-transparent" />
          <div className="relative grid gap-8 p-6 md:grid-cols-[1fr_380px] md:items-end md:p-12">
            <h1 className="font-display text-[clamp(2.6rem,7vw,6.5rem)] uppercase leading-[0.9] text-on-image">
              From assumed
              <br />
              safety to proven
              <br />
              compliance
            </h1>
            <div className="space-y-5 text-on-image">
              <p className="text-base leading-relaxed">
                Bounds licenses robots to operate only inside bounded zones, gates every move with
                verified AI decisions, and turns it all into evidence for the EU Machinery
                Regulation.
              </p>
              <Button variant="hero" size="xl" asChild>
                <Link to="/fleet">
                  Try the dashboard <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Trusted strip */}
      <section className="mx-auto max-w-[1440px] px-6 py-14 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Built for integrators who can't afford to guess
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-14 gap-y-4 font-display text-xl uppercase text-muted-foreground/70">
          <span>Acme Robotics</span>
          <span>Nordwerk</span>
          <span>Kinetik</span>
          <span>Celula</span>
          <span>Halden AMR</span>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="bg-blush px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-display text-[clamp(2rem,5vw,4rem)] uppercase leading-[0.95]">
            Your fleet grew 10x.
            <br />
            Your audit trail didn't.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            Safety PLCs, spreadsheets and PDFs don't prove what an AI-driven robot was allowed to do
            — or that it stopped when told.
          </p>
        </div>
        <img
          src={cageImg}
          alt="Small robot inside a faceted glass boundary"
          width={1280}
          height={1024}
          loading="lazy"
          className="mx-auto mt-10 w-full max-w-xl mix-blend-multiply dark:mix-blend-normal"
        />
        <div className="mx-auto mt-4 grid max-w-5xl gap-10 text-center md:grid-cols-3">
          {[
            [
              "17,000 decisions / robot / day",
              "Each one needs to be explainable, attributable and retained.",
            ],
            ["1 year minimum retention", "Safety-decision logs must survive audits and incidents."],
            [
              "0 room for invented answers",
              "If the model can't be reached, the machine must stop.",
            ],
          ].map(([t, d]) => (
            <div key={t}>
              <p className="font-semibold">{t}</p>
              <p className="mt-2 text-sm text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Marquee */}
      <section className="overflow-hidden bg-ink py-6 text-ink-foreground">
        <div className="flex w-max animate-marquee gap-16">
          {[...STATS, ...STATS, ...STATS, ...STATS].map(([v, l], i) => (
            <div key={i} className="flex items-baseline gap-3 whitespace-nowrap">
              <span className="font-display text-4xl text-primary-text">{v}</span>
              <span className="text-xs font-semibold uppercase tracking-widest">{l}</span>
            </div>
          ))}
        </div>
      </section>

      {/* How */}
      <section id="how" className="mx-auto max-w-[1440px] px-6 py-24">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-text">
          How it works
        </p>
        <h2 className="mt-3 max-w-3xl font-display text-[clamp(2rem,5vw,4rem)] uppercase leading-[0.95]">
          Stop guessing what your robots may do
        </h2>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="group rounded-3xl border border-border bg-card p-8 transition-colors hover:border-primary"
            >
              <div className="flex items-center justify-between">
                <s.icon className="size-7 text-primary-text" />
                <span className="font-mono text-sm text-muted-foreground">{s.n}</span>
              </div>
              <h3 className="mt-16 font-display text-3xl uppercase">{s.title}</h3>
              <p className="mt-3 text-muted-foreground">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="flex items-start gap-4 rounded-3xl bg-ink p-8 text-ink-foreground">
            <OctagonX className="mt-1 size-6 shrink-0 text-primary-text" />
            <div>
              <p className="font-display text-xl uppercase">One-click revoke</p>
              <p className="mt-2 text-sm opacity-75">
                An on-chain revocation reaches the robot within one control cycle and engages
                safe-stop.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-4 rounded-3xl bg-ink p-8 text-ink-foreground">
            <Workflow className="mt-1 size-6 shrink-0 text-primary-text" />
            <div>
              <p className="font-display text-xl uppercase">External triggers</p>
              <p className="mt-2 text-sm opacity-75">
                Weather, zone sensors and sanctions lists can revoke licenses automatically.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Compliance */}
      <section id="compliance" className="px-3">
        <div className="mx-auto grid max-w-[1440px] gap-10 rounded-3xl bg-primary-soft p-8 md:grid-cols-2 md:p-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-text">
              EU Machinery Regulation 2023/1230
            </p>
            <h2 className="mt-3 font-display text-[clamp(2rem,4.5vw,3.5rem)] uppercase leading-[0.95]">
              Evidence, not paperwork
            </h2>
            <p className="mt-6 max-w-md text-muted-foreground">
              Pick a robot and a date range. Bounds assembles source hashes and transactions for
              every requirement and flags what's missing.
            </p>
            <p className="mt-6 text-xs text-muted-foreground">
              Supports evidence preparation. Not legal advice or certification.
            </p>
          </div>
          <ul className="space-y-3">
            {SECTIONS.map((s, i) => (
              <li
                key={s}
                className="flex items-center justify-between rounded-2xl bg-card px-5 py-4"
              >
                <span className="flex items-center gap-4">
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="font-medium">{s}</span>
                </span>
                <span className="rounded-full bg-success/12 px-3 py-1 text-xs font-medium text-success">
                  Evidence present
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1440px] px-6 py-28 text-center">
        <Radar className="mx-auto size-10 text-primary-text" />
        <h2 className="mx-auto mt-6 max-w-4xl font-display text-[clamp(2.2rem,6vw,5rem)] uppercase leading-[0.92]">
          Ready to prove <span className="text-primary-text">every move?</span>
        </h2>
        <Button variant="hero" size="xl" className="mt-10" asChild>
          <Link to="/fleet">
            Open the dashboard <ArrowRight />
          </Link>
        </Button>
      </section>

      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <Logo />
          <span>© 2026 Bounds · Running on Sepolia testnet</span>
        </div>
      </footer>
    </div>
  );
}
