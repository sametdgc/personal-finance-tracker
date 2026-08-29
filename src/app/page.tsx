/** Phase 0 skeleton. */
export default function HomePage() {
  const questions = [
    ['Safe to Spend', 'What can I spend today without breaking anything?'],
    ['Compass', 'Where should the surplus go?'],
    ['Real Terms', 'Did any of it actually increase my purchasing power?'],
  ] as const

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-10 px-6 py-16">
      <header className="space-y-2">
        <h1 className="font-semibold text-4xl tracking-tight">Pusula</h1>
        <p className="text-neutral-500 text-sm dark:text-neutral-400">
          Phase 0 — skeleton, deployed.
        </p>
      </header>

      <ol className="space-y-5">
        {questions.map(([title, question], i) => (
          <li key={title} className="flex gap-4">
            <span className="font-mono text-neutral-400 text-sm tabular-nums">
              {i + 1}
            </span>
            <div>
              <h2 className="font-medium">{title}</h2>
              <p className="text-neutral-500 text-sm dark:text-neutral-400">{question}</p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  )
}
