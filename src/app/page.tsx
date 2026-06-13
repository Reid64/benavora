import Link from "next/link";
import Image from "next/image";

export default function LandingPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-navy-900 px-6 py-16 text-center text-white">
      <div className="pointer-events-none absolute -right-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-teal-500/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-40 -left-24 h-[28rem] w-[28rem] rounded-full bg-plum-600/25 blur-3xl" aria-hidden />
      <div className="relative z-10 flex flex-col items-center gap-6">
        <Image src="/benavora_logo.png" alt="Benavora" width={600} height={180} priority className="drop-shadow-2xl mb-4" />
        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          Fund More.{" "}
          <span className="text-teal-400">Do More.</span>{" "}
          <span className="text-plum-400">Change More.</span>
        </h1>
        <p className="max-w-xl text-lg text-navy-200">
          Nonprofit funding automation — AI-powered grant research, drafting, and lifecycle tracking, so a single operator can run hundreds of opportunities without anything slipping through.
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link href="/register" className="rounded-lg bg-teal-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-900/40 transition hover:bg-teal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900">
            Get started
          </Link>
          <Link href="/login" className="rounded-lg border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
            Sign in
          </Link>
        </div>
      </div>
      <p className="relative z-10 mt-16 text-sm text-navy-400">Nonprofit funding automation platform</p>
    </main>
  );
}

